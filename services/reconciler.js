/**
 * Reconciliação automática: clock_event_logs → time_records (espelho).
 *
 * PROBLEMA QUE RESOLVE:
 * Mesmo com o pipeline correto, pode haver eventos em clock_event_logs com
 * promoted_at IS NULL por mais de 2 minutos — falha silenciosa no promote.
 *
 * ESTRATÉGIA:
 * - Roda a cada 5 minutos (configurável)
 * - Busca eventos não promovidos há mais de 2 minutos
 * - Chama promote_clock_events_to_espelho por company+device
 * - Registra resultado em system_logs
 * - Alerta se divergência persistir
 *
 * CHECKPOINT:
 * - Salva last_reconciled_at no SQLite para retomar após reinício
 * - Evita reprocessar eventos já verificados
 */

import { LOG_LEVEL } from './syncQueue.js';

const RECONCILE_INTERVAL_MS  = 5  * 60_000;  // a cada 5 min
const UNPROMOTED_THRESHOLD_MS = 2  * 60_000;  // eventos > 2 min sem promoção
const ALERT_THRESHOLD         = 50;           // alertar se > 50 eventos parados
const BATCH_SIZE              = 200;

export class Reconciler {
  /**
   * @param {{
   *   supabase: import('@supabase/supabase-js').SupabaseClient,
   *   queue: import('./syncQueue.js').SyncQueue,
   *   alerts: import('./alertDispatcher.js').AlertDispatcher,
   *   cb: import('./circuitBreaker.js').CircuitBreaker,
   *   intervalMs?: number,
   * }} opts
   */
  constructor(opts) {
    this._supabase  = opts.supabase;
    this._queue     = opts.queue;
    this._alerts    = opts.alerts;
    this._cb        = opts.cb;
    this._interval  = Math.max(60_000, opts.intervalMs ?? RECONCILE_INTERVAL_MS);
    this._timer     = null;
    this._running   = false;
  }

  start() {
    if (this._timer) return;
    // Primeiro ciclo após 30s (deixar o worker principal estabilizar)
    const firstRun = setTimeout(() => this._run().catch((err) => {
      this._queue.log(LOG_LEVEL.WARN, 'reconciler', 'Primeira reconciliação falhou', { error: String(err) });
    }), 30_000);
    this._timer = setInterval(() => this._run().catch((err) => {
      this._queue.log(LOG_LEVEL.WARN, 'reconciler', 'Reconciliação periódica falhou', { error: String(err) });
    }), this._interval);
    this._queue.log(LOG_LEVEL.INFO, 'reconciler', `Reconciliador iniciado (intervalo: ${this._interval / 1000}s)`);
    return this;
  }

  stop() {
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
  }

  async _run() {
    if (this._running) return;
    if (this._cb?.isOpen) {
      this._queue.log(LOG_LEVEL.WARN, 'reconciler', 'Reconciliação pulada (circuit breaker OPEN)');
      return;
    }

    this._running = true;
    const t0 = Date.now();

    try {
      const cutoff = new Date(Date.now() - UNPROMOTED_THRESHOLD_MS).toISOString();

      // Buscar grupos (company_id, device_id) com eventos não promovidos
      const { data: groups, error: groupErr } = await this._supabase
        .from('clock_event_logs')
        .select('company_id, device_id')
        .is('promoted_at', null)
        .lt('created_at', cutoff)
        .limit(100);

      if (groupErr) {
        this._queue.log(LOG_LEVEL.WARN, 'reconciler', `Erro ao buscar grupos: ${groupErr.message}`);
        return;
      }

      if (!groups?.length) return;

      // Deduplicar grupos
      const seen = new Set();
      const uniqueGroups = groups.filter(g => {
        const key = `${g.company_id}:${g.device_id}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      let totalPromoted = 0;
      let totalErrors   = 0;

      for (const { company_id, device_id } of uniqueGroups) {
        // Contar eventos pendentes para este grupo
        const { count } = await this._supabase
          .from('clock_event_logs')
          .select('id', { count: 'exact', head: true })
          .eq('company_id', company_id)
          .eq('device_id', device_id)
          .is('promoted_at', null)
          .lt('created_at', cutoff);

        const pending = count ?? 0;

        if (pending === 0) continue;

        // Alertar se muitos eventos parados
        if (pending > ALERT_THRESHOLD) {
          await this._alerts.espelhoStalled(company_id, device_id, pending);
        }

        // Chamar promoção
        try {
          const { data, error } = await this._supabase.rpc('promote_clock_events_to_espelho', {
            p_company_id: company_id,
            p_device_id:  device_id,
            p_batch_size: BATCH_SIZE,
          });

          if (error) {
            totalErrors++;
            this._queue.log(LOG_LEVEL.WARN, 'reconciler',
              `Promoção falhou para ${device_id}: ${error.message}`,
              { company_id, device_id, pending });
          } else {
            const promoted = data?.timeRecords ?? data?.processed ?? pending;
            totalPromoted += promoted;
            this._queue.log(LOG_LEVEL.INFO, 'reconciler',
              `Reconciliado: ${promoted} evento(s) promovidos para ${device_id}`,
              { company_id, device_id, pending, promoted });
          }
        } catch (err) {
          totalErrors++;
          const msg = err instanceof Error ? err.message : String(err);
          this._queue.log(LOG_LEVEL.WARN, 'reconciler', `Exceção na promoção: ${msg}`, { company_id, device_id });
        }
      }

      const elapsed = Date.now() - t0;
      if (totalPromoted > 0 || totalErrors > 0) {
        this._queue.log(LOG_LEVEL.INFO, 'reconciler',
          `Ciclo concluído: ${totalPromoted} promovidos, ${totalErrors} erros (${elapsed}ms)`,
          { groups: uniqueGroups.length, totalPromoted, totalErrors, elapsedMs: elapsed });
        console.log(`[RECONCILER] ✓ ${totalPromoted} evento(s) reconciliados em ${elapsed}ms`);
      }

      // Salvar checkpoint
      this._saveCheckpoint(new Date().toISOString());

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this._queue.log(LOG_LEVEL.ERROR, 'reconciler', `Erro no ciclo: ${msg}`, { error: msg });
    } finally {
      this._running = false;
    }
  }

  _saveCheckpoint(ts) {
    try {
      this._queue.db.prepare(`
        INSERT INTO sync_checkpoint (id, last_reconciled_at)
        VALUES ('reconciler', ?)
        ON CONFLICT(id) DO UPDATE SET last_reconciled_at = excluded.last_reconciled_at
      `).run(ts);
    } catch {
      /* checkpoint é best-effort */
    }
  }

  getLastCheckpoint() {
    try {
      const row = this._queue.db.prepare(
        `SELECT last_reconciled_at FROM sync_checkpoint WHERE id = 'reconciler'`
      ).get();
      return row?.last_reconciled_at ?? null;
    } catch {
      return null;
    }
  }
}
