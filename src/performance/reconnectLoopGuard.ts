/**
 * Detecta rajadas de evento `online` (reconnect loops) em janela deslizante.
 */

import { reportDeviceOperationalReputationFromMonitoringContext } from '../services/deviceOperationalReputation.service';
import { reportGeoCircuitSignal } from '../domain/operational/geo/geoOperationalCircuitBreaker';

const WINDOW_MS = 60_000;
const STORM_THRESHOLD = 6;

let windowStart = 0;
let onlineEvents = 0;

export function recordBrowserOnlineReconnectForOperationalResilience(): void {
  const now = Date.now();
  if (now - windowStart > WINDOW_MS) {
    windowStart = now;
    onlineEvents = 0;
  }
  onlineEvents += 1;
  if (onlineEvents === STORM_THRESHOLD) {
    console.warn('[RECONNECT LOOP STORM]', { count: onlineEvents, window_ms: WINDOW_MS });
    reportGeoCircuitSignal('stream_congestion');
    void reportDeviceOperationalReputationFromMonitoringContext('reconnect_loop');
  }
}
