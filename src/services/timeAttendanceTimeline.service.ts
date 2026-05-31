import { observabilityConsole } from '../shared/logger/observabilityConsole';
/**
 * Persistência da timeline operacional — falhas nunca interrompem o fluxo principal.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseClient } from './supabaseClient';
import type { TimeAttendanceTimelineEventTypeValue, TimeAttendanceTimelineSeverityValue } from './timeAttendanceTimeline.constants';
import { TimeAttendanceTimelineSeverity } from './timeAttendanceTimeline.constants';
import { appendOperationalTraceSpan, beginOperationalTrace, failOperationalTrace, finalizeOperationalTrace } from '../domain/operational/tracing';
import { recordOperationalMetric } from '../domain/operational/metrics';
import { operationalCircuitBreaker } from '../domain/operational/resilience';

export type AppendTimeAttendanceTimelineEventInput = {
  companyId: string;
  employeeId?: string | null;
  date?: string | null;
  eventType: TimeAttendanceTimelineEventTypeValue;
  eventSeverity?: TimeAttendanceTimelineSeverityValue;
  sourceModule?: string | null;
  sourceReferenceId?: string | null;
  payload?: Record<string, unknown>;
  createdBy?: string | null;
  /** Quando o chamador já tem cliente (ex.: worker REP). */
  supabaseClient?: SupabaseClient | null;
};

export type TimeAttendanceTimelineRow = {
  id: string;
  company_id: string;
  employee_id: string | null;
  date: string | null;
  event_type: string;
  event_severity: string;
  source_module: string | null;
  source_reference_id: string | null;
  payload: Record<string, unknown>;
  created_by: string | null;
  created_at: string;
};

function normalizeDateYmd(d: string | null | undefined): string | null {
  if (d == null || String(d).trim() === '') return null;
  return String(d).slice(0, 10);
}

/** Payload compacto para listagens (sem árvores grandes). */
export function compactTimelinePayloadForList(payload: Record<string, unknown> | null | undefined): string {
  if (!payload || typeof payload !== 'object') return '—';
  try {
    const s = JSON.stringify(payload);
    if (s.length <= 280) return s;
    return `${s.slice(0, 277)}…`;
  } catch {
    return '—';
  }
}

/**
 * Insere evento na timeline. Erros → log `[TIME ATTENDANCE TIMELINE ERROR]` apenas.
 */
export async function appendTimeAttendanceTimelineEvent(input: AppendTimeAttendanceTimelineEventInput): Promise<void> {
  const companyId = String(input.companyId ?? '').trim();
  if (!companyId) return;
  const trace = beginOperationalTrace({
    company_id: companyId,
    employee_id: input.employeeId ?? null,
    correlation_id: String(input.payload?.correlation_id ?? '') || null,
    operation_id: String(input.payload?.operation_id ?? '') || null,
    source: 'appendTimeAttendanceTimelineEvent',
  });
  const t0 = Date.now();

  const client = input.supabaseClient ?? getSupabaseClient();
  if (!client) {
    observabilityConsole.error('[TIME ATTENDANCE TIMELINE ERROR]', { reason: 'no_supabase_client', event: input.eventType });
    failOperationalTrace(trace.trace_id, 'no_supabase_client');
    return;
  }

  const row = {
    company_id: companyId,
    employee_id: input.employeeId?.trim() ? input.employeeId.trim() : null,
    date: normalizeDateYmd(input.date ?? null),
    event_type: input.eventType,
    event_severity: input.eventSeverity ?? TimeAttendanceTimelineSeverity.info,
    source_module: input.sourceModule?.trim() ? input.sourceModule.trim() : null,
    source_reference_id: input.sourceReferenceId?.trim() ? input.sourceReferenceId.trim() : null,
    payload: input.payload && typeof input.payload === 'object' ? input.payload : {},
    created_by: input.createdBy?.trim() ? input.createdBy.trim() : null,
  };

  try {
    const { error } = await operationalCircuitBreaker.execute({
      key: 'timeline_append',
      companyId,
      fn: async () => client.from('time_attendance_timeline').insert(row),
    });
    if (error) {
      observabilityConsole.error('[TIME ATTENDANCE TIMELINE ERROR]', {
        message: error.message,
        code: error.code,
        event: input.eventType,
      });
      failOperationalTrace(trace.trace_id, error.message);
      return;
    }
    const duration = Date.now() - t0;
    appendOperationalTraceSpan({
      trace_id: trace.trace_id,
      type: 'TIMELINE_APPEND',
      source: 'appendTimeAttendanceTimelineEvent',
      status: 'ok',
      finished_at: new Date().toISOString(),
      metadata: { event_type: input.eventType, duration_ms: duration },
    });
    recordOperationalMetric('timeline_throughput', 1, {
      company_id: companyId,
      employee_id: row.employee_id,
      source: row.source_module,
      operation_type: input.eventType,
    });
    recordOperationalMetric('timeline_volume_growth', 1, {
      company_id: companyId,
      employee_id: row.employee_id,
      source: row.source_module,
      operation_type: input.eventType,
    });
    finalizeOperationalTrace(trace.trace_id);
    if (typeof globalThis !== 'undefined' && globalThis.console) {
      observabilityConsole.info('[TIME ATTENDANCE TIMELINE]', {
        event: input.eventType,
        severity: row.event_severity,
        company_id: companyId,
        employee_id: row.employee_id,
        date: row.date,
      });
    }
  } catch (e) {
    observabilityConsole.error('[TIME ATTENDANCE TIMELINE ERROR]', {
      event: input.eventType,
      message: e instanceof Error ? e.message : String(e),
    });
    failOperationalTrace(trace.trace_id, e);
  }
}

