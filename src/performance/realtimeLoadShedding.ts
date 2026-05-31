import { observabilityConsole } from '../shared/logger/observabilityConsole';
/**
 * Degradação adaptativa de realtime/polling sob pressão (CPU, rede, aba oculta, rajadas).
 */

import { isLowNetworkMode, isAndroidOrWebViewUa } from './networkMode';
import { isDegradedMobileRuntime } from './mobileCpuBudget';
import { getGeoOperationalCircuitDegradeFactor } from '../domain/operational/geo/geoOperationalCircuitBreaker';

let invalidateBurst = 0;
let invalidateWindowStart = 0;
const INVALIDATE_WINDOW_MS = 2000;

let longTaskBursts = 0;
let longTaskWindowStart = 0;
const LONGTASK_WINDOW_MS = 3000;

let lastReportedFactor = 1;
let lastLogAt = 0;
const LOG_THROTTLE_MS = 8000;

export function recordRealtimeInvalidateBurst(count = 1): void {
  const now = Date.now();
  if (now - invalidateWindowStart > INVALIDATE_WINDOW_MS) {
    invalidateBurst = 0;
    invalidateWindowStart = now;
  }
  invalidateBurst += count;
}

function logShedding(factor: number): void {
  const now = Date.now();
  const crossed = (lastReportedFactor >= 2) !== (factor >= 2);
  if (!crossed && now - lastLogAt < LOG_THROTTLE_MS && Math.abs(factor - lastReportedFactor) < 0.35) return;
  lastLogAt = now;
  observabilityConsole.info('[REALTIME LOAD SHEDDING]', {
    factor,
    invalidate_burst: invalidateBurst,
    longtask_bursts: longTaskBursts,
    hidden: typeof document !== 'undefined' ? document.visibilityState === 'hidden' : null,
  });
  if (factor >= 2) {
    observabilityConsole.info('[REALTIME DEGRADED MODE]', { factor });
  } else if (lastReportedFactor >= 2 && factor < 2) {
    observabilityConsole.info('[REALTIME RECOVERED]', { factor });
  }
  lastReportedFactor = factor;
}

/**
 * Fator multiplicador para debounce de canais realtime (>=1).
 */
export function getRealtimeSheddingDebounceFactor(): number {
  let f = 1;
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') f *= 2.2;
  if (isLowNetworkMode()) f *= 1.55;
  if (isDegradedMobileRuntime()) f *= 1.35;
  if (isAndroidOrWebViewUa()) f *= 1.15;
  if (invalidateBurst > 10) f *= 1.45;
  if (longTaskBursts >= 2) f *= 1.4;
  f = Math.min(6, f);
  f *= getGeoOperationalCircuitDegradeFactor();
  f = Math.min(8, f);
  logShedding(f);
  return f;
}

export function shouldSuppressBackgroundGeoEnrich(): boolean {
  if (typeof document === 'undefined') return false;
  return document.visibilityState === 'hidden' && getRealtimeSheddingDebounceFactor() >= 2;
}

let sheddingObserverInstalled = false;

export function installRealtimeLoadSheddingObservers(): void {
  if (sheddingObserverInstalled || typeof window === 'undefined') return;
  sheddingObserverInstalled = true;
  try {
    const obs = new PerformanceObserver((list) => {
      const now = Date.now();
      let heavy = 0;
      for (const e of list.getEntries()) {
        if (e.duration > 80) heavy += 1;
      }
      if (heavy === 0) return;
      if (now - longTaskWindowStart > LONGTASK_WINDOW_MS) {
        longTaskBursts = 0;
        longTaskWindowStart = now;
      }
      longTaskBursts += heavy;
    });
    obs.observe({ entryTypes: ['longtask'] });
  } catch {
    sheddingObserverInstalled = false;
  }
}
