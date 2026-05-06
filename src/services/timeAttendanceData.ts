/**
 * Jornada de trabalho (admin): dados alinhados ao motor — timesheets_daily + batidas em time_records.
 */

import { db, isSupabaseConfigured } from '../../services/supabaseClient';
import { insertAdminMirrorTimeRecord } from '../../services/timeRecords.service';
import { recalculate_period } from '../engine/timeEngine';
import type { RawTimeRecord } from './timeProcessingService';
import { summarizeDayRecords } from './timeProcessingService';
import {
  deriveTimesheetProcessingStatus,
  type TimesheetProcessingStatus,
} from './timesheetProcessingStatus';
import {
  deriveOperationalDisplayStatus,
  type OperationalDisplayStatus,
} from '../utils/timesheetOperationalUx';
import {
  calendarDateForEspelhoRow,
  localCalendarDayEndUtc,
  localCalendarDayStartUtc,
  logCalendarDayConsistencyDebug,
} from '../utils/calendarUtils';
import { localDateAndTimeToIsoUtc } from '../utils/localDateTimeToIso';
import { monthYearFromCivilYmd } from './timesheetClosure';

const AUTO_RECALC_DEBOUNCE_MS = 10_000;
const MAX_CONCURRENT_RECALC_PER_USER = 2;
/** Circuit breaker: após N falhas consecutivas (sem linha ou exceção), auto-fix para para este dia. */
const AUTO_RECALC_MAX_ATTEMPTS = 5;
/** Em produção, só uma fração dos logs de diagnóstico; em dev/teste, sempre. */
const AUTO_FIX_LOG_SAMPLE_RATE = 0.05;

function isRuntimeProduction(): boolean {
  try {
    if (import.meta.env.PROD === true) return true;
  } catch {
    /* import.meta indisponível (ex.: alguns runners) */
  }
  return typeof process !== 'undefined' && process.env.NODE_ENV === 'production';
}

function shouldLogTimeAttendanceAutoFix(): boolean {
  if (!isRuntimeProduction()) return true;
  return Math.random() < AUTO_FIX_LOG_SAMPLE_RATE;
}

function logTimeAttendanceAutoFixInfo(...args: Parameters<typeof console.info>): void {
  if (shouldLogTimeAttendanceAutoFix()) console.info(...args);
}

function logTimeAttendanceAutoFixWarn(...args: Parameters<typeof console.warn>): void {
  if (shouldLogTimeAttendanceAutoFix()) console.warn(...args);
}

/** Chaves `employee_id|date` pendentes na carga anterior — medir `recalc_success` na carga atual. */
let previousPendingAutoKeys = new Set<string>();

const AUTO_FIX_REAL_MOTOR_SUCCESS = new Set<OperationalDisplayStatus>(['ok', 'fallback_schedule', 'drift']);

function asRawRecordForMetrics(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  return {};
}

/**
 * Status efetivo para métricas: `raw_data.processing_status` quando presente, combinado com replay/drift
 * (replay inconsistente/error prevalece sobre `processing_status: ok`).
 */
function operationalStatusForAutoFixMetrics(raw_data: unknown): OperationalDisplayStatus {
  const raw = asRawRecordForMetrics(raw_data);
  const rp = raw.processing_status;

  let ps: TimesheetProcessingStatus = deriveTimesheetProcessingStatus({ raw_data });
  if (rp === 'ok' || rp === 'fallback_schedule' || rp === 'protected' || rp === 'skipped_invalid_employee') {
    ps = rp as TimesheetProcessingStatus;
  }
  if (rp === 'error') {
    ps = 'error';
  }

  const rsRaw = raw.last_replay_status;
  let replay_status: 'ok' | 'inconsistent' | 'drift' | 'error' | undefined =
    rsRaw === 'ok' || rsRaw === 'inconsistent' || rsRaw === 'drift' || rsRaw === 'error' ? rsRaw : undefined;
  if (rp === 'inconsistent') {
    replay_status = 'inconsistent';
  }

  const has_drift = Boolean(raw.context_drift) || rp === 'drift';

  return deriveOperationalDisplayStatus({
    processing_status: ps,
    replay_status,
    has_drift,
  });
}

