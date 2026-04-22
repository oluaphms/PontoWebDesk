/**
 * SLO/SLA Tracker — mede e registra conformidade com objetivos de nível de serviço.
 *
 * SLOs DEFINIDOS:
 * - Disponibilidade:      99.9% (máx 43.8 min/mês de downtime)
 * - Latência ingestão:    < 2s (p99)
 * - Latência espelho:     < 10s (p99)
 * - Perda de dados:       0 (zero tolerance)
 * - Sync lag:             < 30s (tempo entre batida e disponível no espelho)
 *
 * ERROR BUDGET:
 * - Calculado mensalmente
 * - Se budget esgotado → flag FREEZE_DEPLOYS ativada
 * - Resetado no 1º de cada mês
 *
 * ARMAZENAMENTO:
 * - SQLite local: slo_measurements (histórico de medições)
 * - Supabase: slo_snapshots (agregados diários para dashboard)
 */

import { LOG_LEVEL } from './syncQueue.js';

// ─── SLO Targets ──────────────────────────────────────────────────────────────

export const SLO = {
  AVAILABILITY_PCT:    99.9,   // %
  INGEST_LATENCY_MS:   2_000,  // p99
  ESPELHO_LATENCY_MS:  10_000, // p99
  SYNC_LAG_MS:         30_000, // tempo batida → espelho
  DATA_LOSS_TOLERANCE: 0,      // zero
};

// Janela de medição: 30 dias
const WINDOW_DAYS    = 30;
const WINDOW_MS      = WINDOW_DAYS * 86_400_000;
const MEASURE_INTERVAL = 60_000; // medir a cada 1 min

const SCHEMA = `
CREATE TABLE IF NOT EXISTS slo_measurements (
  id           TEXT PRIMARY KEY NOT NULL,
  measured_at  TEXT NOT NULL,
  metric       TEXT NOT NULL,
  value        REAL NOT NULL,
  slo_target   REAL NOT NULL,
  compliant    INTEGER NOT NULL DEFAULT 1,
  company_id   TEXT
);
CREATE INDEX IF NOT EXISTS idx_slo_metric_time ON slo_measurements (metric, measured_at);
`;

export class SLOTracker {
  /**
   * @param {{
   *   db:       import('better-sqlite3').Database,
   *   queue:    import('./syncQueue.js').SyncQueue,
   *   supabase?: import('@supabase/supabase-js').SupabaseClient,
   *   alerts?:  import('./alertDispatcher.js').AlertDispatcher,
   * }} opts
   */
  constructor(opts) {
    this._db       = opts.db;
    this._queue    = opts.queue;
    this._supabase = opts.supabase ?? null;
    this._alerts   = opts.alerts   ?? null;
    this._timer    = null;
    this._uptime   = { totalChecks: 0, failedChecks: 0 };
    this._ensureSchema();
  }

  _ensureSchema() {
    try {
      this._db.exec(SCHEMA);
    } catch (err) {
      console.warn('[sloTracker] Falha ao garantir schema:', err);
    }
  }

  start() {
    this._timer = setInterval(() => this._measure().catch((err) => {
      console.warn('[sloTracker] Falha ao medir SLO:', err);
    }), MEASURE_INTERVAL);
    return this;
  }

  stop() {
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
  }

  // ── Medição ───────────────────────────────────────────────────────────────

  async _measure() {
    const now = new Date().toISOString();

    // 1. Disponibilidade (baseada no circuit breaker / Supabase health)
    const available = await this._checkAvailability();
    this._uptime.totalChecks++;
    if (!available) this._uptime.failedChecks++;
    this._record('availability', available ? 100 : 0, SLO.AVAILABILITY_PCT, now);

    // 2. Latência de ingestão (do queue metrics)
    const qMetrics = this._getQueueMetrics();
    if (qMetrics.avgIngestMs > 0) {
      this._record('ingest_latency_ms', qMetrics.avgIngestMs, SLO.INGEST_LATENCY_MS, now);
    }

    // 3. Sync lag (oldest pending)
    if (qMetrics.processingDelayMs > 0) {
      this._record('sync_lag_ms', qMetrics.processingDelayMs, SLO.SYNC_LAG_MS, now);
    }

    // 4. Verificar error budget
    await this._checkErrorBudget();
  }

  async _checkAvailability() {
    if (!this._supabase) return true;
    try {
      const ctrl = new AbortController();
      const t    = setTimeout(() => ctrl.abort(), 3_000);
      const { error } = await this._supabase
        .from('clock_event_logs').select('id').limit(1).abortSignal(ctrl.signal);
      clearTimeout(t);
      return !error;
    } catch { return false; }
  }

  _getQueueMetrics() {
    try {
      const metrics = this._db.prepare(`
        SELECT status, COUNT(*) as c FROM sync_jobs GROUP BY status
      `).all();
      const byStatus = Object.fromEntries(metrics.map(r => [r.status, r.c]));
      const oldest   = this._db.prepare(
        `SELECT next_run_at FROM sync_jobs WHERE status = 'pending' ORDER BY next_run_at ASC LIMIT 1`
      ).get();
      return {
        pending:           byStatus['pending']    ?? 0,
        processingDelayMs: oldest?.next_run_at
          ? Math.max(0, Date.now() - new Date(oldest.next_run_at).getTime())
          : 0,
        avgIngestMs: 0, // preenchido pelo syncService via recordIngestLatency
      };
    } catch { return { pending: 0, processingDelayMs: 0, avgIngestMs: 0 }; }
  }

