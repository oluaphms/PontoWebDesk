/**
 * Profiler operacional — apenas agregados em memória (sem PII).
 */

type Agg = { n: number; sum: number; max: number };

const geoResolve = createAgg();
const idbLatency = createAgg();
const reconDuration = createAgg();
let lastLog = 0;

function createAgg(): Agg {
  return { n: 0, sum: 0, max: 0 };
}

function bump(a: Agg, v: number): void {
  if (!Number.isFinite(v)) return;
  a.n += 1;
  a.sum += v;
  a.max = Math.max(a.max, v);
}

function mean(a: Agg): number {
  return a.n ? a.sum / a.n : 0;
}

export const operationalPerformanceProfiler = {
  recordGeoResolveMs(ms: number): void {
    bump(geoResolve, ms);
  },

  recordIndexedDbMs(ms: number): void {
    bump(idbLatency, ms);
  },

  recordReconciliationMs(ms: number): void {
    bump(reconDuration, ms);
  },

  /** Log periódico de agregados (console). */
  maybeLogAggregates(): void {
    const t = Date.now();
    if (t - lastLog < 120_000) return;
    lastLog = t;
    if (geoResolve.n === 0 && idbLatency.n === 0 && reconDuration.n === 0) return;
    console.info('[OPERATIONAL PERF AGG]', {
      geo_resolve_ms: { n: geoResolve.n, mean: Math.round(mean(geoResolve)), max: Math.round(geoResolve.max) },
      idb_ms: { n: idbLatency.n, mean: Math.round(mean(idbLatency)), max: Math.round(idbLatency.max) },
      recon_ms: { n: reconDuration.n, mean: Math.round(mean(reconDuration)), max: Math.round(reconDuration.max) },
    });
  },
};

let obsInstalled = false;

export function installOperationalPerformanceProfiler(): void {
  if (typeof window === 'undefined' || obsInstalled) return;
  obsInstalled = true;
  try {
    const obs = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        if (e.entryType === 'longtask' && e.duration > 120) {
          bump(geoResolve, e.duration);
        }
      }
    });
    obs.observe({ entryTypes: ['longtask'] });
  } catch {
    obsInstalled = false;
  }
  window.setInterval(() => operationalPerformanceProfiler.maybeLogAggregates(), 60_000);
}