function isAutoFixRealMotorSuccess(raw_data: unknown): boolean {
  if (raw_data == null) return false;
  return AUTO_FIX_REAL_MOTOR_SUCCESS.has(operationalStatusForAutoFixMetrics(raw_data));
}

export type AutoRecalcRequestOutcome =
  | 'triggered'
  | 'queued'
  | 'skipped_in_flight'
  | 'skipped_cooldown'
  | 'skipped_debounce'
  | 'skipped_circuit';

async function isTimesheetDayProtected(companyId: string, userId: string, dateYmd: string): Promise<boolean> {
  const date = String(dateYmd).slice(0, 10);
  try {
    const existing = (await db.select(
      'timesheets_daily',
      [
        { column: 'company_id', operator: 'eq', value: companyId },
        { column: 'employee_id', operator: 'eq', value: userId },
        { column: 'date', operator: 'eq', value: date },
      ],
      { columns: 'id,raw_data', limit: 1 },
    )) as { raw_data?: unknown }[];
    const first = existing?.[0];
    return !!(first && isProtectedDailyRaw(first.raw_data));
  } catch {
    return false;
  }
}

type AutoRecalcQueuedJob = {
  companyId: string;
  userId: string;
  date: string;
  gateKey: string;
};

type UserRecalcLane = {
  activeCount: number;
  queue: AutoRecalcQueuedJob[];
};

const userRecalcLaneByUserId = new Map<string, UserRecalcLane>();

function getUserRecalcLane(userId: string): UserRecalcLane {
  let lane = userRecalcLaneByUserId.get(userId);
  if (!lane) {
    lane = { activeCount: 0, queue: [] };
    userRecalcLaneByUserId.set(userId, lane);
  }
  return lane;
}

function releaseUserRecalcSlotAndDrain(userId: string, gateKey: string): void {
  const g = getAutoRecalcGate(gateKey);
  g.inFlight = false;
  const lane = getUserRecalcLane(userId);
  lane.activeCount = Math.max(0, lane.activeCount - 1);
  while (lane.queue.length > 0 && lane.activeCount < MAX_CONCURRENT_RECALC_PER_USER) {
    const next = lane.queue.shift()!;
    const gg = getAutoRecalcGate(next.gateKey);
    gg.queued = false;
    gg.inFlight = true;
    lane.activeCount++;
    void executeAutoRecalcMissingTimesheet(next.companyId, next.userId, next.date, next.gateKey);
  }
}

/** Alinha a `writeTimesheetsDailyCalculatedRow` / Portaria 671 — linha que o motor não deve sobrescrever. */
function isProtectedDailyRaw(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
  const r = raw as Record<string, unknown>;
  if (r.manual_entry === true) return true;
  if (r.status === 'closed') return true;
  return Boolean(r.manual_lock === true || r.manual_override === true);
}

function closurePeriodKey(employeeId: string, dateYmd: string): string {
  const { year, month } = monthYearFromCivilYmd(dateYmd);
  return `${employeeId}|${year}|${month}`;
}

/**
 * Fechamentos oficiais no período civil (mês/ano da data YYYY-MM-DD), em lotes por (year, month).
 */
async function loadClosedPeriodKeys(
  companyId: string,
  pendingRows: readonly { employee_id: string; date: string }[],
): Promise<Set<string>> {
  const closed = new Set<string>();
  if (!pendingRows.length) return closed;

  type Bucket = { year: number; month: number; employees: Set<string> };
  const buckets = new Map<string, Bucket>();

  for (const r of pendingRows) {
    const { year, month } = monthYearFromCivilYmd(r.date);
    if (!year || !month) continue;
    const bk = `${year}|${month}`;
    if (!buckets.has(bk)) buckets.set(bk, { year, month, employees: new Set() });
    buckets.get(bk)!.employees.add(r.employee_id);
  }

  const CHUNK = 80;
  for (const { year, month, employees } of buckets.values()) {
    const ids = Array.from(employees);
    for (let i = 0; i < ids.length; i += CHUNK) {
      const chunk = ids.slice(i, i + CHUNK);
      try {
        const found = await db.select(
          'timesheet_closures',
          [
            { column: 'company_id', operator: 'eq', value: companyId },
            { column: 'year', operator: 'eq', value: year },
            { column: 'month', operator: 'eq', value: month },
            { column: 'employee_id', operator: 'in', value: chunk },
          ],
          { columns: 'employee_id', limit: CHUNK },
        );
        for (const row of found ?? []) {
          const eid = String((row as { employee_id?: string }).employee_id ?? '').trim();
          if (eid) closed.add(`${eid}|${year}|${month}`);
        }
      } catch {
        // não bloqueia a listagem
      }
    }
  }
  return closed;
}

