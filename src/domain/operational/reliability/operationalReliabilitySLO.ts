/**
 * SLO operacional — agregados em memória e deteção de violação de budget (p50/p90).
 */

type SampleRing = { buf: number[]; i: number; filled: number };

function makeRing(cap: number): SampleRing {
  return { buf: new Array(cap), i: 0, filled: 0 };
}

function pushRing(r: SampleRing, v: number): void {
  r.buf[r.i] = v;
  r.i = (r.i + 1) % r.buf.length;
  r.filled = Math.min(r.buf.length, r.filled + 1);
}

function percentile(r: SampleRing, p: number): number | null {
  if (r.filled === 0) return null;
  const slice = r.buf.slice(0, r.filled).filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (slice.length === 0) return null;
  const idx = Math.min(slice.length - 1, Math.max(0, Math.ceil((p / 100) * slice.length) - 1));
  return slice[idx] ?? null;
}

const refreshMs = makeRing(180);
const staleRate = makeRing(120);
const replayOk = makeRing(80);
const realtimeLagCoalesce = makeRing(80);
const reconOk = makeRing(60);
const heartbeatGap = makeRing(60);
const driftEvents = makeRing(60);

/** Targets em percentagem “success” ou ms conforme métrica (documentado por chave). */
const BUDGET = {
  refresh_p90_ms: { p90: 3500, label: 'tempo médio refresh GEO' },
  stale_rate_p90: { p90: 0.35, label: 'stale rate' },
  replay_success_p90: { p90: 0.9, label: 'replay success' },
  realtime_lag_p90: { p90: 14, label: 'coalesce realtime (rajada)' },
  recon_success_p90: { p90: 0.85, label: 'reconciliation success' },
  heartbeat_gap_p90: { p90: 120_000, label: 'heartbeat continuity (ms)' },
  drift_freq_p90: { p90: 8, label: 'drift frequency / janela' },
} as const;

let lastBreachLog = 0;

function logBreach(metric: string, value: number, budget: number): void {
  const t = Date.now();
  if (t - lastBreachLog < 4000) return;
  lastBreachLog = t;
  console.error('[OPERATIONAL SLO BREACH]', { metric, value, budget });
}

/** Nome de exportação pedido na maturidade enterprise. */
export const OperationalReliabilitySLO = {
  recordMonitoringRefreshMs(ms: number): void {
    pushRing(refreshMs, ms);
    const p = percentile(refreshMs, 90);
    if (p != null && p > BUDGET.refresh_p90_ms.p90) {
      logBreach('refresh_p90_ms', p, BUDGET.refresh_p90_ms.p90);
    }
  },

  recordStaleRate(ratio01: number): void {
    pushRing(staleRate, ratio01);
    const p = percentile(staleRate, 90);
    if (p != null && p > BUDGET.stale_rate_p90.p90) {
      logBreach('stale_rate_p90', p, BUDGET.stale_rate_p90.p90);
    }
  },

  recordReplaySuccess(ok: boolean): void {
    pushRing(replayOk, ok ? 1 : 0);
    if (replayOk.filled < 12) return;
    const slice = replayOk.buf.slice(0, replayOk.filled);
    const mean = slice.reduce((a, b) => a + b, 0) / slice.length;
    if (mean < BUDGET.replay_success_p90.p90) {
      logBreach('replay_success_mean', mean, BUDGET.replay_success_p90.p90);
    }
  },

  recordRealtimeCoalescePeak(n: number): void {
    pushRing(realtimeLagCoalesce, n);
    const p = percentile(realtimeLagCoalesce, 90);
    if (p != null && p > BUDGET.realtime_lag_p90.p90) {
      logBreach('realtime_lag_p90', p, BUDGET.realtime_lag_p90.p90);
    }
  },

  recordReconciliationSuccess(ok: boolean): void {
    pushRing(reconOk, ok ? 1 : 0);
    if (reconOk.filled < 10) return;
    const slice = reconOk.buf.slice(0, reconOk.filled);
    const mean = slice.reduce((a, b) => a + b, 0) / slice.length;
    if (mean < BUDGET.recon_success_p90.p90) {
      logBreach('recon_success_mean', mean, BUDGET.recon_success_p90.p90);
    }
  },

  recordHeartbeatGapMs(gapMs: number): void {
    pushRing(heartbeatGap, gapMs);
    const p = percentile(heartbeatGap, 90);
    if (p != null && p > BUDGET.heartbeat_gap_p90.p90) {
      logBreach('heartbeat_gap_p90', p, BUDGET.heartbeat_gap_p90.p90);
    }
  },

  recordDriftEventCount(n: number): void {
    pushRing(driftEvents, n);
    const p = percentile(driftEvents, 90);
    if (p != null && p > BUDGET.drift_freq_p90.p90) {
      logBreach('drift_freq_p90', p, BUDGET.drift_freq_p90.p90);
    }
  },
};

export const operationalReliabilitySLO = OperationalReliabilitySLO;

export type OperationalReliabilitySLORegistry = typeof OperationalReliabilitySLO;
