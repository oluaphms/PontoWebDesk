/**
 * Jornada de trabalho (admin): dados alinhados ao motor — timesheets_daily + batidas em time_records.
 */

import { db, isSupabaseConfigured, supabase } from '../../services/supabaseClient';
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
  extractLocalCalendarDateFromIso,
  localCalendarDayEndUtc,
  localCalendarDayStartUtc,
  logCalendarDayConsistencyDebug,
} from '../utils/calendarUtils';
import { localDateAndTimeToIsoUtc } from '../utils/localDateTimeToIso';
import { monthYearFromCivilYmd } from './timesheetClosure';
import { appendTimeAttendanceTimelineEvent } from './timeAttendanceTimeline.service';
import {
  TimeAttendanceTimelineEventType,
  TimeAttendanceTimelineSeverity,
} from './timeAttendanceTimeline.constants';

const AUTO_RECALC_DEBOUNCE_MS = 10_000;
/** Teto de disparos de recálculo por carregamento da lista (evita rajada de RPC). */
const AUTO_RECALC_MAX_PER_LOAD = 20;
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
  | 'skipped_circuit'
  | 'skipped_load_budget';

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
  void appendTimeAttendanceTimelineEvent({
    companyId,
    employeeId: userId,
    date,
    eventType: TimeAttendanceTimelineEventType.AUTO_FIX_TRIGGERED,
    eventSeverity: TimeAttendanceTimelineSeverity.info,
    sourceModule: 'timeAttendanceData.executeAutoRecalcMissingTimesheet',
    payload: { reason: 'missing_timesheet' },
  });
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
      void appendTimeAttendanceTimelineEvent({
        companyId,
        employeeId: userId,
        date,
        eventType: TimeAttendanceTimelineEventType.AUTO_FIX_SKIPPED,
        eventSeverity: TimeAttendanceTimelineSeverity.low,
        sourceModule: 'timeAttendanceData.executeAutoRecalcMissingTimesheet',
        payload: { reason: 'protected_timesheet' },
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
        void appendTimeAttendanceTimelineEvent({
          companyId,
          employeeId: userId,
          date,
          eventType: TimeAttendanceTimelineEventType.AUTO_FIX_FAILED,
          eventSeverity: TimeAttendanceTimelineSeverity.medium,
          sourceModule: 'timeAttendanceData.executeAutoRecalcMissingTimesheet',
          payload: { reason: 'no_timesheet_after_recalc', attempts: g.consecutiveMisses },
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
    void appendTimeAttendanceTimelineEvent({
      companyId,
      employeeId: userId,
      date,
      eventType: TimeAttendanceTimelineEventType.AUTO_FIX_FAILED,
      eventSeverity: TimeAttendanceTimelineSeverity.high,
      sourceModule: 'timeAttendanceData.executeAutoRecalcMissingTimesheet',
      payload: {
        reason: 'recalc_exception',
        message: e instanceof Error ? e.message : String(e),
        attempts: g.consecutiveMisses,
      },
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

/** Evidência REP ainda não promovida para `time_records` — não entra no motor nem em horas. */
export type RepOperationalResolutionStatus =
  | 'pending'
  | 'investigating'
  | 'waiting_review'
  | 'reconciled'
  | 'ignored'
  | 'expired';

export type PendingRepPunch = {
  id: string;
  resolved_user_id: string;
  data_hora: string;
  tipo_marcacao: string | null;
  nsr: number | null;
  rep_device_id: string | null;
  source: string | null;
  promotion_error_code: string | null;
  promotion_error_message: string | null;
  promotion_attempts: number | null;
  promotion_status: string | null;
  operational_resolution_status?: RepOperationalResolutionStatus | null;
  last_promotion_attempt_at?: string | null;
};

export type PendingRepPunchOperationalStatus =
  | 'sequence_error'
  | 'awaiting_reconciliation'
  | 'awaiting_promote'
  | 'closed_period'
  | 'protected';

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
  /** Batidas em `rep_punch_logs` com colaborador resolvido e sem `time_record` — só evidência operacional. */
  pending_rep_punches?: PendingRepPunch[];
  pending_rep_punch_count?: number;
  has_pending_rep_punches?: boolean;
  pending_rep_punch_status?: PendingRepPunchOperationalStatus | null;
};

/** Batida REP que ainda pode ser tratada pela reconciliação assistida (sequência inválida). */
export function isRepPunchEligibleForAssistedSequenceReconciliation(p: PendingRepPunch): boolean {
  if (p.promotion_error_code !== 'invalid_sequence') return false;
  const st = p.operational_resolution_status ?? 'pending';
  return st === 'pending' || st === 'investigating' || st === 'waiting_review';
}

/** Linha de espelho/jornada com falha de sequência no promote e pelo menos uma batida elegível. */
export function rowEligibleForAssistedRepReconciliation(row: TimeAttendanceRow): boolean {
  if (row.status_label !== 'pending_rep_sequence') return false;
  return row.pending_rep_punches?.some(isRepPunchEligibleForAssistedSequenceReconciliation) ?? false;
}

/**
 * Ordem determinística (maior vence) — fonte única de prioridade.
 * duplicate_user_day > inconsistent_data > erro > closed > protegido > recalc fila > pending > fallback/jornada padrão > ok
 */
const STATUS_PRIORITY: Record<string, number> = {
  duplicate_user_day: 100,
  inconsistent_data: 90,
  'erro no processamento': 82,
  Erro: 82,
  pending_rep_sequence: 81,
  pending_rep_promote: 77,
  pending_rep_closed_period: 75,
  closed_period: 74,
  protected_timesheet: 68,
  pending_rep_protected: 67,
  Protegido: 68,
  recalculando: 62,
  'na fila de processamento': 56,
  pending_engine: 50,
  'Aguardando cálculo': 48,
  'Batidas incompletas': 48,
  'Sem batidas': 48,
  fallback_schedule: 40,
  'Jornada padrão': 40,
  'Referência inválida': 35,
  ok: 10,
};

/** Somente chaves de `STATUS_PRIORITY` podem ser aplicadas via `safeApplyStatus` (blindagem). */
const VALID_STATUS = new Set(Object.keys(STATUS_PRIORITY));

/** Rótulos vindos do motor/UI — mesmo ranque que `ok` / `fallback_schedule` quando aplicável. */
const STATUS_PRIORITY_ALIASES: Record<string, number> = {
  OK: 10,
};

function statusPriorityRank(label: string): number {
  const k = String(label ?? '').trim();
  if (!k) return 0;
  if (STATUS_PRIORITY[k] != null) return STATUS_PRIORITY[k]!;
  if (STATUS_PRIORITY_ALIASES[k] != null) return STATUS_PRIORITY_ALIASES[k]!;
  return 0;
}

/** Somente uso interno de `safeApplyStatus` — não chamar direto (hard lock). */
function applyStatusWithPriority(row: TimeAttendanceRow, newStatus: string): void {
  const next = String(newStatus).trim();
  if (!next) return;
  const pNew = statusPriorityRank(next);
  const pCur = statusPriorityRank(row.status_label);
  if (pNew > pCur) row.status_label = next;
}

type SafeApplyStatusOptions = {
  /** `duplicate_user_day` deve sobrescrever qualquer outro status (duplicidade crítica). */
  forceOverride?: boolean;
};

/**
 * Única entrada permitida para alterar `status_label` por código interno.
 * `applyStatusWithPriority` não deve ser usado fora daqui.
 */
function safeApplyStatus(row: TimeAttendanceRow, status: string, options?: SafeApplyStatusOptions): void {
  const s = String(status).trim();
  if (!VALID_STATUS.has(s)) {
    console.error('[TIME ATTENDANCE UNKNOWN STATUS]', { context: 'safeApplyStatus', status: s });
    return;
  }
  if (options?.forceOverride === true && s === 'duplicate_user_day') {
    row.status_label = s;
    return;
  }
  applyStatusWithPriority(row, s);
}

/** Chave estável: employee_id|date (YYYY-MM-DD). */
function employeeDayKey(row: Pick<TimeAttendanceRow, 'employee_id' | 'date'>): string {
  return `${row.employee_id}|${String(row.date).slice(0, 10)}`;
}

function collectDuplicateEmployeeDayKeys(rows: readonly TimeAttendanceRow[]): Set<string> {
  const counts = new Map<string, number>();
  for (const r of rows) {
    const k = employeeDayKey(r);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const dup = new Set<string>();
  for (const [k, n] of counts.entries()) {
    if (n > 1) dup.add(k);
  }
  return dup;
}

function markDuplicateUserDayOnRows(rows: readonly TimeAttendanceRow[], dupKeys: ReadonlySet<string>): void {
  for (const k of dupKeys) {
    const list = rows.filter((r) => employeeDayKey(r) === k);
    if (list.length <= 1) continue;
    for (const row of list) {
      console.warn('[TIME ATTENDANCE DUPLICATE USER DAY]', {
        employee_id: row.employee_id,
        date: row.date,
        records: row.punch_count,
        duplicate_group_size: list.length,
        key: k,
      });
      safeApplyStatus(row, 'duplicate_user_day', { forceOverride: true });
    }
  }
}

async function fetchPendingRepPunchLogsForPeriod(
  companyId: string,
  safeStart: string,
  safeEnd: string,
): Promise<PendingRepPunch[]> {
  if (!isSupabaseConfigured() || !companyId?.trim()) return [];
  try {
    const startIso = localCalendarDayStartUtc(safeStart);
    const endIso = localCalendarDayEndUtc(safeEnd);
    const { data, error } = await supabase
      .from('rep_punch_logs')
      .select(
        'id,resolved_user_id,data_hora,tipo_marcacao,nsr,rep_device_id,source,promotion_error_code,promotion_error_message,promotion_attempts,promotion_status,operational_resolution_status,last_promotion_attempt_at',
      )
      .eq('company_id', companyId.trim())
      .not('resolved_user_id', 'is', null)
      .is('time_record_id', null)
      .eq('ignored', false)
      .gte('data_hora', startIso)
      .lte('data_hora', endIso)
      .order('data_hora', { ascending: true })
      .limit(8000);
    if (error) {
      console.warn('[TIME ATTENDANCE REP PENDING FETCH]', error.message);
      return [];
    }
    const out: PendingRepPunch[] = [];
    for (const row of data ?? []) {
      const r = row as Record<string, unknown>;
      const uid = String(r.resolved_user_id ?? '').trim();
      if (!uid) continue;
      const dh = String(r.data_hora ?? '');
      if (!dh) continue;
      const day = extractLocalCalendarDateFromIso(dh);
      if (day < safeStart || day > safeEnd) continue;
      out.push({
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
      });
    }
    return out;
  } catch (e) {
    console.warn('[TIME ATTENDANCE REP PENDING FETCH]', e);
    return [];
  }
}

/** Batidas REP ainda pendentes num dia/colaborador (para modais / incidentes). */
export async function fetchPendingRepPunchesForEmployeeDay(
  companyId: string,
  employeeId: string,
  dateYmd: string,
): Promise<PendingRepPunch[]> {
  const day = String(dateYmd).slice(0, 10);
  const list = await fetchPendingRepPunchLogsForPeriod(companyId, day, day);
  return list.filter((p) => p.resolved_user_id === employeeId);
}

function groupPendingRepByEmployeeDay(
  punches: PendingRepPunch[],
  safeStart: string,
  safeEnd: string,
): Map<string, PendingRepPunch[]> {
  const m = new Map<string, PendingRepPunch[]>();
  for (const p of punches) {
    const day = extractLocalCalendarDateFromIso(p.data_hora);
    if (day < safeStart || day > safeEnd) continue;
    const key = `${p.resolved_user_id}|${day}`;
    if (!m.has(key)) m.set(key, []);
    m.get(key)!.push(p);
  }
  return m;
}

function applyPendingRepEvidenceToRow(row: TimeAttendanceRow): void {
  const pending = row.pending_rep_punches;
  if (!pending?.length) return;
  row.pending_rep_punch_count = pending.length;
  row.has_pending_rep_punches = true;

  const codes = pending.map((p) => p.promotion_error_code).filter((c): c is string => Boolean(c && String(c).trim()));
  const hasProtected = codes.some((c) => c === 'protected_timesheet');
  const hasClosed = codes.some((c) => c === 'closed_period');
  const hasSeq =
    codes.some((c) => c === 'invalid_sequence') ||
    pending.some((p) => p.promotion_status === 'pending_sequence_resolution');
  const hasOtherErr = codes.some(
    (c) => c !== 'invalid_sequence' && c !== 'closed_period' && c !== 'protected_timesheet',
  );

  if (hasProtected) {
    row.pending_rep_punch_status = 'protected';
    safeApplyStatus(row, 'pending_rep_protected');
    return;
  }
  if (hasClosed) {
    row.pending_rep_punch_status = 'closed_period';
    safeApplyStatus(row, 'pending_rep_closed_period');
    return;
  }
  if (hasSeq) {
    row.pending_rep_punch_status = 'awaiting_reconciliation';
    safeApplyStatus(row, 'pending_rep_sequence');
    return;
  }
  if (hasOtherErr) {
    row.pending_rep_punch_status = 'sequence_error';
    safeApplyStatus(row, 'pending_rep_sequence');
    return;
  }
  row.pending_rep_punch_status = 'awaiting_promote';
  safeApplyStatus(row, 'pending_rep_promote');
}

function buildSyntheticRepPendingOnlyRow(
  employee_id: string,
  date: string,
  pending: PendingRepPunch[],
  employeeNameById: Map<string, string>,
): TimeAttendanceRow {
  const row: TimeAttendanceRow = {
    id: `rep-pending|${employee_id}|${date}`,
    employee_id,
    employee_name: employeeNameById.get(employee_id),
    date,
    clock_in: null,
    clock_out: null,
    break_minutes: 0,
    total_hours_motor: null,
    processing_status: 'pending_engine',
    status_label: 'Sem batidas',
    has_timesheet_daily: false,
    punch_count: 0,
    auto_recalc_requested_at: null,
    next_retry_at: null,
    auto_recalc_in_flight: false,
    pending_rep_punches: pending,
  };
  applyPendingRepEvidenceToRow(row);
  return row;
}

function mergeRepPendingEvidenceIntoRows(
  rows: TimeAttendanceRow[],
  byKey: Map<string, PendingRepPunch[]>,
  employeeNameById: Map<string, string>,
  safeStart: string,
  safeEnd: string,
): TimeAttendanceRow[] {
  if (byKey.size === 0) return rows;
  const index = new Map<string, TimeAttendanceRow>();
  for (const r of rows) {
    index.set(`${r.employee_id}|${String(r.date).slice(0, 10)}`, r);
  }
  const extra: TimeAttendanceRow[] = [];
  for (const [key, pending] of byKey) {
    if (!pending.length) continue;
    const existing = index.get(key);
    if (existing) {
      existing.pending_rep_punches = pending;
      applyPendingRepEvidenceToRow(existing);
      continue;
    }
    const pipe = key.indexOf('|');
    if (pipe <= 0) continue;
    const employee_id = key.slice(0, pipe);
    const date = key.slice(pipe + 1);
    if (date < safeStart || date > safeEnd) continue;
    extra.push(buildSyntheticRepPendingOnlyRow(employee_id, date, pending, employeeNameById));
  }
  if (!extra.length) return rows;
  return [...rows, ...extra];
}

function logRepPendingSummary(rows: TimeAttendanceRow[]): void {
  const byDay = new Map<string, { pending: number; errors: string[] }>();
  for (const r of rows) {
    if (!r.pending_rep_punch_count) continue;
    const k = `${r.employee_id}|${r.date.slice(0, 10)}`;
    const errs =
      r.pending_rep_punches?.map((p) => p.promotion_error_code).filter((c): c is string => Boolean(c)) ?? [];
    byDay.set(k, { pending: r.pending_rep_punch_count, errors: errs });
  }
  if (byDay.size === 0) return;
  for (const [key, v] of byDay) {
    const pipe = key.indexOf('|');
    const employee_id = pipe > 0 ? key.slice(0, pipe) : key;
    const date = pipe > 0 ? key.slice(pipe + 1) : '';
    console.info('[TIME ATTENDANCE REP PENDING]', {
      employee_id,
      date,
      pending_count: v.pending,
      promote_errors: v.errors.length ? [...new Set(v.errors)] : [],
    });
  }
}

/** Minutos trabalhados segundo o motor (`timesheets_daily`); 0 se ainda sem total oficial. */
function workedMinutesFromRow(row: TimeAttendanceRow): number {
  if (row.total_hours_motor == null || !Number.isFinite(row.total_hours_motor)) return 0;
  return Math.round(row.total_hours_motor * 60);
}

/**
 * Integridade motor × batidas antes da apresentação: não altera horas; só status via `safeApplyStatus`.
 */
export function deriveIntegrityStatus(row: TimeAttendanceRow): void {
  if (row.has_pending_rep_punches && row.punch_count === 0 && workedMinutesFromRow(row) === 0) {
    return;
  }
  const workedMin = workedMinutesFromRow(row);
  if (workedMin > 0 && row.punch_count === 0) {
    console.warn('[TIME ATTENDANCE MOTOR WITHOUT PUNCHES]', {
      user_id: row.employee_id,
      date: row.date,
      worked_minutes: workedMin,
      has_timesheet_daily: row.has_timesheet_daily,
    });
    return;
  }
  if (workedMin > 0 && row.punch_count > 0) {
    const noInOut = !row.clock_in && !row.clock_out;
    const inNoOutPast = Boolean(row.clock_in && !row.clock_out && isPastDay(row.date));
    if (noInOut || inNoOutPast) {
      console.warn('[TIME ATTENDANCE INCONSISTENT]', {
        user_id: row.employee_id,
        date: row.date,
        worked_minutes: workedMin,
        punch_count: row.punch_count,
        first_in: row.clock_in,
        last_out: row.clock_out,
      });
      safeApplyStatus(row, 'inconsistent_data');
    }
  }
}

function sortRowsByDateAndName(rows: TimeAttendanceRow[]): TimeAttendanceRow[] {
  return [...rows].sort((a, b) => {
    const dc = b.date.localeCompare(a.date);
    if (dc !== 0) return dc;
    const na = a.employee_name ?? a.employee_id;
    const nb = b.employee_name ?? b.employee_id;
    return na.localeCompare(nb, 'pt-BR');
  });
}

/**
 * Colapsa linhas duplicadas (mesmo colaborador + dia). Mantém a de maior `punch_count`, depois maior minutos do motor.
 * Emite log obrigatório e marca `duplicate_user_day` na linha mantida.
 */
export function dedupeRowsByEmployeeAndDate(rows: TimeAttendanceRow[]): {
  rows: TimeAttendanceRow[];
  discardedDuplicateRows: TimeAttendanceRow[];
} {
  const byKey = new Map<string, TimeAttendanceRow[]>();
  for (const r of rows) {
    const k = employeeDayKey(r);
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k)!.push(r);
  }
  const out: TimeAttendanceRow[] = [];
  const discardedDuplicateRows: TimeAttendanceRow[] = [];
  for (const [k, list] of byKey) {
    if (list.length === 1) {
      out.push(list[0]!);
      continue;
    }
    const sorted = [...list].sort((a, b) => {
      const pc = b.punch_count - a.punch_count;
      if (pc !== 0) return pc;
      const wa = workedMinutesFromRow(a);
      const wb = workedMinutesFromRow(b);
      if (wb !== wa) return wb - wa;
      return String(b.id).localeCompare(String(a.id));
    });
    const keeper = sorted[0]!;
    safeApplyStatus(keeper, 'duplicate_user_day', { forceOverride: true });
    out.push(keeper);
    discardedDuplicateRows.push(...sorted.slice(1));
    console.warn('[TIME ATTENDANCE DEDUP APPLIED]', {
      key: k,
      kept_id: keeper.id,
      discarded_count: sorted.length - 1,
    });
  }
  return { rows: sortRowsByDateAndName(out), discardedDuplicateRows };
}

function isKnownPresentationStatusLabel(label: string): boolean {
  const k = String(label ?? '').trim();
  if (!k) return false;
  if (VALID_STATUS.has(k)) return true;
  return STATUS_PRIORITY_ALIASES[k] != null;
}

function coerceUnknownStatusLabel(row: TimeAttendanceRow): void {
  const k = String(row.status_label ?? '').trim();
  if (isKnownPresentationStatusLabel(k)) return;
  console.error('[TIME ATTENDANCE UNKNOWN STATUS]', {
    status: k || '(vazio)',
    employee_id: row.employee_id,
    date: row.date,
  });
  safeApplyStatus(row, 'erro no processamento');
}

/** Para switches exhaustivos: registra status não mapeado sem interromper o fluxo. */
export function assertNeverStatus(value: never): void {
  console.error('[TIME ATTENDANCE UNKNOWN STATUS]', { branch: 'assertNeverStatus', value: value as string });
}

/** Entrada/saída exibidas como HH:mm — ordem lexicográfica é válida para o mesmo dia civil. */
export function hasValidClockWindow(firstIn: string | null, lastOut: string | null): boolean {
  if (!firstIn || !lastOut) return false;
  return firstIn < lastOut;
}

function attachAutoRecalcRowHints(row: TimeAttendanceRow): void {
  if (row.has_timesheet_daily) {
    row.auto_recalc_requested_at = null;
    row.next_retry_at = null;
    row.auto_recalc_in_flight = false;
    return;
  }
  if (row.has_pending_rep_punches && row.punch_count === 0) {
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

  if (row.status_label === 'duplicate_user_day') {
    return;
  }
  if (row.status_label === 'closed_period' || row.status_label === 'protected_timesheet') {
    return;
  }
  if (g.consecutiveMisses >= g.maxAttempts) {
    safeApplyStatus(row, 'erro no processamento');
    row.next_retry_at = null;
    return;
  }
  if (g.queued) {
    safeApplyStatus(row, 'na fila de processamento');
    return;
  }
  if (g.inFlight) {
    safeApplyStatus(row, 'recalculando');
  }
}

const AUTO_FIX_UI_RECENT_MS = 30_000;

function getTodayLocalYmd(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function isPastDay(date: string): boolean {
  return String(date).slice(0, 10) < getTodayLocalYmd();
}

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
  if (row.status_label === 'pending_rep_sequence') {
    return {
      label: 'REP — reconciliação',
      tooltip:
        'Batidas do relógio recebidas, mas ainda não promovidas para o espelho devido à sequência operacional ou outra regra de promoção.',
      badgeClassName: 'text-amber-600 dark:text-amber-400',
    };
  }
  if (row.status_label === 'pending_rep_promote') {
    return {
      label: 'REP — aguardando espelho',
      tooltip: 'Batidas do REP aguardando consolidação no espelho.',
      badgeClassName: 'text-amber-600 dark:text-amber-400',
    };
  }
  if (row.status_label === 'pending_rep_closed_period') {
    return {
      label: 'REP — período fechado',
      tooltip: 'Promoção ao espelho bloqueada: período fechado.',
      badgeClassName: 'text-slate-500 dark:text-slate-400',
    };
  }
  if (row.status_label === 'pending_rep_protected') {
    return {
      label: 'REP — espelho protegido',
      tooltip: 'Promoção ao espelho bloqueada: registo protegido (Portaria / folha).',
      badgeClassName: 'text-slate-500 dark:text-slate-400',
    };
  }
  if (row.status_label === 'duplicate_user_day') {
    return {
      label: 'Duplicidade de registros',
      tooltip: 'Mais de um conjunto de batidas encontrado para o mesmo colaborador no dia',
      badgeClassName: 'text-orange-500',
    };
  }
  if (row.status_label === 'inconsistent_data') {
    return {
      label: 'Dados inconsistentes',
      tooltip: 'O motor calculou horas, mas as batidas não foram localizadas corretamente.',
      badgeClassName: 'text-red-500',
    };
  }
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

/** Detalhe curto para exportação (ex.: CSV) — evita ambiguidade no RH. */
export function getTimeAttendanceStatusDetail(row: TimeAttendanceRow): string {
  if (row.status_label === 'duplicate_user_day') {
    return 'Mais de um registro encontrado. Verificar duplicidade ou erro de identificação.';
  }
  if (row.status_label === 'inconsistent_data') {
    return 'Horas calculadas sem batidas completas. Pode indicar falha de captura ou sincronização.';
  }
  if (row.status_label === 'pending_rep_sequence') {
    const n = row.pending_rep_punch_count ?? 0;
    return `Evidência REP: ${n} batida(s) na fila sem espelho (sequência/regra de promoção). Não entra no motor até consolidar.`;
  }
  if (row.status_label === 'pending_rep_promote') {
    const n = row.pending_rep_punch_count ?? 0;
    return `Evidência REP: ${n} batida(s) aguardando promoção ao espelho.`;
  }
  if (row.status_label === 'pending_rep_closed_period') {
    return 'Batidas REP na fila; promoção bloqueada por período fechado.';
  }
  if (row.status_label === 'pending_rep_protected') {
    return 'Batidas REP na fila; promoção bloqueada por espelho protegido.';
  }
  return '';
}

/**
 * Auto-recalc só quando há batidas suficientes, janela válida, motor sem horas positivas e cenário não bloqueado.
 */
export function rowEligibleForAutoRecalc(
  row: TimeAttendanceRow,
  duplicateDayKeys: ReadonlySet<string>,
): boolean {
  if (duplicateDayKeys.has(employeeDayKey(row)) || row.status_label === 'duplicate_user_day') return false;
  if (
    row.status_label === 'pending_rep_sequence' ||
    row.status_label === 'pending_rep_promote' ||
    row.status_label === 'pending_rep_closed_period' ||
    row.status_label === 'pending_rep_protected'
  ) {
    return false;
  }
  if (row.status_label === 'closed_period' || row.status_label === 'protected_timesheet') return false;
  if (row.status_label === 'inconsistent_data') return false;
  if (row.processing_status === 'fallback_schedule') return false;
  if (!hasValidClockWindow(row.clock_in, row.clock_out)) return false;
  if (row.punch_count < 2) return false;
  if (workedMinutesFromRow(row) > 0) return false;
  return true;
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

  const [sheetRows, recordRows, repPendingFlat] = await Promise.all([
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
    fetchPendingRepPunchLogsForPeriod(companyId, safeStart, safeEnd),
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

  const sheetsByKey = new Map<string, Record<string, unknown>[]>();
  for (const s of sheetRows ?? []) {
    const employee_id = String(s.employee_id ?? '');
    const date = String(s.date ?? '').slice(0, 10);
    if (!employee_id || !date) continue;
    const key = `${employee_id}|${date}`;
    if (!sheetsByKey.has(key)) sheetsByKey.set(key, []);
    sheetsByKey.get(key)!.push(s as Record<string, unknown>);
  }

  const rowMap = new Map<string, TimeAttendanceRow>();

  for (const [key, sheetList] of sheetsByKey) {
    const punches = punchesByKey.get(key) ?? [];
    const summary = summarizeDayRecords(punches);
    let primarySheet = sheetList[0]!;
    if (sheetList.length > 1) {
      const scored = sheetList.map((sh) => ({
        sh,
        worked: Number(sh.worked_minutes ?? 0) || 0,
      }));
      scored.sort((a, b) => {
        if (b.worked !== a.worked) return b.worked - a.worked;
        return String(b.sh.id ?? '').localeCompare(String(a.sh.id ?? ''));
      });
      primarySheet = scored[0]!.sh;
      console.warn('[TIME ATTENDANCE DEDUP APPLIED]', {
        key,
        kept_id: primarySheet.id,
        discarded_count: sheetList.length - 1,
      });
    }

    const s = primarySheet;
    const employee_id = String(s.employee_id ?? '');
    const date = String(s.date ?? '').slice(0, 10);
    const worked = Number(s.worked_minutes ?? 0);
    const ps = deriveTimesheetProcessingStatus({ raw_data: s.raw_data });

    const row: TimeAttendanceRow = {
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
    };

    if (sheetList.length > 1) {
      safeApplyStatus(row, 'duplicate_user_day', { forceOverride: true });
    }

    rowMap.set(key, row);
  }

  for (const [key, punches] of punchesByKey) {
    if (rowMap.has(key)) continue;
    const pipe = key.indexOf('|');
    if (pipe <= 0) continue;
    const employee_id = key.slice(0, pipe);
    const date = key.slice(pipe + 1);
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

  let rows = sortRowsByDateAndName(Array.from(rowMap.values()));
  const sheetDedupPass = dedupeRowsByEmployeeAndDate(rows);
  rows = sheetDedupPass.rows;
  void sheetDedupPass.discardedDuplicateRows;

  const repPendingByKey = groupPendingRepByEmployeeDay(repPendingFlat, safeStart, safeEnd);
  rows = sortRowsByDateAndName(
    mergeRepPendingEvidenceIntoRows(rows, repPendingByKey, employeeNameById, safeStart, safeEnd),
  );
  logRepPendingSummary(rows);

  for (const row of rows) {
    deriveIntegrityStatus(row);
  }

  const duplicateDayKeys = collectDuplicateEmployeeDayKeys(rows);
  markDuplicateUserDayOnRows(rows, duplicateDayKeys);

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
      safeApplyStatus(row, 'closed_period');
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
      safeApplyStatus(row, 'protected_timesheet');
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

  let autoRecalcTriggeredThisLoad = 0;
  const requestAutoRecalcWithLoadCap = (userId: string, dateYmd: string): AutoRecalcRequestOutcome => {
    if (autoRecalcTriggeredThisLoad >= AUTO_RECALC_MAX_PER_LOAD) {
      return 'skipped_load_budget';
    }
    const outcome = requestAutoRecalcMissingTimesheet(companyId, userId, dateYmd);
    if (outcome === 'triggered' || outcome === 'queued') {
      autoRecalcTriggeredThisLoad += 1;
    }
    return outcome;
  };

  let recalc_triggered = 0;
  let recalc_cooldown = 0;
  let recalc_skipped_load_budget = 0;
  for (const row of toRecalc) {
    if (!rowEligibleForAutoRecalc(row, duplicateDayKeys)) continue;
    const outcome = requestAutoRecalcWithLoadCap(row.employee_id, row.date);
    if (outcome === 'triggered' || outcome === 'queued') recalc_triggered++;
    else if (outcome === 'skipped_load_budget') recalc_skipped_load_budget++;
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

  // Summary sempre visível (auditoria / operação), fora do sample de 5%.
  console.info('[TIME ATTENDANCE AUTO FIX SUMMARY]', {
    pending_days,
    recalc_triggered,
    recalc_success,
    recalc_blocked,
    recalc_cooldown,
    recalc_skipped_load_budget,
    recalc_max_per_load: AUTO_RECALC_MAX_PER_LOAD,
  });

  for (const row of rows) {
    attachAutoRecalcRowHints(row);
  }

  for (const row of rows) {
    coerceUnknownStatusLabel(row);
  }

  let integrity_ok_count = 0;
  let integrity_warning_count = 0;
  let integrity_critical_count = 0;
  for (const r of rows) {
    if (r.status_label === 'duplicate_user_day' || r.status_label === 'erro no processamento') {
      integrity_critical_count += 1;
    } else if (
      r.status_label === 'inconsistent_data' ||
      r.status_label === 'pending_rep_sequence' ||
      r.status_label === 'pending_rep_promote' ||
      r.status_label === 'pending_rep_closed_period' ||
      r.status_label === 'pending_rep_protected'
    ) {
      integrity_warning_count += 1;
    } else {
      integrity_ok_count += 1;
    }
  }
  console.info('[TIME ATTENDANCE INTEGRITY SUMMARY]', {
    company_id: companyId,
    period_start: safeStart,
    period_end: safeEnd,
    integrity_ok_count,
    integrity_warning_count,
    integrity_critical_count,
    row_count: rows.length,
  });

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

/** Limiares para alerta visual e log de incidente (anti-ruído em inconsistências). */
export const ALERT_THRESHOLDS = {
  inconsistent: 5,
  duplicate: 1,
  error: 1,
} as const;

const AUDIT_SUMMARY_STATUS_LABELS = ['inconsistent_data', 'duplicate_user_day', 'erro no processamento'] as const;

export type TimeAttendanceAuditSummary = {
  inconsistent_count: number;
  duplicate_count: number;
  error_count: number;
  /** Colaboradores distintos com pelo menos um dia em status de auditoria. */
  affected_users: number;
  period_start: string;
  period_end: string;
  /** 100 − (dup×10 + err×10 + inc×2), limitado a [0, 100]. */
  quality_score: number;
  integrity_ok_count: number;
  integrity_warning_count: number;
  integrity_critical_count: number;
};

export type AuditTrendRow = {
  snapshot_date: string;
  inconsistent_count: number;
  duplicate_count: number;
  error_count: number;
};

const AUDIT_SNAPSHOT_MIN_INTERVAL_MS = 6 * 60 * 60 * 1000;

export function computeAuditQualityScore(pick: {
  inconsistent_count: number;
  duplicate_count: number;
  error_count: number;
}): number {
  const raw = 100 - pick.duplicate_count * 10 - pick.error_count * 10 - pick.inconsistent_count * 2;
  return Math.max(0, Math.min(100, Math.round(raw)));
}

function civilDateTodayLocal(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function isDefaultCivilMonthRange(start: string, end: string): boolean {
  const d = civilMonthBoundsForAudit();
  return start === d.start && end === d.end;
}

/**
 * Últimos 3 dias (mais recentes na série) piores que os 3 dias anteriores (mesma métrica de peso do score).
 */
export function isTrendWorsening(trend: AuditTrendRow[]): boolean {
  if (trend.length < 6) return false;
  const chronological = [...trend].sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date));
  const last6 = chronological.slice(-6);
  const prev3 = last6.slice(0, 3);
  const last3 = last6.slice(3, 6);
  const weight = (r: AuditTrendRow) =>
    r.duplicate_count * 10 + r.error_count * 10 + r.inconsistent_count * 2;
  const avg = (rows: AuditTrendRow[]) => rows.reduce((s, r) => s + weight(r), 0) / rows.length;
  return avg(last3) > avg(prev3);
}

async function upsertAuditSnapshotIfNeeded(companyId: string, summary: TimeAttendanceAuditSummary): Promise<void> {
  if (!isSupabaseConfigured() || !companyId.trim()) return;
  if (!isDefaultCivilMonthRange(summary.period_start, summary.period_end)) return;

  const snapshotDate = civilDateTodayLocal();

  try {
    const existing = await db.select(
      'time_attendance_audit_snapshots',
      [
        { column: 'company_id', operator: 'eq', value: companyId },
        { column: 'snapshot_date', operator: 'eq', value: snapshotDate },
      ],
      { column: 'created_at', ascending: false },
      1,
    );
    const row = existing[0] as { created_at?: string } | undefined;
    if (row?.created_at) {
      const age = Date.now() - new Date(row.created_at).getTime();
      if (age >= 0 && age < AUDIT_SNAPSHOT_MIN_INTERVAL_MS) return;
    }

    await db.upsert(
      'time_attendance_audit_snapshots',
      {
        company_id: companyId,
        snapshot_date: snapshotDate,
        inconsistent_count: summary.inconsistent_count,
        duplicate_count: summary.duplicate_count,
        error_count: summary.error_count,
        affected_users: summary.affected_users,
        created_at: new Date().toISOString(),
      },
      'company_id,snapshot_date',
    );
  } catch (e) {
    console.warn('[TIME ATTENDANCE AUDIT SNAPSHOT]', e);
  }
}

/**
 * Últimos 7 registros de snapshot (datas mais recentes primeiro).
 */
export async function getAuditTrend(companyId: string): Promise<AuditTrendRow[]> {
  if (!isSupabaseConfigured() || !String(companyId || '').trim()) return [];
  try {
    const rows = await db.select(
      'time_attendance_audit_snapshots',
      [{ column: 'company_id', operator: 'eq', value: companyId }],
      {
        columns: 'snapshot_date,inconsistent_count,duplicate_count,error_count',
        orderBy: { column: 'snapshot_date', ascending: false },
        limit: 7,
      },
    );
    const mapped: AuditTrendRow[] = (rows || []).map((r: Record<string, unknown>) => ({
      snapshot_date: String(r.snapshot_date).slice(0, 10),
      inconsistent_count: Number(r.inconsistent_count) || 0,
      duplicate_count: Number(r.duplicate_count) || 0,
      error_count: Number(r.error_count) || 0,
    }));
    if (isTrendWorsening(mapped)) {
      console.warn('[TIME ATTENDANCE TREND ALERT]', { company_id: companyId, trend: mapped });
    }
    return mapped;
  } catch (e) {
    console.warn('[TIME ATTENDANCE AUDIT TREND]', e);
    return [];
  }
}

const auditSummaryCache = new Map<string, { fetchedAt: number; data: TimeAttendanceAuditSummary }>();
const AUDIT_SUMMARY_TTL_MS = 30_000;

function auditSummaryCacheKey(companyId: string, start: string, end: string): string {
  return `${companyId}|${start}|${end}`;
}

function civilMonthBoundsForAudit(d = new Date()): { start: string; end: string } {
  const y = d.getFullYear();
  const m = d.getMonth();
  const last = new Date(y, m + 1, 0);
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    start: `${y}-${pad(m + 1)}-01`,
    end: `${y}-${pad(m + 1)}-${pad(last.getDate())}`,
  };
}

async function loadEmployeeNameMapForAudit(companyId: string): Promise<Map<string, string>> {
  const [employeeByCompanyRows, employeeByTenantRows] = await Promise.all([
    db.select('users', [{ column: 'company_id', operator: 'eq', value: companyId }]) as Promise<Record<string, unknown>[]>,
    (
      db.select('users', [{ column: 'tenant_id', operator: 'eq', value: companyId }]) as Promise<Record<string, unknown>[]>
    ).catch(() => [] as Record<string, unknown>[]),
  ]);
  const employeeRows = [...(employeeByCompanyRows ?? []), ...(employeeByTenantRows ?? [])];
  const uniqueUsers = Array.from(new Map(employeeRows.map((e) => [e.id, e])).values());
  const displayName = (e: Record<string, unknown>) =>
    (e.nome || e.name || e.full_name || e.email || 'Sem nome') as string;
  const empList = uniqueUsers
    .filter((e) => String(e.role || '').toLowerCase() !== 'admin')
    .map((e) => ({ id: String(e.id), nome: displayName(e) }));
  empList.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  return new Map(empList.map((e) => [e.id, e.nome]));
}

function auditIncidentThresholdsExceeded(s: TimeAttendanceAuditSummary): boolean {
  return (
    s.duplicate_count >= ALERT_THRESHOLDS.duplicate ||
    s.error_count >= ALERT_THRESHOLDS.error ||
    s.inconsistent_count >= ALERT_THRESHOLDS.inconsistent
  );
}

/**
 * Sinal para badge no menu (vermelho = duplicidade ou erro; laranja = só inconsistência acima do limiar).
 */
export function menuAuditSignalFromSummary(summary: TimeAttendanceAuditSummary | null): 'critical' | 'warning' | null {
  if (!summary) return null;
  const { inconsistent_count: inc, duplicate_count: dup, error_count: err, quality_score: q } = summary;
  const T = ALERT_THRESHOLDS;
  const visible =
    dup >= T.duplicate || err >= T.error || inc >= T.inconsistent || q < 80;
  if (!visible) return null;
  if (dup >= T.duplicate || err >= T.error || q < 80) return 'critical';
  return 'warning';
}

/**
 * Contadores de auditoria reutilizando `getTimeAttendanceData` (sem montar tabela). Cache em memória TTL 30s.
 */
export async function getTimeAttendanceAuditSummary(
  companyId: string,
  opts?: { start?: string; end?: string },
): Promise<TimeAttendanceAuditSummary | null> {
  if (!isSupabaseConfigured() || !String(companyId || '').trim()) return null;
  const { start: mStart, end: mEnd } = civilMonthBoundsForAudit();
  const start = String(opts?.start ?? mStart).slice(0, 10);
  const end = String(opts?.end ?? mEnd).slice(0, 10);
  if (start > end) return null;

  const key = auditSummaryCacheKey(companyId, start, end);
  const now = Date.now();
  const hit = auditSummaryCache.get(key);
  if (hit && now - hit.fetchedAt < AUDIT_SUMMARY_TTL_MS) {
    const s = hit.data;
    return {
      ...s,
      quality_score: computeAuditQualityScore(s),
      integrity_ok_count: s.integrity_ok_count ?? 0,
      integrity_warning_count: s.integrity_warning_count ?? 0,
      integrity_critical_count: s.integrity_critical_count ?? 0,
    };
  }

  const nameMap = await loadEmployeeNameMapForAudit(companyId);
  const { rows } = await getTimeAttendanceData(companyId, start, end, nameMap);
  const labels = AUDIT_SUMMARY_STATUS_LABELS as readonly string[];
  const auditRows = rows.filter((r) => labels.includes(r.status_label));

  let inconsistent_count = 0;
  let duplicate_count = 0;
  let error_count = 0;
  const userSet = new Set<string>();
  for (const r of auditRows) {
    userSet.add(r.employee_id);
    if (r.status_label === 'inconsistent_data') inconsistent_count++;
    else if (r.status_label === 'duplicate_user_day') duplicate_count++;
    else if (r.status_label === 'erro no processamento') error_count++;
  }

  let integrity_ok_count = 0;
  let integrity_warning_count = 0;
  let integrity_critical_count = 0;
  for (const r of rows) {
    if (r.status_label === 'duplicate_user_day' || r.status_label === 'erro no processamento') {
      integrity_critical_count += 1;
    } else if (
      r.status_label === 'inconsistent_data' ||
      r.status_label === 'pending_rep_sequence' ||
      r.status_label === 'pending_rep_promote' ||
      r.status_label === 'pending_rep_closed_period' ||
      r.status_label === 'pending_rep_protected'
    ) {
      integrity_warning_count += 1;
    } else {
      integrity_ok_count += 1;
    }
  }
  console.info('[TIME ATTENDANCE INTEGRITY SUMMARY]', {
    company_id: companyId,
    period_start: start,
    period_end: end,
    integrity_ok_count,
    integrity_warning_count,
    integrity_critical_count,
    row_count: rows.length,
    source: 'getTimeAttendanceAuditSummary',
  });

  const summary: TimeAttendanceAuditSummary = {
    inconsistent_count,
    duplicate_count,
    error_count,
    affected_users: userSet.size,
    period_start: start,
    period_end: end,
    quality_score: computeAuditQualityScore({
      inconsistent_count,
      duplicate_count,
      error_count,
    }),
    integrity_ok_count,
    integrity_warning_count,
    integrity_critical_count,
  };

  auditSummaryCache.set(key, { fetchedAt: now, data: summary });

  await upsertAuditSnapshotIfNeeded(companyId, summary);

  if (auditIncidentThresholdsExceeded(summary)) {
    console.warn('[TIME ATTENDANCE INCIDENT]', {
      company_id: companyId,
      inconsistent_count,
      duplicate_count,
      error_count,
      affected_users: userSet.size,
      quality_score: summary.quality_score,
      period_start: start,
      period_end: end,
    });
  }

  return summary;
}
