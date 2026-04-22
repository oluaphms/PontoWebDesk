/**
 * Rastreador de latência ponta-a-ponta.
 *
 * Mede o tempo entre:
 * - batida coletada (occurred_at no relógio)
 * - evento disponível no espelho (time_records.created_at no Supabase)
 *
 * SLA:
 * - < 10s  → normal
 * - 10–30s → WARNING
 * - > 30s  → CRITICAL
 *
 * Funciona consultando clock_event_logs com promoted_at recente e calculando
 * a diferença entre occurred_at e promoted_at.
 */

import { LOG_LEVEL } from './syncQueue.js';

const SLA_WARN_MS     = 10_000;  // 10s
const SLA_CRITICAL_MS = 30_000;  // 30s
const CHECK_INTERVAL  = 5 * 60_000; // a cada 5 min
const SAMPLE_SIZE     = 20;      // últimas N promoções para calcular média

export class LatencyTracker {
  /**
   * @param {{
   *   supabase: import('@supabase/supabase-js').SupabaseClient,
   *   queue: import('./syncQueue.js').SyncQueue,
   *   alerts: import('./alertDispatcher.js').AlertDispatcher,
   *   intervalMs?: number,
   * }} opts
   */
  constructor(opts) {
    this._supabase = opts.supabase;
    this._queue    = opts.queue;
    this._alerts   = opts.alerts;
    this._interval = opts.intervalMs ?? CHECK_INTERVAL;
    this._timer    = null;
    this._lastStats = null;
  }

  start() {
    if (this._timer) return this;
    this._timer = setInterval(() => this._check().catch((err) => {
      console.warn('[latencyTracker] Falha ao medir latência:', err);
    }), this._interval);
    return this;
  }

  stop() {
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
  }

  async _check() {
    try {
      // Buscar promoções recentes (últimas 10 min)
      const since = new Date(Date.now() - 10 * 60_000).toISOString();
      const { data, error } = await this._supabase
        .from('clock_event_logs')
        .select('occurred_at, promoted_at')
        .not('promoted_at', 'is', null)
        .gte('promoted_at', since)
        .order('promoted_at', { ascending: false })
        .limit(SAMPLE_SIZE);

      if (error || !data?.length) return;

      const latencies = data
        .map(r => new Date(r.promoted_at).getTime() - new Date(r.occurred_at).getTime())
        .filter(l => l >= 0 && l < 24 * 3600_000); // ignorar outliers absurdos

      if (!latencies.length) return;

      const avg = Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length);
      const max = Math.max(...latencies);
      const p95 = latencies.sort((a, b) => a - b)[Math.floor(latencies.length * 0.95)] ?? max;

      this._lastStats = { avg, max, p95, samples: latencies.length, checkedAt: new Date().toISOString() };

      if (max > SLA_CRITICAL_MS) {
        this._queue.log(LOG_LEVEL.ERROR, 'latency',
          `CRITICAL: latência máxima ${Math.round(max / 1000)}s (limite: ${SLA_CRITICAL_MS / 1000}s)`,
          this._lastStats);
        await this._alerts.dispatch({
          type:    'latency_critical',
          level:   'critical',
          title:   'Latência crítica batida→espelho',
          message: `Máx: ${Math.round(max / 1000)}s | P95: ${Math.round(p95 / 1000)}s | Média: ${Math.round(avg / 1000)}s`,
          context: this._lastStats,
        });
      } else if (avg > SLA_WARN_MS) {
        this._queue.log(LOG_LEVEL.WARN, 'latency',
          `WARNING: latência média ${Math.round(avg / 1000)}s (limite: ${SLA_WARN_MS / 1000}s)`,
          this._lastStats);
      } else {
        this._queue.log(LOG_LEVEL.INFO, 'latency',
          `Latência OK: avg=${Math.round(avg / 1000)}s p95=${Math.round(p95 / 1000)}s`,
          this._lastStats);
      }
    } catch {
      /* best-effort */
    }
  }

  getStats() { return this._lastStats; }
}
