/**
 * Orquestração: dispositivos (Supabase) → adapters → normalização → REST (time logs) → last_sync.
 * Sem ramificações por marca fora dos adapters — apenas getAdapter(brand).
 */

import { createHash } from 'node:crypto';
import { getAdapter } from '../adapters/factory';
import type { DeviceConfig, NormalizedRecord } from '../adapters/types';
import type { SupabaseRestConfig } from './supabaseRest';
import { promoteClockEventsToEspelho, type PromoteEspelhoResult } from './clockEventPromote.service';
import { restGet, restPatch, restPostBulk } from './supabaseRest';
import { SyncLogger } from './syncLogger';

export interface DeviceRow {
  id: string;
  company_id: string | null;
  name: string | null;
  brand: string | null;
  ip: string | null;
  port: number | null;
  username: string | null;
  password: string | null;
  last_sync: string | null;
  active: boolean | null;
  /** Opcional (coluna JSONB em `devices`): mescla em `DeviceConfig.extra` para o adapter REP. */
  config_extra?: Record<string, unknown> | null;
}

export interface SyncCycleOptions {
  supabase: SupabaseRestConfig;
  /** Tabela PostgREST dos eventos normalizados (default: clock_event_logs). */
  timeLogsTable?: string;
  devicesTable?: string;
  syncLogsTable?: string;
  /** Quando true, não grava linhas em clock_sync_logs (apenas console). */
  skipPersistenceLogs?: boolean;
  /** Quando true, não chama rep_ingest_punch após o sync (env CLOCK_SYNC_SKIP_ESPELHO=1). */
  skipEspelhoPromote?: boolean;
  logger?: SyncLogger;
}

export interface DeviceSyncResult {
  deviceId: string;
  ok: boolean;
  imported: number;
  skippedDuplicates: number;
  error?: string;
  /** Promoção clock_event_logs → time_records (rep_ingest_punch). */
  espelho?: PromoteEspelhoResult;
}

export interface SyncCycleResult {
  devices: DeviceSyncResult[];
  startedAt: string;
  finishedAt: string;
}

function envTable(name: string, fallback: string): string {
  const v = (process.env[name] || '').trim();
  return v || fallback;
}

function rowToDeviceConfig(row: DeviceRow): DeviceConfig | null {
  if (!row.ip || !row.company_id || !row.brand) return null;
  const brand = row.brand.toLowerCase().trim();
  if (!['controlid', 'dimep', 'henry', 'topdata'].includes(brand)) return null;
  const extra: Record<string, unknown> =
    row.config_extra && typeof row.config_extra === 'object'
      ? { ...row.config_extra }
      : {};
  const devicePort = row.port;
  if (devicePort === 443) {
    extra.https = true;
    if (extra.tls_insecure === undefined && extra.accept_self_signed === undefined) {
      extra.tls_insecure = true;
    }
  }
  const u = row.username != null ? String(row.username).trim() : '';
  const pwd = row.password != null ? String(row.password).trim() : '';
  return {
    id: row.id,
    company_id: row.company_id,
    brand: brand as DeviceConfig['brand'],
    ip: row.ip,
    port: row.port ?? undefined,
    username: u || undefined,
    password: pwd || undefined,
    extra,
  };
}

export function computeDedupeHash(r: NormalizedRecord): string {
  const base = `${r.company_id}|${r.device_id}|${r.employee_id}|${r.timestamp}|${r.event_type}`;
  return createHash('sha256').update(base, 'utf8').digest('hex');
}

function toInsertRow(r: NormalizedRecord, dedupe: string): Record<string, unknown> {
  return {
    employee_id: r.employee_id,
    occurred_at: r.timestamp,
    event_type: r.event_type,
    device_id: r.device_id,
    company_id: r.company_id,
    raw: r.raw,
    dedupe_hash: dedupe,
  };
}

async function persistSyncLog(
  cfg: SupabaseRestConfig,
  table: string,
  entry: { device_id: string | null; company_id: string | null; level: string; message: string; meta: Record<string, unknown> },
  skip: boolean
): Promise<void> {
  if (skip) return;
  try {
    await restPostBulk(cfg, table, [entry]);
  } catch {
    /* falha secundária — não interrompe sync */
  }
}

/**
 * Busca dispositivos ativos e sincroniza em paralelo (isolamento por Promise.allSettled).
 */
