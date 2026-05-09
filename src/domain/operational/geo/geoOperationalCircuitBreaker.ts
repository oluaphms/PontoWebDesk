/**
 * Circuit breaker GEO: protege CPU mobile e reduz pressão sob rajadas.
 */

import { isOperationalCircuitBreakerEnabled } from '../governance/operationalFeatureFlags';

export type GeoCircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

const OPEN_MS = 45_000;
const HALF_OPEN_MS = 12_000;

let state: GeoCircuitState = 'CLOSED';
let phaseUntil = 0;
let signalsInWindow = 0;
let windowStart = 0;
const WINDOW_MS = 8_000;
const OPEN_THRESHOLD = 5;

function nowMs(): number {
  return Date.now();
}

function refreshPhase(t: number): void {
  if (state === 'OPEN' && t >= phaseUntil) {
    state = 'HALF_OPEN';
    phaseUntil = t + HALF_OPEN_MS;
    console.info('[GEO CIRCUIT HALF OPEN]', { until: phaseUntil });
    void import('../../../services/operational/operationalAutoRecoveryRunner').then((m) =>
      m.runOperationalAutoRecovery('geo_circuit_half_open'),
    );
  } else if (state === 'HALF_OPEN' && t >= phaseUntil) {
    state = 'CLOSED';
    console.info('[GEO CIRCUIT CLOSED]', { reason: 'half_open_elapsed' });
  }
}

export function reportGeoCircuitSignal(
  kind: 'stale_flood' | 'drift_storm' | 'mock_surge' | 'realtime_lag' | 'stream_congestion',
): void {
  if (!isOperationalCircuitBreakerEnabled()) return;
  const t = nowMs();
  refreshPhase(t);
  if (state === 'OPEN' && t < phaseUntil) {
    void kind;
    return;
  }
  if (t - windowStart > WINDOW_MS) {
    windowStart = t;
    signalsInWindow = 0;
  }
  signalsInWindow += 1;
  if (signalsInWindow >= OPEN_THRESHOLD && state === 'CLOSED') {
    state = 'OPEN';
    phaseUntil = t + OPEN_MS;
    signalsInWindow = 0;
    console.warn('[GEO CIRCUIT OPEN]', { until: phaseUntil, kind });
  }
}

export function getGeoOperationalCircuitDegradeFactor(): number {
  if (!isOperationalCircuitBreakerEnabled()) return 1;
  const t = nowMs();
  refreshPhase(t);
  if (state === 'OPEN' && t < phaseUntil) return 3.2;
  if (state === 'HALF_OPEN' && t < phaseUntil) return 1.75;
  return 1;
}

export function getGeoOperationalCircuitState(): GeoCircuitState {
  if (!isOperationalCircuitBreakerEnabled()) return 'CLOSED';
  refreshPhase(nowMs());
  return state;
}

export function notifyGeoCircuitSuccess(): void {
  const t = nowMs();
  refreshPhase(t);
  if (state === 'HALF_OPEN' || state === 'OPEN') {
    state = 'CLOSED';
    phaseUntil = 0;
    signalsInWindow = 0;
    console.info('[GEO CIRCUIT CLOSED]', { reason: 'success' });
  }
}