/**
 * Igual a `appendTimeAttendanceTimelineEvent`, mas falha com exceção (commit transacional operacional).
 */
export async function appendTimeAttendanceTimelineEventOrThrow(input: AppendTimeAttendanceTimelineEventInput): Promise<void> {
  const companyId = String(input.companyId ?? '').trim();
  if (!companyId) throw new Error('companyId obrigatório para timeline.');

  const client = input.supabaseClient ?? getSupabaseClient();
  if (!client) throw new Error('Modo offline ativo — dados serão sincronizados depois.');

  const row = {
    company_id: companyId,
    employee_id: input.employeeId?.trim() ? input.employeeId.trim() : null,
    date: normalizeDateYmd(input.date ?? null),
    event_type: input.eventType,
    event_severity: input.eventSeverity ?? TimeAttendanceTimelineSeverity.info,
    source_module: input.sourceModule?.trim() ? input.sourceModule.trim() : null,
    source_reference_id: input.sourceReferenceId?.trim() ? input.sourceReferenceId.trim() : null,
    payload: input.payload && typeof input.payload === 'object' ? input.payload : {},
    created_by: input.createdBy?.trim() ? input.createdBy.trim() : null,
  };

  const { error } = await client.from('time_attendance_timeline').insert(row);
  if (error) {
    throw new Error(error.message || 'Falha ao inserir time_attendance_timeline.');
  }
}

export type ListTimeAttendanceTimelineParams = {
  companyId: string;
  employeeId?: string | null;
  dateFrom?: string | null;
  dateTo?: string | null;
  eventType?: string | null;
  eventSeverity?: string | null;
  sourceModule?: string | null;
  limit?: number;
  cursorCreatedAt?: string | null;
  cursorId?: string | null;
  supabaseClient?: SupabaseClient | null;
};

export type ListTimeAttendanceTimelineResult = {
  rows: TimeAttendanceTimelineRow[];
  nextCursor: { created_at: string; id: string } | null;
};

/**
 * Paginação por (created_at, id) — evita OFFSET em listas grandes.
 */
export async function listTimeAttendanceTimelinePage(
  params: ListTimeAttendanceTimelineParams,
): Promise<ListTimeAttendanceTimelineResult> {
  const companyId = String(params.companyId ?? '').trim();
  const limit = Math.min(200, Math.max(1, params.limit ?? 50));
  const client = params.supabaseClient ?? getSupabaseClient();
  if (!client || !companyId) {
    return { rows: [], nextCursor: null };
  }

  try {
    let q = client
      .from('time_attendance_timeline')
      .select(
        'id, company_id, employee_id, date, event_type, event_severity, source_module, source_reference_id, payload, created_by, created_at',
      )
      .eq('company_id', companyId)
      .order('created_at', { ascending: false })
      .limit(limit + 1);

    const emp = params.employeeId?.trim();
    if (emp) q = q.eq('employee_id', emp);

    const df = normalizeDateYmd(params.dateFrom ?? null);
    const dt = normalizeDateYmd(params.dateTo ?? null);
    if (df) q = q.gte('date', df);
    if (dt) q = q.lte('date', dt);

    const et = params.eventType?.trim();
    if (et) q = q.eq('event_type', et);

    const sev = params.eventSeverity?.trim();
    if (sev) q = q.eq('event_severity', sev);

    const mod = params.sourceModule?.trim();
    if (mod) q = q.eq('source_module', mod);

    const cAt = params.cursorCreatedAt?.trim();
    if (cAt) {
      q = q.lt('created_at', cAt);
    }

    const { data, error } = await q;
    if (error) {
      observabilityConsole.error('[TIME ATTENDANCE TIMELINE ERROR]', { message: error.message, context: 'list' });
      return { rows: [], nextCursor: null };
    }

    const scopedList = ((data ?? []) as TimeAttendanceTimelineRow[]).filter((row) => row.company_id === companyId);
    if (scopedList.length !== (data ?? []).length) {
      observabilityConsole.error('[TENANT ISOLATION FAILURE]', {
        context: 'timeline_page',
        requested_company_id: companyId,
        leaked_rows: (data ?? []).length - scopedList.length,
      });
    }
    const list = scopedList;
    const page = list.slice(0, limit);
    const extra = list.length > limit ? list[limit] : null;
    const nextCursor =
      extra && extra.created_at ? { created_at: extra.created_at, id: extra.id } : null;

    return { rows: page, nextCursor };
  } catch (e) {
    observabilityConsole.error('[TIME ATTENDANCE TIMELINE ERROR]', {
      context: 'list_exception',
      message: e instanceof Error ? e.message : String(e),
    });
    return { rows: [], nextCursor: null };
  }
}