  _record(metric, value, target, measuredAt) {
    const compliant = metric === 'availability' ? value >= target : value <= target;
    try {
      this._db.prepare(`
        INSERT INTO slo_measurements (id, measured_at, metric, value, slo_target, compliant)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        `${metric}-${Date.now()}`,
        measuredAt,
        metric,
        value,
        target,
        compliant ? 1 : 0
      );
    } catch { /* ignore */ }

    if (!compliant) {
      this._queue.log(LOG_LEVEL.WARN, 'slo',
        `SLO violado: ${metric} = ${Math.round(value)} (target: ${target})`,
        { metric, value, target, compliant });
    }
  }

  /**
   * Registra latência de ingestão externamente (chamado pelo syncService).
   * @param {number} latencyMs
   */
  recordIngestLatency(latencyMs) {
    const compliant = latencyMs <= SLO.INGEST_LATENCY_MS;
    this._record('ingest_latency_ms', latencyMs, SLO.INGEST_LATENCY_MS, new Date().toISOString());
  }

  // ── Error Budget ──────────────────────────────────────────────────────────

  async _checkErrorBudget() {
    const budget = this.getErrorBudget();
    if (budget.remainingPct <= 0) {
      this._queue.log(LOG_LEVEL.ERROR, 'slo',
        `Error budget esgotado! Disponibilidade: ${budget.currentAvailabilityPct.toFixed(3)}% (SLO: ${SLO.AVAILABILITY_PCT}%)`,
        budget);
      if (this._alerts) {
        await this._alerts.dispatch({
          type:    'error_budget_exhausted',
          level:   'critical',
          title:   'Error Budget Esgotado',
          message: `Disponibilidade: ${budget.currentAvailabilityPct.toFixed(3)}% | Budget restante: ${budget.remainingPct.toFixed(2)}% | Deploys devem ser congelados.`,
          context: budget,
        }).catch(() => {});
      }
    }
  }

  /**
   * Calcula o error budget atual (janela de 30 dias).
   */
  getErrorBudget() {
    const cutoff = new Date(Date.now() - WINDOW_MS).toISOString();
    try {
      const rows = this._db.prepare(`
        SELECT compliant, COUNT(*) as c
        FROM slo_measurements
        WHERE metric = 'availability' AND measured_at >= ?
        GROUP BY compliant
      `).all(cutoff);

      const total    = rows.reduce((s, r) => s + r.c, 0);
      const compliant = rows.find(r => r.compliant === 1)?.c ?? 0;
      const currentAvailabilityPct = total > 0 ? (compliant / total) * 100 : 100;

      // Error budget = (1 - SLO_target) * window
      const budgetTotalMin   = (1 - SLO.AVAILABILITY_PCT / 100) * WINDOW_DAYS * 24 * 60;
      const usedMin          = ((100 - currentAvailabilityPct) / 100) * WINDOW_DAYS * 24 * 60;
      const remainingMin     = Math.max(0, budgetTotalMin - usedMin);
      const remainingPct     = budgetTotalMin > 0 ? (remainingMin / budgetTotalMin) * 100 : 100;

      return {
        windowDays:              WINDOW_DAYS,
        sloTarget:               SLO.AVAILABILITY_PCT,
        currentAvailabilityPct,
        budgetTotalMinutes:      Math.round(budgetTotalMin),
        budgetUsedMinutes:       Math.round(usedMin),
        budgetRemainingMinutes:  Math.round(remainingMin),
        remainingPct:            Math.round(remainingPct * 10) / 10,
        status:                  remainingPct > 50 ? 'healthy' : remainingPct > 10 ? 'at_risk' : 'exhausted',
        freezeDeploys:           remainingPct <= 0,
      };
    } catch {
      return { windowDays: WINDOW_DAYS, sloTarget: SLO.AVAILABILITY_PCT, remainingPct: 100, status: 'unknown', freezeDeploys: false };
    }
  }

  /**
   * Retorna histórico de SLO para um período.
   * @param {{ metric?: string, days?: number }} opts
   */
  getHistory(opts = {}) {
    const { metric, days = 7 } = opts;
    const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
    let sql = `SELECT * FROM slo_measurements WHERE measured_at >= ?`;
    const params = [cutoff];
    if (metric) { sql += ` AND metric = ?`; params.push(metric); }
    sql += ` ORDER BY measured_at DESC LIMIT 1000`;
    try {
      return this._db.prepare(sql).all(...params);
    } catch { return []; }
  }

  /**
   * Limpa medições antigas (retenção: 90 dias).
   */
  purge(retentionDays = 90) {
    const cutoff = new Date(Date.now() - retentionDays * 86_400_000).toISOString();
    try {
      return this._db.prepare(`DELETE FROM slo_measurements WHERE measured_at < ?`).run(cutoff).changes;
    } catch { return 0; }
  }
}
