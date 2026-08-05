import { observabilityConsole } from '../shared/logger/observabilityConsole';
import { isDegradedMobileRuntime } from './mobileCpuBudget';
import { isLowNetworkMode } from './networkMode';
import { getRealtimeSheddingDebounceFactor } from './realtimeLoadShedding';
import { getGeoOperationalCircuitDegradeFactor } from '../domain/operational/geo/geoOperationalCircuitBreaker';

/** Poller slots ativos (evita rajadas de timers concorrentes). */
let activePollSlots = 0;
const MAX_CONCURRENT_POLL_SLOTS = 4;

export function isPollingSuppressedByVisibility(): boolean {
  if (typeof document === 'undefined') return false;
  return document.visibilityState === 'hidden';
}

/**
 * Intervalo adaptativo para refetch (React Query, timers).
 */
export function getAdaptiveRefetchIntervalMs(baseMs: number): number {
  let ms = baseMs;
  if (isLowNetworkMode()) ms = Math.max(ms, 5 * 60 * 1000);
  else if (isDegradedMobileRuntime()) ms = Math.max(ms, 3 * 60 * 1000);
  return ms;
}

export function pollingGovernorTryAcquireSlot(id: string): boolean {
  if (isPollingSuppressedByVisibility()) {
    if (typeof console !== 'undefined') {
      observabilityConsole.info('[POLLING GOVERNOR]', { action: 'skip_hidden', id });
    }
    return false;
  }
  if (activePollSlots >= MAX_CONCURRENT_POLL_SLOTS) {
    if (typeof console !== 'undefined') {
      observabilityConsole.info('[POLLING GOVERNOR]', { action: 'concurrency_cap', id, activePollSlots });
    }
    return false;
  }
  activePollSlots += 1;
  return true;
}

export function pollingGovernorReleaseSlot(): void {
  activePollSlots = Math.max(0, activePollSlots - 1);
}

export function getMonitoringRealtimeDebounceMs(): number {
  let base = 400;
  if (isLowNetworkMode()) base = 1200;
  else if (isDegradedMobileRuntime()) base = 700;
  return Math.min(8000, Math.round(base * getRealtimeSheddingDebounceFactor() * getGeoOperationalCircuitDegradeFactor()));
}
