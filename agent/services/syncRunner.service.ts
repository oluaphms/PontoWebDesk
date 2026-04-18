/**
 * Orquestra: flush da fila SQLite (retry) + ciclo de sync (coleta → SQLite → Supabase/API).
 * Intervalo default 10s (`CLOCK_AGENT_INTERVAL_MS`); backoff exponencial por linha até 1 min (`retryPolicy.ts`).
 * Registros na fila nunca são apagados — só `synced=1` após sucesso no Supabase.
 */

import type { AgentConfig } from '../config';
import { createSupabaseRestConfig } from '../adapters/supabase.adapter';
import { OfflineQueue } from '../queue';
import { runSyncCycle, type SyncCycleResult, type ApiPunchSender } from '../../src/services/sync.service';
import { SyncLogger } from '../../src/services/syncLogger';
import type { AgentLogger } from './agentLogger';
import { flushOfflineQueue } from './queueFlush.service';

export function aggregateEspelhoCycle(
  devices: Array<{
    espelho?: {
      processed: number;
      timeRecords: number;
      userNotFound: number;
      duplicate: number;
      errors: number;
    };
  }>
): {
  processed: number;
  timeRecords: number;
  userNotFound: number;
  duplicate: number;
  errors: number;
} | null {
  let processed = 0;
  let timeRecords = 0;
  let userNotFound = 0;
  let duplicate = 0;
  let errors = 0;
  let any = false;
  for (const d of devices) {
    const e = d.espelho;
    if (!e) continue;
    any = true;
    processed += e.processed;
    timeRecords += e.timeRecords;
    userNotFound += e.userNotFound;
    duplicate += e.duplicate;
    errors += e.errors;
  }
  return any ? { processed, timeRecords, userNotFound, duplicate, errors } : null;
}

/**
 * Cria sender para API intermediária (/api/punch) quando configurada.
 */
function createApiPunchSender(cfg: AgentConfig): ApiPunchSender | undefined {
  if (!cfg.apiBaseUrl || !cfg.apiKey) return undefined;

  return {
    async send({ deviceId, companyId, rows }) {
      const punches = rows.map((row, idx) => ({
        employee_id: String(row.employee_id || ''),
        occurred_at: String(row.occurred_at || new Date().toISOString()),
        event_type: String(row.event_type || 'E'),
        dedupe_hash: String(row.dedupe_hash || `fallback-${idx}-${Date.now()}`),
        raw: typeof row.raw === 'object' && row.raw !== null ? row.raw : {},
      }));

      const res = await fetch(`${cfg.apiBaseUrl}/api/punch`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${cfg.apiKey}`,
          'User-Agent': 'PontoWebDesk-Agent/1.0',
          'X-Agent-Version': '1.0',
        },
        body: JSON.stringify({
          deviceId,
          companyId: companyId || '',
          punches,
        }),
      });

      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;

      if (!res.ok) {
        return {
          success: false,
          inserted: 0,
          error: String(data.error || `HTTP ${res.status}`),
        };
      }

      return {
        success: Boolean(data.success),
        inserted: Number(data.inserted || 0),
        duplicates: Number(data.duplicates || 0),
        error: data.error ? String(data.error) : undefined,
      };
    },
  };
}

export async function runAgentTick(cfg: AgentConfig, queue: OfflineQueue, log: AgentLogger): Promise<SyncCycleResult> {
  // Config
  log.configLoaded({
    intervalMs: cfg.intervalMs,
    sqliteDbPath: cfg.sqliteDbPath,
    apiMode: !!cfg.apiBaseUrl,
    skipEspelho: cfg.skipEspelho,
  });

  const rest = createSupabaseRestConfig(cfg.supabaseUrl, cfg.serviceRoleKey);

  // Verificar fila offline
  const pendingBefore = await queue.count();
  if (pendingBefore > 0) {
    log.queueEnqueued(pendingBefore);
  }

  // Flush da fila (reenvios)
  await flushOfflineQueue(cfg, queue, log);

  const syncLogger = new SyncLogger(log.syncSink());

  // Detectar modo: API ou direto
  const apiPunchSender = createApiPunchSender(cfg);
  if (apiPunchSender) {
    log.connOk(`Modo API ativo: ${cfg.apiBaseUrl}/api/punch`);
  } else {
    log.connOk('Modo REST direto ao Supabase');
  }

  // Executar ciclo de sync
  const result = await runSyncCycle({
    supabase: rest,
    timeLogsTable: cfg.timeLogsTable,
    devicesTable: cfg.devicesTable,
    syncLogsTable: cfg.syncLogsTable,
    skipEspelhoPromote: cfg.skipEspelho,
    logger: syncLogger,
    apiPunchSender,
    offlineClockPersistence: {
      stageRowsBeforeSend: (input) => {
        log.queueEnqueued(input.rows.length, input.deviceId);
        return queue.stageClockRowsBeforeSend(input);
      },
      markRowsSynced: (ids) => {
        log.queueProcessed(0, ids.length, 0);
        return queue.markSyncedMany(ids);
      },
      onSendFailed: async ({ deviceId, ids, error }) => {
        const msg = error instanceof Error ? error.message : String(error);
        for (const id of ids) {
          await queue.rescheduleFailed(id, msg);
          log.retryScheduled(id, 1, 'next cycle', deviceId);
        }
        log.sendError(msg, { count: ids.length, location: 'SQLite queue' }, deviceId);
      },
    },
  });

  // Resumo do ciclo
  const espelho = aggregateEspelhoCycle(result.devices);
  if (espelho) {
    log.syncOk('aggregate', espelho.timeRecords, {
      processed: espelho.processed,
      userNotFound: espelho.userNotFound,
      duplicate: espelho.duplicate,
      errors: espelho.errors,
    });
  }

  for (const d of result.devices) {
    if (d.ok) {
      log.syncOk(d.deviceId, d.imported, {
        skippedDuplicates: d.skippedDuplicates,
        espelho: d.espelho,
      });
    } else {
      log.syncError(d.deviceId, d.error || 'Unknown error');
    }
  }

  return result;
}
