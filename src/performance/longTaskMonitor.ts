import { observabilityConsole } from '../shared/logger/observabilityConsole';
/**
 * Observa long tasks na main thread (UI freeze). Requer suporte a PerformanceObserver + longtask.
 */

import { isPostLoginQueryCooldownActive } from '../app/postLoginQueryGate';
import { isCriticalLoginPathActive } from '../auth/authBootstrapPriority';

let pipelineIdForContext: number | null = null;

export function setLongTaskPipelineContext(pipelineId: number | null): void {
  pipelineIdForContext = pipelineId;
}

const DEFAULT_MIN_DURATION_MS = 200;
const LOGIN_SENSITIVE_MIN_MS = 120;

function isPerfLoggingEnabled(): boolean {
  try {
    return import.meta.env?.DEV || String(import.meta.env?.VITE_ENABLE_PERF_LOGS || '').toLowerCase() === 'true';
  } catch {
    return false;
  }
}

function isLoginPipelineSensitive(): boolean {
  return isPostLoginQueryCooldownActive() || isCriticalLoginPathActive();
}

function logLongTask(
  entry: PerformanceEntry,
  route: string,
  label: '[LONG TASK DETECTED]' | '[LONG TASK BLOCKING LOGIN]',
  minMs: number,
): void {
  if (typeof console === 'undefined') return;
  const d = entry.duration;
  if (!Number.isFinite(d) || d < minMs) return;
  const stackHint =
    typeof entry.name === 'string' && entry.name.length ? entry.name.slice(0, 120) : 'longtask';
  const payload = {
    durationMs: Math.round(d),
    name: entry.name,
    entryType: entry.entryType,
    startTime: Math.round(entry.startTime),
    route,
    pipelineId: pipelineIdForContext,
    component: 'main-thread',
    stackSummary: stackHint,
  };
  if (label === '[LONG TASK BLOCKING LOGIN]') {
    observabilityConsole.warn(label, payload);
  } else {
    observabilityConsole.info(label, payload);
  }
}

export function startLongTaskMonitor(): void {
  if (typeof PerformanceObserver === 'undefined' || typeof window === 'undefined') return;
  if (!isPerfLoggingEnabled()) return;
  try {
    const observer = new PerformanceObserver((list) => {
      const route = window.location?.pathname ?? '';
      const sensitive = isLoginPipelineSensitive();
      const minMs = sensitive ? LOGIN_SENSITIVE_MIN_MS : DEFAULT_MIN_DURATION_MS;
      const label = sensitive ? '[LONG TASK BLOCKING LOGIN]' : '[LONG TASK DETECTED]';
      for (const entry of list.getEntries()) {
        logLongTask(entry, route, label, minMs);
      }
    });
    observer.observe({ type: 'longtask', buffered: true } as PerformanceObserverInit);
  } catch {
    try {
      const observer = new PerformanceObserver((list) => {
        const route = window.location?.pathname ?? '';
        const sensitive = isLoginPipelineSensitive();
        const minMs = sensitive ? LOGIN_SENSITIVE_MIN_MS : DEFAULT_MIN_DURATION_MS;
        const label = sensitive ? '[LONG TASK BLOCKING LOGIN]' : '[LONG TASK DETECTED]';
        for (const entry of list.getEntries()) {
          logLongTask(entry, route, label, minMs);
        }
      });
      observer.observe({ entryTypes: ['longtask'] });
    } catch {
      // Ambiente sem longtask (ex. alguns WebViews antigos)
    }
  }
}
