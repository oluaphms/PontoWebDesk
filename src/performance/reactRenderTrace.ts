/**
 * Profiling operacional via React.Profiler — budgets mobile-first na main thread.
 */
import { opLog } from '../utils/operationalLogger';

const RENDER_FRAME_BUDGET_MS = 16;
const MOUNT_BUDGET_MS = 50;
const SEQUENCE_WINDOW_MS = 100;
const SEQUENCE_COMMIT_STORM = 8;

const recentCommitTimes: number[] = [];

/** Agregação leve para auditoria pós-login (dev / diagnóstico manual). */
const renderAgg = new Map<
  string,
  { count: number; totalActualMs: number; maxActualMs: number; slowCount: number }
>();

const RENDER_AGG_MAX_KEYS = 80;

export function logReactRenderTraceTop10(reason = 'manual'): void {
  const rows = [...renderAgg.entries()]
    .map(([id, s]) => ({
      id,
      count: s.count,
      avgMs: s.count ? Math.round((s.totalActualMs / s.count) * 10) / 10 : 0,
      maxMs: Math.round(s.maxActualMs * 10) / 10,
      slowCount: s.slowCount,
    }))
    .sort((a, b) => b.count - a.count || b.maxMs - a.maxMs)
    .slice(0, 10);
  opLog.info('REACT RENDER TRACE', { top10: rows, reason });
}

function trimCommitWindow(now: number): void {
  while (recentCommitTimes.length && now - (recentCommitTimes[0] as number) > SEQUENCE_WINDOW_MS) {
    recentCommitTimes.shift();
  }
}

export type ReactProfilerPhase = 'mount' | 'update' | 'nested-update';

/**
 * Callback para <Profiler onRender={...} />.
 */
export function createReactProfilerOnRender(): (
  id: string,
  phase: ReactProfilerPhase,
  actualDuration: number,
  baseDuration: number,
  startTime: number,
  commitTime: number,
) => void {
  return (id, phase, actualDuration, baseDuration, startTime, commitTime) => {
    const roundedActual = Math.round(actualDuration * 10) / 10;
    const roundedBase = Math.round(baseDuration * 10) / 10;

    const slowFrame = actualDuration > RENDER_FRAME_BUDGET_MS;
    const slowMount = phase === 'mount' && actualDuration > MOUNT_BUDGET_MS;

    if (slowFrame || slowMount) {
      opLog.info('REACT RENDER TRACE', {
        id,
        phase,
        actualDurationMs: roundedActual,
        baseDurationMs: roundedBase,
        startTime: Math.round(startTime),
        commitTime: Math.round(commitTime),
        propsChanged: phase === 'update',
        contextChanged: undefined,
      });
    }

    const prev = renderAgg.get(id) ?? { count: 0, totalActualMs: 0, maxActualMs: 0, slowCount: 0 };
    const next = {
      count: prev.count + 1,
      totalActualMs: prev.totalActualMs + actualDuration,
      maxActualMs: Math.max(prev.maxActualMs, actualDuration),
      slowCount: prev.slowCount + (slowFrame ? 1 : 0),
    };
    renderAgg.set(id, next);
    if (renderAgg.size > RENDER_AGG_MAX_KEYS) {
      const drop = [...renderAgg.keys()].slice(0, renderAgg.size - RENDER_AGG_MAX_KEYS);
      for (const k of drop) renderAgg.delete(k);
    }

    if (slowFrame) {
      console.warn('[REACT PERFORMANCE VIOLATION]', {
        kind: 'render_frame',
        id,
        phase,
        actualDurationMs: roundedActual,
        budgetMs: RENDER_FRAME_BUDGET_MS,
      });
    }
    if (slowMount) {
      console.warn('[REACT PERFORMANCE VIOLATION]', {
        kind: 'mount',
        id,
        phase,
        actualDurationMs: roundedActual,
        budgetMs: MOUNT_BUDGET_MS,
      });
    }

    recentCommitTimes.push(commitTime);
    trimCommitWindow(commitTime);
    if (recentCommitTimes.length >= SEQUENCE_COMMIT_STORM) {
      opLog.warn('REACT RENDER TRACE', {
        storm: true,
        id,
        commitsIn100ms: recentCommitTimes.length,
        phase,
        hint: 'render_storm',
      });
    }
  };
}
