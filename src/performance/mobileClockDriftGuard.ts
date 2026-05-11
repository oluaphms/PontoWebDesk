/**
 * WebView Android / PWA: detecta pausa longa de timers ou gap de visibilidade e força resync GEO.
 */

import { invalidateOperationalGeoCaches } from '../services/queryCache';
import { reportDeviceOperationalReputationFromMonitoringContext } from '../services/deviceOperationalReputation.service';
import { reportGeoCircuitSignal } from '../domain/operational/geo/geoOperationalCircuitBreaker';
import { operationalReliabilitySLO } from '../domain/operational/reliability/operationalReliabilitySLO';
import { operationalBusEmit } from '../domain/operational/bus/operationalEventBus';
import { syncServerOperationalClockOffset } from '../services/serverOperationalClock.service';

let installed = false;
let lastVisiblePerf = typeof performance !== 'undefined' ? performance.now() : 0;
let intervalId: number | null = null;

async function recoverFromClockDrift(reason: string): Promise<void> {
  console.warn('[MOBILE CLOCK DRIFT DETECTED]', { reason });
  void syncServerOperationalClockOffset();
  operationalReliabilitySLO.recordDriftEventCount(1);
  reportGeoCircuitSignal('drift_storm');
  reportDeviceOperationalReputationFromMonitoringContext('mobile_clock_drift_detected');
  operationalBusEmit('telemetry:tick', { kind: 'mobile_clock_drift', reason });
  invalidateOperationalGeoCaches(`mobile_clock_drift:${reason}`);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('smartponto:force-monitoring-refresh', { detail: { source: 'mobile_clock_drift', reason } }),
    );
    window.dispatchEvent(new CustomEvent('smartponto:operational-snapshot-resync', { detail: { reason } }));
  }
  console.info('[OPERATIONAL SNAPSHOT RESYNC]', { reason });
  console.info('[REALTIME CHANNEL REOPEN]', {
    note: 'client_invalidated_geo_caches; channels re-subscribe on next navigation or monitoring mount',
    reason,
  });
}

/**
 * Idempotente — registra listeners globais uma vez.
 */
export function installMobileClockDriftGuard(): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (installed) return;
  installed = true;

  const FREEZE_MS = 20_000;
  const TICK_MS = 5000;

  const onVisibility = () => {
    if (document.visibilityState === 'hidden') {
      lastVisiblePerf = performance.now();
      return;
    }
    const gap = performance.now() - lastVisiblePerf;
    if (gap > FREEZE_MS) {
      void recoverFromClockDrift('visibility_gap');
    }
    lastVisiblePerf = performance.now();
  };

  document.addEventListener('visibilitychange', onVisibility);

  window.addEventListener('pageshow', (ev) => {
    const pe = ev as PageTransitionEvent;
    if (pe.persisted) {
      void recoverFromClockDrift('pageshow_persisted');
    }
    lastVisiblePerf = performance.now();
  });

  intervalId = window.setInterval(() => {
    if (document.visibilityState !== 'visible') return;
    const now = performance.now();
    if (now - lastVisiblePerf > FREEZE_MS + TICK_MS) {
      void recoverFromClockDrift('timer_freeze_suspect');
    }
    lastVisiblePerf = now;
  }, TICK_MS);
}

export function teardownMobileClockDriftGuardForTests(): void {
  if (intervalId != null && typeof window !== 'undefined') {
    window.clearInterval(intervalId);
    intervalId = null;
  }
  installed = false;
}