/** Evita reentrância, rajadas e recálculo infinito quando o motor não persiste linha (ex.: período fechado). */
type AutoRecalcGate = {
  lastStartMs: number;
  /** `recalculate_period` em execução para este dia. */
  inFlight: boolean;
  /** Aguardando slot no semáforo do usuário (fila FIFO). */
  queued: boolean;
  cooldownUntilMs: number;
  consecutiveMisses: number;
  /** Limite de tentativas automáticas antes de abrir o circuito (parar definitivamente). */
  maxAttempts: number;
};

const autoRecalcGateByKey = new Map<string, AutoRecalcGate>();

function getAutoRecalcGate(key: string): AutoRecalcGate {
  let g = autoRecalcGateByKey.get(key);
  if (!g) {
    g = {
      lastStartMs: 0,
      inFlight: false,
      queued: false,
      cooldownUntilMs: 0,
      consecutiveMisses: 0,
      maxAttempts: AUTO_RECALC_MAX_ATTEMPTS,
    };
    autoRecalcGateByKey.set(key, g);
  } else if (g.maxAttempts == null) {
    g.maxAttempts = AUTO_RECALC_MAX_ATTEMPTS;
  }
  return g;
}

/**
 * Corpo do auto-fix (proteção, motor, verificação). Sempre libera slot do semáforo por usuário no `finally`.
 */
async function executeAutoRecalcMissingTimesheet(
  companyId: string,
  userId: string,
  date: string,
  gateKey: string,
): Promise<void> {
  const g = getAutoRecalcGate(gateKey);
  logTimeAttendanceAutoFixInfo('[TIME ATTENDANCE AUTO FIX]', { user_id: userId, date, reason: 'missing_timesheet' });
  try {
    logCalendarDayConsistencyDebug({ user_id: userId, date });

    let existing: { id?: string; raw_data?: unknown }[] = [];
    try {
      existing = (await db.select(
        'timesheets_daily',
        [
          { column: 'company_id', operator: 'eq', value: companyId },
          { column: 'employee_id', operator: 'eq', value: userId },
          { column: 'date', operator: 'eq', value: date },
        ],
        { columns: 'id,raw_data', limit: 1 },
      )) as { id?: string; raw_data?: unknown }[];
    } catch {
      existing = [];
    }

    const first = existing?.[0];
    if (first && isProtectedDailyRaw(first.raw_data)) {
      logTimeAttendanceAutoFixInfo('[TIME ATTENDANCE AUTO FIX SKIPPED]', {
        user_id: userId,
        date,
        reason: 'protected_timesheet',
      });
      return;
    }

    await recalculate_period(userId, companyId, date, date);

    logCalendarDayConsistencyDebug({ user_id: userId, date });

    let hasRow = false;
    try {
      const check = await db.select(
        'timesheets_daily',
        [
          { column: 'company_id', operator: 'eq', value: companyId },
          { column: 'employee_id', operator: 'eq', value: userId },
          { column: 'date', operator: 'eq', value: date },
        ],
        { columns: 'id', limit: 1 },
      );
      hasRow = Array.isArray(check) && check.length > 0;
    } catch {
      hasRow = false;
    }

    if (!hasRow) {
      g.consecutiveMisses = Math.min(g.consecutiveMisses + 1, g.maxAttempts);
      const backoffMs = Math.min(300_000, 12_000 * g.consecutiveMisses);
      g.cooldownUntilMs = g.consecutiveMisses >= g.maxAttempts ? 0 : Date.now() + backoffMs;
      logTimeAttendanceAutoFixInfo('[TIME ATTENDANCE AUTO FIX] no_timesheet_after_recalc', {
        user_id: userId,
        date,
        consecutive_misses: g.consecutiveMisses,
        cooldown_ms: backoffMs,
      });
      if (g.consecutiveMisses >= g.maxAttempts) {
        logTimeAttendanceAutoFixInfo('[TIME ATTENDANCE AUTO FIX STOPPED]', {
          user_id: userId,
          date,
          attempts: g.consecutiveMisses,
        });
      }
    } else {
      g.consecutiveMisses = 0;
      g.cooldownUntilMs = 0;
    }
  } catch (e) {
    g.consecutiveMisses = Math.min(g.consecutiveMisses + 1, g.maxAttempts);
    const backoffMs = Math.min(300_000, 12_000 * g.consecutiveMisses);
    g.cooldownUntilMs = g.consecutiveMisses >= g.maxAttempts ? 0 : Date.now() + backoffMs;
    logTimeAttendanceAutoFixWarn('[TIME ATTENDANCE AUTO FIX] recalc_failed', {
      user_id: userId,
      date,
      message: e instanceof Error ? e.message : String(e),
      cooldown_ms: backoffMs,
    });
    if (g.consecutiveMisses >= g.maxAttempts) {
      logTimeAttendanceAutoFixInfo('[TIME ATTENDANCE AUTO FIX STOPPED]', {
        user_id: userId,
        date,
        attempts: g.consecutiveMisses,
      });
    }
  } finally {
    releaseUserRecalcSlotAndDrain(userId, gateKey);
  }
}

