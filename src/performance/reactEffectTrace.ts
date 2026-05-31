import { observabilityConsole } from '../shared/logger/observabilityConsole';
import { useEffect, useMemo, useRef, type DependencyList } from 'react';

const STORM_WINDOW_MS = 5000;
const STORM_RUN_THRESHOLD = 3;

type RunLog = { t: number; durationMs: number; depSnap: string };

const effectHistory = new Map<string, RunLog[]>();

function effectKey(component: string, effectId: string): string {
  return `${component}::${effectId}`;
}

function trimRuns(runs: RunLog[], now: number): void {
  while (runs.length && now - runs[0].t > STORM_WINDOW_MS) {
    runs.shift();
  }
}

function summarizeDeps(deps: DependencyList): string {
  try {
    return JSON.stringify(
      deps.map((d) => {
        if (d === null || d === undefined) return d;
        const t = typeof d;
        if (t === 'function') return '[fn]';
        if (t !== 'object') return d;
        if (Array.isArray(d)) return `[arr:${d.length}]`;
        return '[obj]';
      }),
    );
  } catch {
    return '[deps]';
  }
}

function detectStorm(key: string, runs: RunLog[]): void {
  if (runs.length < STORM_RUN_THRESHOLD || typeof console === 'undefined') return;
  observabilityConsole.warn('[REACT EFFECT STORM]', {
    key,
    runsIn5s: runs.length,
    threshold: STORM_RUN_THRESHOLD,
    hint: 'dependency_churn_or_loop',
    lastDurationsMs: runs.slice(-4).map((r) => Math.round(r.durationMs * 10) / 10),
  });
}

/**
 * useEffect com telemetria: duração, diff de deps resumido, storm em >3 execuções / 5s.
 */
export function useTracedEffect(
  component: string,
  effectId: string,
  effect: () => void | (() => void),
  deps: DependencyList,
): void {
  const depSnap = useMemo(() => summarizeDeps(deps), deps);
  const prevDepSnapRef = useRef<string | null>(null);

  useEffect(() => {
    const key = effectKey(component, effectId);
    const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const prevSnap = prevDepSnapRef.current;
    prevDepSnapRef.current = depSnap;

    let cleanup: void | (() => void);
    try {
      cleanup = effect();
    } finally {
      const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now();
      const durationMs = t1 - t0;
      const now = Date.now();

      if (typeof console !== 'undefined') {
        const verbose =
          import.meta.env.DEV ||
          durationMs > 32 ||
          (prevSnap !== null && prevSnap !== depSnap) ||
          (typeof window !== 'undefined' && (window as unknown as { __REACT_EFFECT_TRACE?: boolean }).__REACT_EFFECT_TRACE);
        if (verbose) {
          observabilityConsole.info('[REACT EFFECT TRACE]', {
            component,
            effectId,
            durationMs: Math.round(durationMs * 10) / 10,
            depChanged: prevSnap !== null && prevSnap !== depSnap,
            depSummary: depSnap.slice(0, 280),
            triggerReason: prevSnap === null ? 'mount' : prevSnap !== depSnap ? 'deps' : 'parent_rerender',
          });
        }
      }

      let runs = effectHistory.get(key);
      if (!runs) {
        runs = [];
        effectHistory.set(key, runs);
      }
      runs.push({ t: now, durationMs, depSnap });
      trimRuns(runs, now);
      detectStorm(key, runs);
    }

    return cleanup;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deps forwarded as argument
  }, deps);
}
