/**
 * Rastreamento ponta-a-ponta do login para diagnóstico de lentidão / corridas.
 * Logs obrigatórios: prefixo [AUTH TRACE] + payload JSON.
 */

export type LoginTraceStepName =
  | 'click_login'
  | 'auth_request_start'
  | 'auth_request_success'
  | 'session_received'
  | 'auth_listener_triggered'
  | 'user_fetch_start'
  | 'user_fetch_success'
  | 'permissions_fetch_start'
  | 'permissions_fetch_success'
  | 'tenant_fetch_start'
  | 'tenant_fetch_success'
  | 'navigation_start'
  | 'dashboard_rendered'
  | 'loading_released';

export type LoginTraceStep = {
  name: LoginTraceStepName | string;
  at: number;
  /** ms desde o passo anterior */
  deltaMs?: number;
  /** ms desde o início do trace (click_login ou primeiro passo) */
  cumulativeMs?: number;
};

export type LoginTrace = {
  attemptId: number;
  pipelineId: number | null;
  /** performance.now() do primeiro passo usado como base de duração total */
  startedAt: number;
  steps: LoginTraceStep[];
};

let lastFormSubmitPerf: number | null = null;
let activeTrace: LoginTrace | null = null;

/** Chamar no submit do formulário de login (antes do await do signIn). */
export function recordLoginFormSubmit(): void {
  if (typeof performance === 'undefined') return;
  lastFormSubmitPerf = performance.now();
}

export function getActiveLoginTrace(): LoginTrace | null {
  return activeTrace;
}

export function setActiveLoginTrace(trace: LoginTrace | null): void {
  activeTrace = trace;
}

function logTraceLine(payload: Record<string, unknown>): void {
  if (typeof console === 'undefined') return;
  console.info('[AUTH TRACE]', payload);
}

/**
 * Inicia trace para uma tentativa de login.
 */
export function createLoginTrace(attemptId: number, pipelineId: number | null): LoginTrace {
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const clickAt = lastFormSubmitPerf;
  lastFormSubmitPerf = null;

  const startedAt = clickAt != null ? clickAt : now;
  const steps: LoginTraceStep[] = [];

  if (clickAt != null) {
    steps.push({
      name: 'click_login',
      at: clickAt,
      deltaMs: 0,
      cumulativeMs: 0,
    });
  }

  steps.push({
    name: 'auth_pipeline_local_start',
    at: now,
    deltaMs: clickAt != null ? Math.round(now - clickAt) : 0,
    cumulativeMs: Math.round(now - startedAt),
  });

  const trace: LoginTrace = { attemptId, pipelineId, startedAt, steps };
  setActiveLoginTrace(trace);
  logTraceLine({
    attemptId,
    pipelineId,
    phase: 'trace_start',
    startedAt,
    hasClick: clickAt != null,
  });
  return trace;
}

export function traceLoginStep(
  trace: LoginTrace | null | undefined,
  name: LoginTraceStepName | string,
  extra?: Record<string, unknown>,
): void {
  if (!trace || typeof performance === 'undefined') return;
  const now = performance.now();
  const prev = trace.steps[trace.steps.length - 1];
  const deltaMs = prev != null ? Math.round(now - prev.at) : 0;
  const cumulativeMs = Math.round(now - trace.startedAt);
  const step: LoginTraceStep = { name, at: now, deltaMs, cumulativeMs };
  trace.steps.push(step);
  logTraceLine({
    attemptId: trace.attemptId,
    pipelineId: trace.pipelineId,
    step: name,
    deltaMs,
    cumulativeMs,
    ...extra,
  });
}

export function finalizeLoginTrace(trace: LoginTrace | null | undefined, outcome: string): void {
  if (!trace || typeof performance === 'undefined') return;
  const end = performance.now();
  const totalDurationMs = Math.round(end - trace.startedAt);
  const payload = {
    attemptId: trace.attemptId,
    pipelineId: trace.pipelineId,
    outcome,
    totalDurationMs,
    steps: trace.steps.map((s) => ({
      name: s.name,
      deltaMs: s.deltaMs,
      cumulativeMs: s.cumulativeMs ?? Math.round(s.at - trace.startedAt),
    })),
  };
  logTraceLine(payload);
  if (totalDurationMs > 5000) {
    console.warn('[AUTH LOGIN BUDGET]', { totalDurationMs, targetMsMobile: 5000, outcome });
  } else if (totalDurationMs > 3000) {
    console.warn('[AUTH LOGIN BUDGET]', { totalDurationMs, targetMsDesktop: 3000, outcome });
  }
  if (activeTrace === trace) {
    setActiveLoginTrace(null);
  }
}

export function failLoginTrace(trace: LoginTrace | null | undefined, reason: string): void {
  traceLoginStep(trace, 'trace_failed', { reason });
  finalizeLoginTrace(trace, `failed:${reason}`);
}

/** Etapa mais lenta (maior delta entre passos consecutivos). */
export function getSlowestLoginStep(trace: LoginTrace | null): { name: string; deltaMs: number } | null {
  if (!trace?.steps.length) return null;
  let max = { name: trace.steps[0].name, deltaMs: trace.steps[0].deltaMs ?? 0 };
  for (const s of trace.steps) {
    const d = s.deltaMs ?? 0;
    if (d > max.deltaMs) max = { name: String(s.name), deltaMs: d };
  }
  return max.deltaMs > 0 ? max : null;
}