/**
 * Agenda `recalculate_period` por (user_id, date): debounce/cooldown por dia, no máx. 2 concorrentes por usuário; excedente enfileira (FIFO).
 */
function requestAutoRecalcMissingTimesheet(
  companyId: string,
  userId: string,
  dateYmd: string,
): AutoRecalcRequestOutcome {
  const date = String(dateYmd).slice(0, 10);
  const key = `${userId}|${date}`;
  const now = Date.now();
  const g = getAutoRecalcGate(key);

  if (g.consecutiveMisses >= g.maxAttempts) return 'skipped_circuit';
  if (g.inFlight || g.queued) return 'skipped_in_flight';
  if (now < g.cooldownUntilMs) return 'skipped_cooldown';
  if (now - g.lastStartMs < AUTO_RECALC_DEBOUNCE_MS) return 'skipped_debounce';

  g.lastStartMs = now;

  const lane = getUserRecalcLane(userId);
  if (lane.activeCount < MAX_CONCURRENT_RECALC_PER_USER) {
    g.queued = false;
    g.inFlight = true;
    lane.activeCount++;
    void executeAutoRecalcMissingTimesheet(companyId, userId, date, key);
    return 'triggered';
  }
  g.queued = true;
  g.inFlight = false;
  lane.queue.push({ companyId, userId, date, gateKey: key });
  logTimeAttendanceAutoFixInfo('[TIME ATTENDANCE AUTO FIX QUEUED]', { user_id: userId, date });
  return 'queued';
}

export type TimeAttendanceSource = 'time_records' | 'timesheets_daily';

export type TimeAttendanceRow = {
  /** Linha estável na UI: id da timesheets_daily ou chave sintética */
  id: string;
  employee_id: string;
  employee_name?: string;
  date: string;
  clock_in: string | null;
  clock_out: string | null;
  break_minutes: number;
  /** Horas líquidas vindas do motor (timesheets_daily); null se ainda não há linha calculada */
  total_hours_motor: number | null;
  processing_status: TimesheetProcessingStatus | 'pending_engine';
  /** Rótulo curto para a coluna Status */
  status_label: string;
  has_timesheet_daily: boolean;
  punch_count: number;
  /** Último instante em que o auto-fix pediu recálculo para este dia (após `getTimeAttendanceData`). */
  auto_recalc_requested_at: Date | null;
  /** Quando `cooldownUntilMs` do gate está no futuro — próxima janela de retry. */
  next_retry_at: Date | null;
  /** Gate: recálculo em execução ou na fila — usado para refresh da lista. */
  auto_recalc_in_flight: boolean;
  /** Presente quando há linha em `timesheets_daily` — métricas de sucesso real do motor. */
  raw_data?: unknown;
};

