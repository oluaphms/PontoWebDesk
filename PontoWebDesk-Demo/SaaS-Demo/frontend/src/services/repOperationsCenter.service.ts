import { observabilityConsole } from '../shared/logger/observabilityConsole';
/**
 * Dados agregados para o Centro operacional REP (cockpit) — filtros server-side, contagens e fila priorizada.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  extractLocalCalendarDateFromIso,
  localCalendarDayEndUtc,
  localCalendarDayStartUtc,
} from '../utils/calendarUtils';
import type { PendingRepPunch } from './timeAttendanceData';
import {
  applyRecoveryStressToOperationalHealth,
  computeRepOperationalHealth,
  evaluateOperationalDegradation,
} from '../domain/operational/health/operationalHealthEngine';
import { countOpenOperationalDeadLetters } from './operationalDeadLetter.service';
import {
  repQueueSortTier,
  severityFromRepQueueRow,
  trendFromValues,
  type OperationalSeverity,
  zombieRuleMeta,
} from '../domain/operational/ruleEngine/operationalRuleEngine';
import { listTimeAttendanceTimelinePage, type TimeAttendanceTimelineRow } from './timeAttendanceTimeline.service';
import { TimeAttendanceTimelineEventType } from './timeAttendanceTimeline.constants';
import { detectZombieRepOperationalStates, validateRepOperationalIntegrity } from './repOperationalIntegrity.service';

export type TrendArrow = 'up' | 'down' | 'flat';

export type RepOpsKpiValue = {
  value: number;
  prior: number;
  trend: TrendArrow;
};

export type RepOpsKpiBundle = {
  healthScore: number;
  pendentes: number;
  waitingReview: number;
  zombies: number;
  flow: {
    retriesToday: RepOpsKpiValue;
    promoteRecovered: RepOpsKpiValue;
    promoteFailed: RepOpsKpiValue;
    reconciledToday: RepOpsKpiValue;
    expiredToday: RepOpsKpiValue;
  };
};

export type RepOpsQueueFilters = {
  employeeId?: string | null;
  deviceId?: string | null;
  lifecycle?: string | null;
  dateFrom?: string | null;
  dateTo?: string | null;
};

export type { OperationalSeverity };

export type RepOpsQueueRow = {
  id: string;
  resolved_user_id: string;
  employee_name: string;
  data_hora: string;
  dateYmd: string;
  rep_device_id: string | null;
  device_name: string;
  nsr: number | null;
  incident: string;
  severity: OperationalSeverity;
  lifecycle: string;
  promotion_attempts: number;
  promotion_error_code?: string | null;
  last_action_at: string | null;
  last_action_label: string;
  aging_days: number;
  is_zombie: boolean;
  zombie_reason: string | null;
  sort_tier: number;
  pendingRepPunch: PendingRepPunch;
};

export type RepOpsHeatmapDevice = {
  device_id: string;
  device_name: string;
  pending: number;
  retries_sum: number;
  error_hits: number;
  zombie_hits: number;
  /** Heurística 0–1: retries/pending */
  retry_intensity: number;
};

export type RepOpsHeatmapEmployee = {
  employee_id: string;
  employee_name: string;
  pending: number;
  retries_sum: number;
  zombie_hits: number;
  fallback_hint: number;
};

const STREAM_EVENT_TYPES: string[] = [
  TimeAttendanceTimelineEventType.REP_PUNCH_RECEIVED,
  TimeAttendanceTimelineEventType.REP_PROMOTE_FAILED,
  TimeAttendanceTimelineEventType.REP_PROMOTE_RETRIED,
  TimeAttendanceTimelineEventType.REP_PROMOTE_RECOVERED,
  TimeAttendanceTimelineEventType.REP_SEQUENCE_RECONCILED,
  TimeAttendanceTimelineEventType.AUTO_FIX_TRIGGERED,
  TimeAttendanceTimelineEventType.AUTO_FIX_SKIPPED,
  TimeAttendanceTimelineEventType.AUTO_FIX_FAILED,
  TimeAttendanceTimelineEventType.INCIDENT_DETECTED,
  TimeAttendanceTimelineEventType.INCIDENT_RESOLVED,
  TimeAttendanceTimelineEventType.TIMESHEET_FALLBACK_APPLIED,
];

