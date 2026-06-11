import type { SupabaseClient } from '@supabase/supabase-js';
import { extractLocalCalendarDateFromIso } from '../utils/calendarUtils';
import { mapTimesheetForUI, type TimesheetUIRow } from './timesheetProcessingStatus';
import type { PendingRepPunch, RepOperationalResolutionStatus } from './timeAttendanceData';
import { observabilityConsole } from '../shared/logger/observabilityConsole';

function localYmdStartIso(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  if (!y || !m || !d) return `${ymd}T00:00:00.000Z`;
  return new Date(y, m - 1, d, 0, 0, 0, 0).toISOString();
}

function localYmdEndIso(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  if (!y || !m || !d) return `${ymd}T23:59:59.999Z`;
  return new Date(y, m - 1, d, 23, 59, 59, 999).toISOString();
}

type FetchRepPendingParams = {
  companyId: string;
  employeeId: string;
  periodStart: string;
  periodEnd: string;
};

export async function fetchRepPendingByDate(
  client: SupabaseClient,
  params: FetchRepPendingParams,
): Promise<{ count: number; byDate: Map<string, PendingRepPunch[]> }> {
  const { companyId, employeeId, periodStart, periodEnd } = params;
  const start = localYmdStartIso(periodStart);
  const end = localYmdEndIso(periodEnd);
  const { data, error } = await client
    .from('rep_punch_logs')
    .select(
      'id,resolved_user_id,data_hora,tipo_marcacao,nsr,rep_device_id,source,promotion_error_code,promotion_error_message,promotion_attempts,promotion_status,operational_resolution_status,last_promotion_attempt_at',
    )
    .eq('company_id', companyId)
    .eq('resolved_user_id', employeeId)
    .is('time_record_id', null)
    .eq('ignored', false)
    .gte('data_hora', start)
    .lte('data_hora', end)
    .order('data_hora', { ascending: true });
  if (error) throw error;

  observabilityConsole.log('[TIMESHEET QUERY]', {
    employee_id: employeeId,
    periodo: `${periodStart}..${periodEnd}`,
    batidas_encontradas: data?.length ?? 0,
    source: 'rep_punch_logs_pending',
  });

  const byDate = new Map<string, PendingRepPunch[]>();
  for (const row of data ?? []) {
    const r = row as Record<string, unknown>;
    const dh = String(r.data_hora ?? '');
    if (!dh) continue;
    const day = extractLocalCalendarDateFromIso(dh);
    if (day < periodStart.slice(0, 10) || day > periodEnd.slice(0, 10)) continue;
    const uid = String(r.resolved_user_id ?? '').trim();
    if (!uid) continue;
    const punch: PendingRepPunch = {
      id: String(r.id ?? ''),
      resolved_user_id: uid,
      data_hora: dh,
      tipo_marcacao: r.tipo_marcacao != null ? String(r.tipo_marcacao) : null,
      nsr: typeof r.nsr === 'number' ? r.nsr : r.nsr != null ? Number(r.nsr) : null,
      rep_device_id: r.rep_device_id != null ? String(r.rep_device_id) : null,
      source: r.source != null ? String(r.source) : null,
      promotion_error_code: r.promotion_error_code != null ? String(r.promotion_error_code) : null,
      promotion_error_message: r.promotion_error_message != null ? String(r.promotion_error_message) : null,
      promotion_attempts: typeof r.promotion_attempts === 'number' ? r.promotion_attempts : null,
      promotion_status: r.promotion_status != null ? String(r.promotion_status) : null,
      operational_resolution_status:
        r.operational_resolution_status != null
          ? (String(r.operational_resolution_status) as RepOperationalResolutionStatus)
          : null,
      last_promotion_attempt_at:
        r.last_promotion_attempt_at != null ? String(r.last_promotion_attempt_at) : null,
    };
    if (!byDate.has(day)) byDate.set(day, []);
    byDate.get(day)!.push(punch);
  }

  return { byDate, count: data?.length ?? 0 };
}

type FetchDailyUiParams = {
  companyId: string;
  employeeId: string;
  periodStart: string;
  periodEnd: string;
};

export type TimesheetDailyMirrorRow = TimesheetUIRow & {
  overtime_minutes?: number;
  negative_minutes?: number;
  worked_minutes?: number;
  expected_minutes?: number;
};

export async function fetchTimesheetsDailyUiByDate(
  client: SupabaseClient,
  params: FetchDailyUiParams,
): Promise<Map<string, TimesheetDailyMirrorRow>> {
  const { companyId, employeeId, periodStart, periodEnd } = params;
  const { data, error } = await client
    .from('timesheets_daily')
    .select('date, overtime_minutes, worked_minutes, expected_minutes, raw_data')
    .eq('employee_id', employeeId)
    .eq('company_id', companyId)
    .gte('date', periodStart)
    .lte('date', periodEnd);
  if (error) throw error;

  observabilityConsole.log('[TIMESHEET QUERY]', {
    employee_id: employeeId,
    periodo: `${periodStart}..${periodEnd}`,
    batidas_encontradas: data?.length ?? 0,
    source: 'timesheets_daily',
  });

  const map = new Map<string, TimesheetDailyMirrorRow>();
  for (const row of data ?? []) {
    const dateKey = String(row.date).slice(0, 10);
    const raw = (row.raw_data ?? {}) as Record<string, unknown>;
    const negativeMinutes = Math.max(0, Number(raw.negative_minutes ?? 0) || 0);
    map.set(
      dateKey,
      mapTimesheetForUI({
        raw_data: raw,
        overtime_minutes: row.overtime_minutes,
        negative_minutes: negativeMinutes,
        worked_minutes: row.worked_minutes,
        expected_minutes: row.expected_minutes,
      }),
    );
  }
  return map;
}