export async function runSyncCycle(options: SyncCycleOptions): Promise<SyncCycleResult> {
  const startedAt = new Date().toISOString();
  const logger = options.logger ?? new SyncLogger();
  const timeLogsTable = options.timeLogsTable ?? envTable('SUPABASE_TIME_LOGS_TABLE', 'clock_event_logs');
  const devicesTable = options.devicesTable ?? envTable('SUPABASE_DEVICES_TABLE', 'devices');
  const syncLogsTable = options.syncLogsTable ?? envTable('SUPABASE_SYNC_LOGS_TABLE', 'clock_sync_logs');
  const skipLogTable = options.skipPersistenceLogs === true;

  const cfg = options.supabase;
  const path = `${devicesTable}?active=eq.true&select=*`;
  const rows = (await restGet<DeviceRow[]>(cfg, path)) ?? [];
  const configs: { row: DeviceRow; config: DeviceConfig }[] = [];
  for (const row of rows) {
    const config = rowToDeviceConfig(row);
    if (config) configs.push({ row, config });
    else logger.warn(`Dispositivo ignorado (dados incompletos ou marca inválida): ${row.id}`, row.id ?? undefined);
  }

  const skipEspelho =
    options.skipEspelhoPromote === true || (process.env.CLOCK_SYNC_SKIP_ESPELHO || '').trim() === '1';
  const results = await Promise.allSettled(
    configs.map(({ row, config }) =>
      syncOneDevice(cfg, row, config, timeLogsTable, syncLogsTable, skipLogTable, logger, skipEspelho)
    )
  );

  const devices: DeviceSyncResult[] = results.map((r, i) => {
    const id = configs[i]?.row.id ?? 'unknown';
    if (r.status === 'fulfilled') return r.value;
    return { deviceId: id, ok: false, imported: 0, skippedDuplicates: 0, error: String(r.reason) };
  });

  return {
    devices,
    startedAt,
    finishedAt: new Date().toISOString(),
  };
}

async function syncOneDevice(
  cfg: SupabaseRestConfig,
  row: DeviceRow,
  config: DeviceConfig,
  timeLogsTable: string,
  syncLogsTable: string,
  skipLogTable: boolean,
  logger: SyncLogger,
  skipEspelhoPromote: boolean
): Promise<DeviceSyncResult> {
  const deviceId = row.id;
  const lastSync = row.last_sync ?? undefined;
  try {
    logger.sync(`Início da sincronização`, deviceId, { brand: config.brand, lastSync });
    const adapter = getAdapter(config.brand);
    const records = await adapter.fetch(config, lastSync);
    const rows: Record<string, unknown>[] = [];
    const seen = new Set<string>();
    let skippedDuplicates = 0;
    const insertedRecords: NormalizedRecord[] = [];

    for (const r of records) {
      const dedupe = computeDedupeHash(r);
      if (seen.has(dedupe)) {
        skippedDuplicates += 1;
        continue;
      }
      seen.add(dedupe);
      insertedRecords.push(r);
      rows.push(toInsertRow(r, dedupe));
    }

    await restPostBulk(cfg, timeLogsTable, rows);

    let espelho: PromoteEspelhoResult | undefined;
    if (!skipEspelhoPromote && row.company_id) {
      try {
        espelho = await promoteClockEventsToEspelho(cfg, {
          timeLogsTable,
          companyId: row.company_id,
          deviceId,
          batchSize: 200,
          maxBatches: 150,
        });
        logger.sync(
          `Espelho (time_records): processados=${espelho.processed} criados=${espelho.timeRecords} sem_user=${espelho.userNotFound} dup=${espelho.duplicate} err=${espelho.errors}`,
          deviceId,
          espelho
        );
      } catch (pe: unknown) {
        const m = pe instanceof Error ? pe.message : String(pe);
        logger.warn(`Promoção espelho ignorada ou falhou (aplique a migração clock_event_logs_espelho?): ${m}`, deviceId);
      }
    }

    let nextLastSync: string | undefined = row.last_sync ?? undefined;
    if (insertedRecords.length > 0) {
      let maxMs = 0;
      for (const r of insertedRecords) {
        const t = new Date(r.timestamp).getTime();
        if (!Number.isNaN(t) && t > maxMs) maxMs = t;
      }
      nextLastSync = maxMs > 0 ? new Date(maxMs).toISOString() : new Date().toISOString();
      await restPatch(cfg, `devices?id=eq.${encodeURIComponent(deviceId)}`, { last_sync: nextLastSync });
    }

    logger.sync(`Concluído: ${rows.length} evento(s) enviado(s)`, deviceId, {
      imported: rows.length,
      skippedDuplicates,
      last_sync: nextLastSync,
    });
    await persistSyncLog(
      cfg,
      syncLogsTable,
      {
        device_id: deviceId,
        company_id: row.company_id,
        level: 'info',
        message: 'Sincronização concluída',
        meta: { imported: rows.length, skippedDuplicates, last_sync: nextLastSync ?? null },
      },
      skipLogTable
    );

    return {
      deviceId,
      ok: true,
      imported: rows.length,
      skippedDuplicates,
      espelho,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error(`Falha na sincronização: ${msg}`, deviceId, { error: msg });
    await persistSyncLog(
      cfg,
      syncLogsTable,
      {
        device_id: deviceId,
        company_id: row.company_id,
        level: 'error',
        message: msg,
        meta: {},
      },
      skipLogTable
    );
    return { deviceId, ok: false, imported: 0, skippedDuplicates: 0, error: msg };
  }
}

export async function fetchActiveDeviceConfigs(options: SyncCycleOptions): Promise<DeviceConfig[]> {
  const cfg = options.supabase;
  const devicesTable = options.devicesTable ?? envTable('SUPABASE_DEVICES_TABLE', 'devices');
  const rows = (await restGet<DeviceRow[]>(cfg, `${devicesTable}?active=eq.true&select=*`)) ?? [];
  const out: DeviceConfig[] = [];
  for (const row of rows) {
    const c = rowToDeviceConfig(row);
    if (c) out.push(c);
  }
  return out;
}
