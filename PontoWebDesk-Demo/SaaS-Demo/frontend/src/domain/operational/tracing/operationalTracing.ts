import { operationalLog } from '../observability';
import { recordOperationalMetric } from '../metrics';

export type OperationalSpanType =
  | 'GEO_CAPTURE'
  | 'REP_INGEST'
  | 'REP_PROMOTE'
  | 'RECALCULATE'
  | 'REPLAY'
  | 'TIMELINE_APPEND'
  | 'INCIDENT_RESOLUTION'
  | 'GOVERNANCE'
  | 'RPC_CALL'
  | 'CACHE_ACCESS';

export type OperationalTraceSpan = {
  span_id: string;
  parent_span_id: string | null;
  type: OperationalSpanType;
  source: string;
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  status: 'running' | 'ok' | 'error';
  metadata: Record<string, unknown>;
};

export type OperationalTrace = {
  trace_id: string;
  company_id: string | null;
  employee_id: string | null;
  correlation_id: string | null;
  operation_id: string | null;
  source: string;
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  status: 'running' | 'ok' | 'error';
  error_message: string | null;
  spans: OperationalTraceSpan[];
};

const TRACE_LIMIT = 500;
const TRACE_STORE = new Map<string, OperationalTrace>();
const CORRELATION_TENANT = new Map<string, string>();
let TRACE_RETENTION_MAX = TRACE_LIMIT;
let TRACE_RETENTION_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 7;

function randomId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function trimTraceStore(): void {
  const now = Date.now();
  for (const [traceId, trace] of TRACE_STORE.entries()) {
    const age = now - Date.parse(trace.started_at);
    if (Number.isFinite(age) && age > TRACE_RETENTION_MAX_AGE_MS) {
      TRACE_STORE.delete(traceId);
    }
  }
  if (TRACE_STORE.size <= TRACE_RETENTION_MAX) return;
  const keys = Array.from(TRACE_STORE.keys());
  const overflow = TRACE_STORE.size - TRACE_RETENTION_MAX;
  for (let i = 0; i < overflow; i++) TRACE_STORE.delete(keys[i]!);
}

export function beginOperationalTrace(input: {
  trace_id?: string | null;
  company_id?: string | null;
  employee_id?: string | null;
  correlation_id?: string | null;
  operation_id?: string | null;
  source: string;
}): OperationalTrace {
  const companyId = input.company_id ?? null;
  const correlation = String(input.correlation_id ?? '').trim();
  if (correlation && companyId) {
    const existingCompany = CORRELATION_TENANT.get(correlation);
    if (existingCompany && existingCompany !== companyId) {
      throw new Error(
        `[TENANT TRACE ISOLATION FAILURE] correlation_id "${correlation}" já vinculado a outro tenant.`,
      );
    }
    CORRELATION_TENANT.set(correlation, companyId);
  }
  const trace_id = String(input.trace_id ?? '').trim() || randomId();
  const trace: OperationalTrace = {
    trace_id,
    company_id: input.company_id ?? null,
    employee_id: input.employee_id ?? null,
    correlation_id: input.correlation_id ?? null,
    operation_id: input.operation_id ?? null,
    source: input.source,
    started_at: nowIso(),
    finished_at: null,
    duration_ms: null,
    status: 'running',
    error_message: null,
    spans: [],
  };
  TRACE_STORE.set(trace_id, trace);
  recordOperationalMetric('trace_volume_growth', 1, {
    company_id: trace.company_id,
    employee_id: trace.employee_id,
    source: trace.source,
    operation_type: 'trace_begin',
  });
  trimTraceStore();
  return trace;
}

export function appendOperationalTraceSpan(input: {
  trace_id: string;
  parent_span_id?: string | null;
  type: OperationalSpanType;
  source: string;
  status?: 'running' | 'ok' | 'error';
  started_at?: string;
  finished_at?: string | null;
  metadata?: Record<string, unknown>;
}): OperationalTraceSpan | null {
  const trace = TRACE_STORE.get(input.trace_id);
  if (!trace) return null;
  const started_at = input.started_at ?? nowIso();
  const finished_at = input.finished_at ?? null;
  const duration_ms =
    finished_at != null ? Math.max(0, Date.parse(finished_at) - Date.parse(started_at)) : null;
  const span: OperationalTraceSpan = {
    span_id: randomId(),
    parent_span_id: input.parent_span_id ?? null,
    type: input.type,
    source: input.source,
    started_at,
    finished_at,
    duration_ms,
    status: input.status ?? (finished_at ? 'ok' : 'running'),
    metadata: input.metadata ?? {},
  };
  trace.spans.push(span);
  return span;
}