function localDayRangeIso(d: Date): { start: string; end: string } {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const ymd = `${y}-${m}-${day}`;
  return {
    start: localCalendarDayStartUtc(ymd),
    end: localCalendarDayEndUtc(ymd),
  };
}

function priorLocalDay(d: Date): Date {
  const x = new Date(d);
  x.setDate(x.getDate() - 1);
  return x;
}

export { trendFromValues } from '../domain/operational/ruleEngine/operationalRuleEngine';

async function countTimelineType(
  client: SupabaseClient,
  companyId: string,
  eventType: string,
  startIso: string,
  endIso: string,
): Promise<number> {
  const { count, error } = await client
    .from('time_attendance_timeline')
    .select('id', { count: 'exact', head: true })
    .eq('company_id', companyId)
    .eq('event_type', eventType)
    .gte('created_at', startIso)
    .lte('created_at', endIso);
  if (error) return 0;
  return count ?? 0;
}

async function countPendingQueue(client: SupabaseClient, companyId: string): Promise<number> {
  const { count, error } = await client
    .from('rep_punch_logs')
    .select('id', { count: 'exact', head: true })
    .eq('company_id', companyId)
    .not('resolved_user_id', 'is', null)
    .is('time_record_id', null)
    .or('ignored.is.false,ignored.is.null');
  if (error) return 0;
  return count ?? 0;
}

async function countWaitingReview(client: SupabaseClient, companyId: string): Promise<number> {
  const { count, error } = await client
    .from('rep_punch_logs')
    .select('id', { count: 'exact', head: true })
    .eq('company_id', companyId)
    .eq('operational_resolution_status', 'waiting_review')
    .is('time_record_id', null)
    .or('ignored.is.false,ignored.is.null');
  if (error) return 0;
  return count ?? 0;
}

async function countExpiredResolutionToday(
  client: SupabaseClient,
  companyId: string,
  startIso: string,
  endIso: string,
): Promise<number> {
  const { count, error } = await client
    .from('rep_punch_logs')
    .select('id', { count: 'exact', head: true })
    .eq('company_id', companyId)
    .eq('operational_resolution_status', 'expired')
    .gte('operational_resolution_at', startIso)
    .lte('operational_resolution_at', endIso);
  if (error) return 0;
  return count ?? 0;
}