function attachAutoRecalcRowHints(row: TimeAttendanceRow): void {
  if (row.has_timesheet_daily) {
    row.auto_recalc_requested_at = null;
    row.next_retry_at = null;
    row.auto_recalc_in_flight = false;
    return;
  }
  const key = `${row.employee_id}|${row.date}`;
  const g = getAutoRecalcGate(key);
  const now = Date.now();
  row.auto_recalc_requested_at = g.lastStartMs > 0 ? new Date(g.lastStartMs) : null;
  row.next_retry_at = g.cooldownUntilMs > now ? new Date(g.cooldownUntilMs) : null;
  row.auto_recalc_in_flight = Boolean(g.inFlight || g.queued);

  if (row.status_label === 'closed_period' || row.status_label === 'protected_timesheet') {
    return;
  }
  if (g.consecutiveMisses >= g.maxAttempts) {
    row.status_label = 'erro no processamento';
    row.next_retry_at = null;
    return;
  }
  if (g.queued) {
    row.status_label = 'na fila de processamento';
    return;
  }
  if (g.inFlight) {
    row.status_label = 'recalculando';
  }
}

const AUTO_FIX_UI_RECENT_MS = 30_000;

function motorStatusBadgeClass(row: TimeAttendanceRow): string {
  if (row.processing_status === 'error') return 'text-red-600 dark:text-red-400';
  if (row.processing_status === 'pending_engine') return 'text-amber-600 dark:text-amber-400';
  if (row.processing_status === 'ok') return 'text-emerald-600 dark:text-emerald-400';
  return 'text-slate-600 dark:text-slate-300';
}

/** Rótulo + tooltip da coluna Status (auto-fix visível; com `timesheets_daily` usa só o motor). */
export function getTimeAttendanceStatusPresentation(row: TimeAttendanceRow): {
  label: string;
  tooltip?: string;
  badgeClassName: string;
} {
  if (row.has_timesheet_daily) {
    return {
      label: row.status_label,
      tooltip: undefined,
      badgeClassName: motorStatusBadgeClass(row),
    };
  }
  if (row.status_label === 'closed_period') {
    return {
      label: 'Período fechado',
      tooltip: 'Este período já foi fechado pelo RH',
      badgeClassName: 'text-slate-500 dark:text-slate-400',
    };
  }
  if (row.status_label === 'protected_timesheet') {
    return {
      label: 'Espelho bloqueado para edição',
      tooltip: 'Este dia possui ajustes manuais ou está protegido contra recálculo',
      badgeClassName: 'text-slate-500 dark:text-slate-400',
    };
  }
  if (row.status_label === 'erro no processamento') {
    return {
      label: 'erro no processamento',
      tooltip: 'Não foi possível processar automaticamente. Verifique cadastro ou regras.',
      badgeClassName: 'text-red-600 dark:text-red-400',
    };
  }
  if (row.status_label === 'na fila de processamento') {
    return {
      label: 'na fila de processamento',
      tooltip: 'Aguardando disponibilidade para recalcular',
      badgeClassName: 'text-amber-600 dark:text-amber-400',
    };
  }
  if (row.status_label === 'recalculando') {
    return {
      label: 'recalculando',
      tooltip: 'Recalculando com base nas batidas recentes',
      badgeClassName: 'text-sky-600 dark:text-sky-400',
    };
  }
  const now = Date.now();
  const nextMs = row.next_retry_at instanceof Date ? row.next_retry_at.getTime() : 0;
  if (nextMs > now) {
    const fmt = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(
      new Date(nextMs),
    );
    return {
      label: 'aguardando motor',
      tooltip: `Próxima tentativa: ${fmt}`,
      badgeClassName: 'text-amber-600 dark:text-amber-400',
    };
  }
  const reqMs = row.auto_recalc_requested_at instanceof Date ? row.auto_recalc_requested_at.getTime() : 0;
  const recentRequested = reqMs > 0 && now - reqMs < AUTO_FIX_UI_RECENT_MS;
  if (row.processing_status === 'pending_engine' && (row.auto_recalc_in_flight || recentRequested)) {
    return {
      label: 'recalculando',
      tooltip: 'Recalculando com base nas batidas recentes',
      badgeClassName: 'text-sky-600 dark:text-sky-400',
    };
  }
  return {
    label: row.status_label,
    tooltip: undefined,
    badgeClassName: motorStatusBadgeClass(row),
  };
}