export function finalizeOperationalTrace(trace_id: string): OperationalTrace | null {
  const trace = TRACE_STORE.get(trace_id);
  if (!trace) return null;
  const finished_at = nowIso();
  trace.finished_at = finished_at;
  trace.duration_ms = Math.max(0, Date.parse(finished_at) - Date.parse(trace.started_at));
  trace.status = 'ok';
  operationalLog('EVENT', {
    company_id: trace.company_id,
    employee_id: trace.employee_id,
    correlation_id: trace.correlation_id,
    operation_id: trace.operation_id,
    source: trace.source,
    severity: 'info',
    lifecycle: 'trace',
    event_type: 'operational_trace_finalized',
    trace_id: trace.trace_id,
    duration_ms: trace.duration_ms,
    span_count: trace.spans.length,
  });
  return trace;
}

export function failOperationalTrace(trace_id: string, error: unknown): OperationalTrace | null {
  const trace = TRACE_STORE.get(trace_id);
  if (!trace) return null;
  const finished_at = nowIso();
  trace.finished_at = finished_at;
  trace.duration_ms = Math.max(0, Date.parse(finished_at) - Date.parse(trace.started_at));
  trace.status = 'error';
  trace.error_message = error instanceof Error ? error.message : String(error);
  operationalLog('EVENT', {
    company_id: trace.company_id,
    employee_id: trace.employee_id,
    correlation_id: trace.correlation_id,
    operation_id: trace.operation_id,
    source: trace.source,
    severity: 'error',
    lifecycle: 'trace',
    event_type: 'operational_trace_failed',
    trace_id: trace.trace_id,
    duration_ms: trace.duration_ms,
    error_message: trace.error_message,
  });
  return trace;
}

export function listOperationalTraces(limit = 100): OperationalTrace[] {
  const values = Array.from(TRACE_STORE.values());
  values.sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at));
  return values.slice(0, Math.max(1, Math.min(500, limit)));
}

export function listOperationalTracesChunked(input: {
  company_id?: string | null;
  cursor?: string | null;
  limit?: number;
}): { traces: OperationalTrace[]; nextCursor: string | null } {
  const limit = Math.max(1, Math.min(150, input.limit ?? 50));
  const all = listOperationalTraces(500).filter((trace) =>
    input.company_id ? trace.company_id === input.company_id : true,
  );
  const cursorIndex = input.cursor ? all.findIndex((trace) => trace.trace_id === input.cursor) : -1;
  const start = cursorIndex >= 0 ? cursorIndex + 1 : 0;
  const chunk = all.slice(start, start + limit);
  const next = all[start + limit];
  return { traces: chunk, nextCursor: next?.trace_id ?? null };
}

export function summarizeTraceGrowthByTenant(): Array<{ company_id: string; traces: number }> {
  const grouped = new Map<string, number>();
  for (const trace of TRACE_STORE.values()) {
    const company = String(trace.company_id ?? 'no-company');
    grouped.set(company, (grouped.get(company) ?? 0) + 1);
  }
  return Array.from(grouped.entries())
    .map(([company_id, traces]) => ({ company_id, traces }))
    .sort((a, b) => b.traces - a.traces);
}

export function validateTraceTenantIsolation(): { ok: boolean; issues: string[] } {
  const issues: string[] = [];
  for (const trace of TRACE_STORE.values()) {
    if (!trace.company_id) {
      issues.push(`trace ${trace.trace_id} sem company_id`);
    }
    if (trace.correlation_id) {
      const expected = CORRELATION_TENANT.get(trace.correlation_id);
      if (expected && trace.company_id && expected !== trace.company_id) {
        issues.push(`correlation_id ${trace.correlation_id} cruzado entre tenants`);
      }
    }
  }
  return { ok: issues.length === 0, issues };
}

export function setTraceRetentionPolicy(input: { max_entries?: number; max_age_ms?: number }): void {
  if (Number.isFinite(input.max_entries) && Number(input.max_entries) > 0) {
    TRACE_RETENTION_MAX = Math.max(100, Math.min(20_000, Math.floor(Number(input.max_entries))));
  }
  if (Number.isFinite(input.max_age_ms) && Number(input.max_age_ms) > 0) {
    TRACE_RETENTION_MAX_AGE_MS = Math.max(60_000, Math.floor(Number(input.max_age_ms)));
  }
  trimTraceStore();
}

export function purgeOldOperationalTraces(now = Date.now()): number {
  let removed = 0;
  for (const [traceId, trace] of TRACE_STORE.entries()) {
    const age = now - Date.parse(trace.started_at);
    if (Number.isFinite(age) && age > TRACE_RETENTION_MAX_AGE_MS) {
      TRACE_STORE.delete(traceId);
      removed += 1;
    }
  }
  return removed;
}