/** KPIs: stock actual + fluxo do dia com tendência vs dia civil anterior (timeline / expirados). */
export async function fetchRepOpsKpiBundle(
  client: SupabaseClient,
  companyId: string,
): Promise<RepOpsKpiBundle> {
  const now = new Date();
  const t0 = localDayRangeIso(now);
  const t1 = localDayRangeIso(priorLocalDay(now));

  const [
    violations,
    zombiesToday,
    pendentes,
    waitingReview,
    r0,
    r1,
    pr0,
    pr1,
    pf0,
    pf1,
    rec0,
    rec1,
    ex0,
    ex1,
    openDlq,
  ] = await Promise.all([
    validateRepOperationalIntegrity(client, companyId),
    detectZombieRepOperationalStates(client, companyId),
    countPendingQueue(client, companyId),
    countWaitingReview(client, companyId),
    countTimelineType(client, companyId, TimeAttendanceTimelineEventType.REP_PROMOTE_RETRIED, t0.start, t0.end),
    countTimelineType(client, companyId, TimeAttendanceTimelineEventType.REP_PROMOTE_RETRIED, t1.start, t1.end),
    countTimelineType(client, companyId, TimeAttendanceTimelineEventType.REP_PROMOTE_RECOVERED, t0.start, t0.end),
    countTimelineType(client, companyId, TimeAttendanceTimelineEventType.REP_PROMOTE_RECOVERED, t1.start, t1.end),
    countTimelineType(client, companyId, TimeAttendanceTimelineEventType.REP_PROMOTE_FAILED, t0.start, t0.end),
    countTimelineType(client, companyId, TimeAttendanceTimelineEventType.REP_PROMOTE_FAILED, t1.start, t1.end),
    countTimelineType(client, companyId, TimeAttendanceTimelineEventType.REP_SEQUENCE_RECONCILED, t0.start, t0.end),
    countTimelineType(client, companyId, TimeAttendanceTimelineEventType.REP_SEQUENCE_RECONCILED, t1.start, t1.end),
    countExpiredResolutionToday(client, companyId, t0.start, t0.end),
    countExpiredResolutionToday(client, companyId, t1.start, t1.end),
    countOpenOperationalDeadLetters(client, companyId),
  ]);

  const { data: openRowsData } = await client
    .from('rep_punch_logs')
    .select('operational_resolution_status')
    .eq('company_id', companyId)
    .is('time_record_id', null)
    .or('ignored.is.false,ignored.is.null')
    .in('operational_resolution_status', ['pending', 'investigating', 'waiting_review']);

  const openRows = (openRowsData ?? []).length;
  const health = applyRecoveryStressToOperationalHealth(
    computeRepOperationalHealth({
      violationCount: violations.length,
      zombieCount: zombiesToday.length,
      waitingReviewCount: waitingReview,
      openOperationalCount: openRows,
    }),
    { openDlqCount: openDlq, orphanSampleHits: 0 },
  );

  return {
    healthScore: health.score,
    pendentes,
    waitingReview,
    zombies: zombiesToday.length,
    flow: {
      retriesToday: { value: r0, prior: r1, trend: trendFromValues(r0, r1) },
      promoteRecovered: { value: pr0, prior: pr1, trend: trendFromValues(pr0, pr1) },
      promoteFailed: { value: pf0, prior: pf1, trend: trendFromValues(pf0, pf1) },
      reconciledToday: { value: rec0, prior: rec1, trend: trendFromValues(rec0, rec1) },
      expiredToday: { value: ex0, prior: ex1, trend: trendFromValues(ex0, ex1) },
    },
  };
}