function statusLabel(
  ps: TimesheetProcessingStatus | 'pending_engine',
  hasPunches: boolean,
  punchSummaryHasPair: boolean,
): string {
  if (ps === 'pending_engine') {
    if (!hasPunches) return 'Sem batidas';
    if (!punchSummaryHasPair) return 'Batidas incompletas';
    return 'Aguardando cálculo';
  }
  switch (ps) {
    case 'ok':
      return 'OK';
    case 'fallback_schedule':
      return 'Jornada padrão';
    case 'protected':
      return 'Protegido';
    case 'error':
      return 'Erro';
    case 'skipped_invalid_employee':
      return 'Referência inválida';
    default:
      return ps;
  }
}

/**
 * Carrega registros agregados por colaborador e dia no período.
 * Totais de horas vêm de `timesheets_daily` (motor); horários de entrada/saída/intervalo das batidas.
 */
export async function getTimeAttendanceData(
  companyId: string,
  startDate: string,
  endDate: string,
  employeeNameById: Map<string, string>,
): Promise<{ rows: TimeAttendanceRow[]; source: TimeAttendanceSource }> {
  if (!isSupabaseConfigured() || !companyId) {
    return { rows: [], source: 'timesheets_daily' };
  }

  const safeStart = String(startDate).slice(0, 10);
  const safeEnd = String(endDate).slice(0, 10);

  const [sheetRows, recordRows] = await Promise.all([
    db.select(
      'timesheets_daily',
      [
        { column: 'company_id', operator: 'eq', value: companyId },
        { column: 'date', operator: 'gte', value: safeStart },
        { column: 'date', operator: 'lte', value: safeEnd },
      ],
      {
        columns: 'id,employee_id,company_id,date,worked_minutes,raw_data',
        orderBy: { column: 'date', ascending: false },
        limit: 20000,
      },
    ).catch(() => [] as Record<string, unknown>[]),
    db
      .select(
        'time_records',
        [
          { column: 'company_id', operator: 'eq', value: companyId },
          { column: 'created_at', operator: 'gte', value: localCalendarDayStartUtc(safeStart) },
          { column: 'created_at', operator: 'lte', value: localCalendarDayEndUtc(safeEnd) },
        ],
        {
          columns: 'id,user_id,company_id,type,created_at,timestamp',
          orderBy: { column: 'created_at', ascending: true },
          limit: 50000,
        },
      )
      .catch(() => [] as Record<string, unknown>[]),
  ]);

  const punchesByKey = new Map<string, RawTimeRecord[]>();
  const calendarDebugLogged = new Set<string>();
  const MAX_CALENDAR_DEBUG_LOGS = 50;
  for (const r of recordRows ?? []) {
    const uid = typeof r.user_id === 'string' ? r.user_id : '';
    if (!uid) continue;
    const raw = r as RawTimeRecord;
    const day = calendarDateForEspelhoRow(raw, safeStart, safeEnd);
    if (day < safeStart || day > safeEnd) continue;
    const key = `${uid}|${day}`;
    if (calendarDebugLogged.size < MAX_CALENDAR_DEBUG_LOGS && !calendarDebugLogged.has(key)) {
      calendarDebugLogged.add(key);
      logCalendarDayConsistencyDebug({ user_id: uid, date: day });
    }
    if (!punchesByKey.has(key)) punchesByKey.set(key, []);
    punchesByKey.get(key)!.push(raw);
  }

  const rowMap = new Map<string, TimeAttendanceRow>();

  for (const s of sheetRows ?? []) {
    const employee_id = String(s.employee_id ?? '');
    const date = String(s.date ?? '').slice(0, 10);
    if (!employee_id || !date) continue;

    const key = `${employee_id}|${date}`;
    const punches = punchesByKey.get(key) ?? [];
    const summary = summarizeDayRecords(punches);
    const worked = Number(s.worked_minutes ?? 0);
    const ps = deriveTimesheetProcessingStatus({ raw_data: s.raw_data });

    rowMap.set(key, {
      id: typeof s.id === 'string' ? s.id : key,
      employee_id,
      employee_name: employeeNameById.get(employee_id),
      date,
      clock_in: summary.entrada,
      clock_out: summary.saida,
      break_minutes: summary.break_minutes,
      total_hours_motor: Number.isFinite(worked) ? worked / 60 : null,
      processing_status: ps,
      status_label: statusLabel(ps, punches.length > 0, Boolean(summary.entrada && summary.saida)),
      has_timesheet_daily: true,
      punch_count: punches.length,
      auto_recalc_requested_at: null,
      next_retry_at: null,
      auto_recalc_in_flight: false,
      raw_data: s.raw_data,
    });
  }

  for (const [key, punches] of punchesByKey) {
    if (rowMap.has(key)) continue;
    const [employee_id, date] = key.split('|');
    if (!employee_id || !date) continue;
    const summary = summarizeDayRecords(punches);
    rowMap.set(key, {
      id: key,
      employee_id,
      employee_name: employeeNameById.get(employee_id),
      date,
      clock_in: summary.entrada,
      clock_out: summary.saida,
      break_minutes: summary.break_minutes,
      total_hours_motor: null,
      processing_status: 'pending_engine',
      status_label: statusLabel('pending_engine', true, Boolean(summary.entrada && summary.saida)),
      has_timesheet_daily: false,
      punch_count: punches.length,
      auto_recalc_requested_at: null,
      next_retry_at: null,
      auto_recalc_in_flight: false,
      raw_data: undefined,
    });
  }

  const rows = Array.from(rowMap.values()).sort((a, b) => {
    const dc = b.date.localeCompare(a.date);
    if (dc !== 0) return dc;
    const na = a.employee_name ?? a.employee_id;
    const nb = b.employee_name ?? b.employee_id;
    return na.localeCompare(nb, 'pt-BR');
  });

  const source: TimeAttendanceSource =
    (sheetRows?.length ?? 0) > 0 ? 'timesheets_daily' : 'time_records';

  logTimeAttendanceAutoFixInfo('[ADMIN TIME ATTENDANCE SOURCE]', { source });

  const pendingAuto = rows.filter((r) => !r.has_timesheet_daily && r.punch_count > 0);
  const pending_days = pendingAuto.length;
  const closedKeys = await loadClosedPeriodKeys(companyId, pendingAuto);

  let recalc_blocked = 0;
  const notClosed: TimeAttendanceRow[] = [];

  for (const row of pendingAuto) {
    const ck = closurePeriodKey(row.employee_id, row.date);
    if (closedKeys.has(ck)) {
      row.status_label = 'closed_period';
      recalc_blocked++;
      logTimeAttendanceAutoFixInfo('[TIME ATTENDANCE AUTO FIX SKIPPED]', {
        user_id: row.employee_id,
        date: row.date,
        reason: 'closed_period',
      });
      continue;
    }
    notClosed.push(row);
  }

  const protectedFlags =
    notClosed.length > 0
      ? await Promise.all(
          notClosed.map((r) => isTimesheetDayProtected(companyId, r.employee_id, r.date)),
        )
      : [];
  const toRecalc: TimeAttendanceRow[] = [];
  notClosed.forEach((row, i) => {
    if (protectedFlags[i]) {
      row.status_label = 'protected_timesheet';
      recalc_blocked++;
      logTimeAttendanceAutoFixInfo('[TIME ATTENDANCE AUTO FIX SKIPPED]', {
        user_id: row.employee_id,
        date: row.date,
        reason: 'protected_timesheet',
      });
      return;
    }
    toRecalc.push(row);
  });

  let recalc_triggered = 0;
  let recalc_cooldown = 0;
  for (const row of toRecalc) {
    const outcome = requestAutoRecalcMissingTimesheet(companyId, row.employee_id, row.date);
    if (outcome === 'triggered' || outcome === 'queued') recalc_triggered++;
    else if (outcome !== 'skipped_circuit') recalc_cooldown++;
  }

  for (const k of previousPendingAutoKeys) {
    const pipe = k.indexOf('|');
    if (pipe <= 0) continue;
    const user_id = k.slice(0, pipe);
    const date = k.slice(pipe + 1);
    const row = rows.find((r) => r.employee_id === user_id && r.date === date);
    if (!row?.has_timesheet_daily) continue;
    const status = operationalStatusForAutoFixMetrics(row.raw_data);
    if (status === 'error' || status === 'inconsistent') {
      logTimeAttendanceAutoFixInfo('[TIME ATTENDANCE AUTO FIX FALSE SUCCESS]', { user_id, date, status });
    }
  }

  const recalc_success = [...previousPendingAutoKeys].filter((k) => {
    const pipe = k.indexOf('|');
    if (pipe <= 0) return false;
    const uid = k.slice(0, pipe);
    const date = k.slice(pipe + 1);
    const row = rows.find((r) => r.employee_id === uid && r.date === date);
    return Boolean(row?.has_timesheet_daily && isAutoFixRealMotorSuccess(row.raw_data));
  }).length;

  previousPendingAutoKeys = new Set(
    rows.filter((r) => !r.has_timesheet_daily && r.punch_count > 0).map((r) => `${r.employee_id}|${r.date}`),
  );

  logTimeAttendanceAutoFixInfo('[TIME ATTENDANCE AUTO FIX SUMMARY]', {
    pending_days,
    recalc_triggered,
    recalc_success,
    recalc_blocked,
    recalc_cooldown,
  });

  for (const row of rows) {
    attachAutoRecalcRowHints(row);
  }

  return { rows, source };
}

