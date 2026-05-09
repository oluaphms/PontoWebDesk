/**
 * Estabilidade mobile/PWA: pressão de memória, freeze, restore, discard.
 */

import { invalidateOperationalGeoCaches } from '../services/queryCache';
import { isAndroidOrWebViewUa } from './networkMode';
import { installRealtimeLoadSheddingObservers } from './realtimeLoadShedding';
import { installOperationalPerformanceProfiler } from './operationalPerformanceProfiler';
import { isOperationalProfilerEnabled } from '../domain/operational/governance/operationalFeatureFlags';
import { installOperationalLegalAuditShadowListeners } from '../services/operationalLegalAuditTrail.service';

let installed = false;
let lastIntervalTick = Date.now();
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

function logMemoryPressure(): void {
  const perf = performance as Performance & { memory?: { usedJSHeapSize?: number; jsHeapSizeLimit?: number } };
  const m = perf.memory;
  if (!m?.usedJSHeapSize || !m?.jsHeapSizeLimit) return;
  const ratio = m.usedJSHeapSize / m.jsHeapSizeLimit;
  if (ratio > 0.92) {
    console.warn('[MOBILE MEMORY PRESSURE]', {
      used: m.usedJSHeapSize,
      limit: m.jsHeapSizeLimit,
      ratio: Math.round(ratio * 100) / 100,
    });
  }
}

function recoverRealtimeCaches(reason: string): void {
  try {
    invalidateOperationalGeoCaches(reason);
    window.dispatchEvent(new CustomEvent('smartponto:operational-realtime-recover', { detail: { reason } }));
    console.info('[PWA RESTORE]', { reason, action: 'cache_invalidate_dispatch' });
  } catch (e) {
    console.warn('[PWA RESTORE]', { reason, error: String(e) });
  }
}

/**
 * Idempotente — registra listeners globais uma vez.
 */
export function installMobileRuntimeStability(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  installRealtimeLoadSheddingObservers();
  if (isOperationalProfilerEnabled()) {
    installOperationalPerformanceProfiler();
  }
  installOperationalLegalAuditShadowListeners();

  if (isAndroidOrWebViewUa()) {
    console.info('[WEBVIEW DEGRADED]', { note: 'telemetry_only' });
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      recoverRealtimeCaches('visibility_visible');
    }
  });

  window.addEventListener('pageshow', (ev) => {
    const p = ev as PageTransitionEvent;
    if (p.persisted) {
      recoverRealtimeCaches('pageshow_bfcache');
    }
  });

  if (heartbeatTimer) clearInterval(heartbeatTimer);
  heartbeatTimer = setInterval(() => {
    const now = Date.now();
    const expected = lastIntervalTick + 5000;
    const drift = now - expected;
    lastIntervalTick = now;
    if (drift > 20_000) {
      console.warn('[MOBILE FREEZE DETECTED]', { drift_ms: drift });
      recoverRealtimeCaches('freeze_heartbeat');
    }
    logMemoryPressure();
  }, 5000);
}