/** Fila priorizada (ordenação em memória após cap de linhas — adequado a volumes operacionais típicos). */
export async function fetchRepOpsQueuePage(
  client: SupabaseClient,
  companyId: string,
  filters: RepOpsQueueFilters,
  opts: { offset: number; limit: number; maxScan?: number },
): Promise<{
  rows: RepOpsQueueRow[];
  totalScanned: number;
  hasMore: boolean;
  heatmap: RepOpsHeatmapDevice[];
  heatmapEmployees: RepOpsHeatmapEmployee[];
}> {
  const maxScan = Math.min(4000, Math.max(200, opts.maxScan ?? 2000));
  const dateFrom = filters.dateFrom?.trim() || null;
  const dateTo = filters.dateTo?.trim() || null;
  const defaultFrom = new Date();
  defaultFrom.setDate(defaultFrom.getDate() - 60);
  const fromIso = dateFrom
    ? localCalendarDayStartUtc(dateFrom)
    : localCalendarDayStartUtc(
        `${defaultFrom.getFullYear()}-${String(defaultFrom.getMonth() + 1).padStart(2, '0')}-${String(defaultFrom.getDate()).padStart(2, '0')}`,
      );
  const toIso = dateTo ? localCalendarDayEndUtc(dateTo) : localCalendarDayEndUtc(extractLocalCalendarDateFromIso(new Date().toISOString()));

  let q = client
    .from('rep_punch_logs')
    .select(
      'id,resolved_user_id,data_hora,tipo_marcacao,nsr,rep_device_id,source,promotion_error_code,promotion_error_message,promotion_attempts,promotion_status,operational_resolution_status,last_promotion_attempt_at,operational_resolution_at,operational_resolution_by,ignored',
    )
    .eq('company_id', companyId)
    .not('resolved_user_id', 'is', null)
    .is('time_record_id', null)
    .or('ignored.is.false,ignored.is.null')
    .gte('data_hora', fromIso)
    .lte('data_hora', toIso)
    .order('data_hora', { ascending: false })
    .limit(maxScan);

  const emp = filters.employeeId?.trim();
  if (emp) q = q.eq('resolved_user_id', emp);
  const dev = filters.deviceId?.trim();
  if (dev) q = q.eq('rep_device_id', dev);
  const life = filters.lifecycle?.trim();
  if (life && life !== 'all') q = q.eq('operational_resolution_status', life);

  const { data, error } = await q;
  if (error) {
    observabilityConsole.error('[REP OPS CENTER]', { context: 'queue', message: error.message });
    return { rows: [], totalScanned: 0, hasMore: false, heatmap: [], heatmapEmployees: [] };
  }

  const raw = (data ?? []) as Record<string, unknown>[];
  const userIds = [...new Set(raw.map((r) => String(r.resolved_user_id ?? '')).filter(Boolean))];
  const deviceIds = [...new Set(raw.map((r) => String(r.rep_device_id ?? '')).filter(Boolean))];

  const [usersRes, devicesRes] = await Promise.all([
    userIds.length
      ? client.from('users').select('id,nome').eq('company_id', companyId).in('id', userIds)
      : Promise.resolve({ data: [] as { id: string; nome: string | null }[] }),
    deviceIds.length
      ? client.from('rep_devices').select('id,nome_dispositivo').eq('company_id', companyId).in('id', deviceIds)
      : Promise.resolve({ data: [] as { id: string; nome_dispositivo: string | null }[] }),
  ]);

  const nameByUser = new Map<string, string>();
  for (const u of usersRes.data ?? []) {
    nameByUser.set(u.id, u.nome?.trim() || u.id.slice(0, 8));
  }
  const nameByDev = new Map<string, string>();
  for (const d of devicesRes.data ?? []) {
    nameByDev.set(d.id, d.nome_dispositivo?.trim() || d.id.slice(0, 8));
  }

  const now = new Date();
  const mapped: RepOpsQueueRow[] = [];

  for (const r of raw) {
    const id = String(r.id ?? '');
    const uid = String(r.resolved_user_id ?? '');
    const dataHora = String(r.data_hora ?? '');
    const dateYmd = extractLocalCalendarDateFromIso(dataHora);
    const lifecycle = String(r.operational_resolution_status ?? 'pending').trim() || 'pending';
    const attempts = Number(r.promotion_attempts ?? 0) || 0;
    const code = r.promotion_error_code != null ? String(r.promotion_error_code) : null;
    const msg = r.promotion_error_message != null ? String(r.promotion_error_message).slice(0, 120) : '';
    const incident = code ? `${code}${msg ? ` — ${msg}` : ''}` : 'pendência promote';
    const agingDays = Number.isFinite(new Date(dataHora).getTime())
      ? Math.floor((now.getTime() - new Date(dataHora).getTime()) / 86_400_000)
      : 0;
    const sev = severityFromRepQueueRow(code, attempts, agingDays);
    const invAt =
      lifecycle === 'investigating' && r.operational_resolution_at != null
        ? String(r.operational_resolution_at)
        : null;
    const zm = zombieRuleMeta(lifecycle, dataHora, attempts, invAt, now);
    const lastPromo = r.last_promotion_attempt_at != null ? String(r.last_promotion_attempt_at) : null;
    const lastRes = r.operational_resolution_at != null ? String(r.operational_resolution_at) : null;
    let lastIso: string | null = null;
    if (lastPromo && lastRes) {
      lastIso = new Date(lastPromo) > new Date(lastRes) ? lastPromo : lastRes;
    } else {
      lastIso = lastPromo ?? lastRes;
    }
    const tier = repQueueSortTier(sev, lifecycle, zm.is_zombie);
    const deviceId = r.rep_device_id != null ? String(r.rep_device_id) : null;

    const pendingRepPunch: PendingRepPunch = {
      id,
      resolved_user_id: uid,
      data_hora: dataHora,
      tipo_marcacao: r.tipo_marcacao != null ? String(r.tipo_marcacao) : null,
      nsr: r.nsr != null ? Number(r.nsr) : null,
      rep_device_id: deviceId,
      source: r.source != null ? String(r.source) : null,
      promotion_error_code: code,
      promotion_error_message: r.promotion_error_message != null ? String(r.promotion_error_message) : null,
      promotion_attempts: attempts,
      promotion_status: r.promotion_status != null ? String(r.promotion_status) : null,
      operational_resolution_status: lifecycle as PendingRepPunch['operational_resolution_status'],
      last_promotion_attempt_at: lastPromo ?? undefined,
    };

    mapped.push({
      id,
      resolved_user_id: uid,
      employee_name: nameByUser.get(uid) ?? uid.slice(0, 8),
      data_hora: dataHora,
      dateYmd,
      rep_device_id: deviceId,
      device_name: deviceId ? nameByDev.get(deviceId) ?? '—' : '—',
      nsr: r.nsr != null ? Number(r.nsr) : null,
      incident,
      severity: sev,
      lifecycle,
      promotion_attempts: attempts,
      last_action_at: lastIso,
      last_action_label: lastIso
        ? new Date(lastIso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
        : '—',
      aging_days: agingDays,
      is_zombie: zm.is_zombie,
      zombie_reason: zm.reason,
      sort_tier: tier,
      pendingRepPunch,
    });
  }

  mapped.sort((a, b) => {
    if (a.sort_tier !== b.sort_tier) return a.sort_tier - b.sort_tier;
    if (a.aging_days !== b.aging_days) return b.aging_days - a.aging_days;
    return new Date(a.data_hora).getTime() - new Date(b.data_hora).getTime();
  });

  const slice = mapped.slice(opts.offset, opts.offset + opts.limit);
  const hasMore = opts.offset + opts.limit < mapped.length;
  const heatmap = buildRepOpsHeatmap(mapped);
  const heatmapEmployees = buildRepOpsHeatmapEmployees(mapped);

  return { rows: slice, totalScanned: mapped.length, hasMore, heatmap, heatmapEmployees };
}

export async function fetchPendingRepPunchesForEmployeeDay(
  client: SupabaseClient,
  companyId: string,
  employeeId: string,
  dateYmd: string,
): Promise<PendingRepPunch[]> {
  const startIso = localCalendarDayStartUtc(dateYmd);
  const endIso = localCalendarDayEndUtc(dateYmd);
  const { data, error } = await client
    .from('rep_punch_logs')
    .select(
      'id,resolved_user_id,data_hora,tipo_marcacao,nsr,rep_device_id,source,promotion_error_code,promotion_error_message,promotion_attempts,promotion_status,operational_resolution_status,last_promotion_attempt_at',
    )
    .eq('company_id', companyId)
    .eq('resolved_user_id', employeeId)
    .is('time_record_id', null)
    .or('ignored.is.false,ignored.is.null')
    .gte('data_hora', startIso)
    .lte('data_hora', endIso)
    .order('data_hora', { ascending: true });

  if (error || !data) return [];
  const out: PendingRepPunch[] = [];
  for (const row of data) {
    const r = row as Record<string, unknown>;
    out.push({
      id: String(r.id),
      resolved_user_id: String(r.resolved_user_id),
      data_hora: String(r.data_hora),
      tipo_marcacao: r.tipo_marcacao != null ? String(r.tipo_marcacao) : null,
      nsr: r.nsr != null ? Number(r.nsr) : null,
      rep_device_id: r.rep_device_id != null ? String(r.rep_device_id) : null,
      source: r.source != null ? String(r.source) : null,
      promotion_error_code: r.promotion_error_code != null ? String(r.promotion_error_code) : null,
      promotion_error_message: r.promotion_error_message != null ? String(r.promotion_error_message) : null,
      promotion_attempts: r.promotion_attempts != null ? Number(r.promotion_attempts) : null,
      promotion_status: r.promotion_status != null ? String(r.promotion_status) : null,
      operational_resolution_status: r.operational_resolution_status != null
        ? (String(r.operational_resolution_status) as PendingRepPunch['operational_resolution_status'])
        : undefined,
      last_promotion_attempt_at:
        r.last_promotion_attempt_at != null ? String(r.last_promotion_attempt_at) : undefined,
    });
  }
  return out;
}

export async function fetchRepOpsStreamPage(
  client: SupabaseClient,
  companyId: string,
  cursorCreatedAt: string | null,
  limit = 40,
): Promise<{ rows: TimeAttendanceTimelineRow[]; nextCursor: string | null }> {
  const { rows, nextCursor } = await listTimeAttendanceTimelinePage({
    companyId,
    limit: Math.min(80, limit * 2),
    cursorCreatedAt,
    supabaseClient: client,
  });
  const filtered = rows.filter((r) => STREAM_EVENT_TYPES.includes(r.event_type)).slice(0, limit);
  const next = nextCursor?.created_at ?? null;
  return { rows: filtered, nextCursor: next };
}

export async function fetchRepOpsCorrelationTimeline(
  client: SupabaseClient,
  companyId: string,
  employeeId: string,
  dateYmd: string,
): Promise<TimeAttendanceTimelineRow[]> {
  const { rows } = await listTimeAttendanceTimelinePage({
    companyId,
    employeeId,
    dateFrom: dateYmd,
    dateTo: dateYmd,
    limit: 120,
    supabaseClient: client,
  });
  return rows;
}

export async function fetchTimesheetDaySnippet(
  client: SupabaseClient,
  companyId: string,
  employeeId: string,
  dateYmd: string,
): Promise<{ raw_data: unknown } | null> {
  const { data, error } = await client
    .from('timesheets_daily')
    .select('raw_data')
    .eq('company_id', companyId)
    .eq('employee_id', employeeId)
    .eq('date', dateYmd)
    .maybeSingle();
  if (error || !data) return null;
  return { raw_data: (data as { raw_data: unknown }).raw_data };
}

export function buildRepOpsHeatmap(rows: RepOpsQueueRow[]): RepOpsHeatmapDevice[] {
  const byDev = new Map<string, RepOpsHeatmapDevice>();
  for (const r of rows) {
    const id = r.rep_device_id ?? '_sem_relógio';
    const name = r.rep_device_id ? r.device_name : 'Sem relógio';
    let cell = byDev.get(id);
    if (!cell) {
      cell = {
        device_id: id,
        device_name: name,
        pending: 0,
        retries_sum: 0,
        error_hits: 0,
        zombie_hits: 0,
        retry_intensity: 0,
      };
      byDev.set(id, cell);
    }
    cell.pending += 1;
    cell.retries_sum += r.promotion_attempts;
    if (r.promotion_attempts > 0 || r.incident !== 'pendência promote') cell.error_hits += 1;
    if (r.is_zombie) cell.zombie_hits += 1;
  }
  const out = [...byDev.values()];
  for (const c of out) {
    c.retry_intensity = c.pending > 0 ? Math.min(1, c.retries_sum / (c.pending * 5)) : 0;
  }
  out.sort((a, b) => b.pending - a.pending);
  return out.slice(0, 24);
}

export function buildRepOpsHeatmapEmployees(rows: RepOpsQueueRow[]): RepOpsHeatmapEmployee[] {
  const by = new Map<string, RepOpsHeatmapEmployee>();
  for (const r of rows) {
    let cell = by.get(r.resolved_user_id);
    if (!cell) {
      cell = {
        employee_id: r.resolved_user_id,
        employee_name: r.employee_name,
        pending: 0,
        retries_sum: 0,
        zombie_hits: 0,
        fallback_hint: 0,
      };
      by.set(r.resolved_user_id, cell);
    }
    cell.pending += 1;
    cell.retries_sum += r.promotion_attempts;
    if (r.is_zombie) cell.zombie_hits += 1;
    if (String(r.promotion_error_code ?? '').includes('closed')) cell.fallback_hint += 1;
  }
  const out = [...by.values()].sort((a, b) => b.pending - a.pending);
  return out.slice(0, 20);
}

/** @deprecated Preferir `evaluateOperationalDegradation` em `operationalHealthEngine`. */
export async function fetchRepOpsDegradationMessages(
  client: SupabaseClient,
  companyId: string,
  heatmap: RepOpsHeatmapDevice[],
  employees?: RepOpsHeatmapEmployee[],
): Promise<string[]> {
  return evaluateOperationalDegradation(
    client,
    companyId,
    heatmap.map((h) => ({
      device_name: h.device_name,
      pending: h.pending,
      retry_intensity: h.retry_intensity,
      zombie_hits: h.zombie_hits,
    })),
    employees?.map((e) => ({
      employee_name: e.employee_name,
      pending: e.pending,
      retries_sum: e.retries_sum,
      zombie_hits: e.zombie_hits,
    })),
  );
}