/**
 * Lançamento manual alinhado ao motor: grava sequência de batidas em `time_records` e recalcula o dia.
 * Tipos canônicos `entrada` / `intervalo_*` / `saida` (sem tipo inventado no DB).
 */
export async function submitManualAttendancePunches(params: {
  companyId: string;
  userId: string;
  dateYmd: string;
  clockInHHmm: string;
  clockOutHHmm: string;
  breakMinutes: number;
  manualReason?: string;
}): Promise<void> {
  const { companyId, userId, dateYmd, clockInHHmm, clockOutHHmm } = params;
  const reason = params.manualReason ?? 'Lançamento manual — Jornada de trabalho (admin)';

  const entradaIso = localDateAndTimeToIsoUtc(dateYmd, clockInHHmm);
  const saidaIso = localDateAndTimeToIsoUtc(dateYmd, clockOutHHmm);
  const entradaMs = new Date(entradaIso).getTime();
  const saidaMs = new Date(saidaIso).getTime();
  if (!(entradaMs < saidaMs)) {
    throw new Error('Saída deve ser após a entrada.');
  }

  const breakMs = Math.max(0, Math.round(Number(params.breakMinutes) || 0)) * 60 * 1000;
  const span = saidaMs - entradaMs;
  if (breakMs > span) {
    throw new Error('Intervalo não pode exceder o tempo entre entrada e saída.');
  }

  const batidas: Array<{ type: string; created_at: string }> = [{ type: 'entrada', created_at: entradaIso }];

  if (breakMs > 0) {
    const workBefore = (span - breakMs) / 2;
    const intSaidaMs = entradaMs + workBefore;
    const intVoltaMs = intSaidaMs + breakMs;
    batidas.push(
      { type: 'intervalo_saida', created_at: new Date(intSaidaMs).toISOString() },
      { type: 'intervalo_volta', created_at: new Date(intVoltaMs).toISOString() },
    );
  }

  batidas.push({ type: 'saida', created_at: saidaIso });

  batidas.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

  for (const row of batidas) {
    await insertAdminMirrorTimeRecord(
      {
        user_id: userId,
        type: row.type,
        created_at: row.created_at,
        manual_reason: reason,
      },
      companyId,
    );
  }

  const dateCivil = String(dateYmd).slice(0, 10);
  logCalendarDayConsistencyDebug({ user_id: userId, date: dateCivil });
  await recalculate_period(userId, companyId, dateCivil, dateCivil);
}
