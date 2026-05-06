/**
 * Processamento de jornada diária, escalas e banco de horas.
 * Usado por payrollCalculator, timeEngine e fechamento de folha.
 */

import { db, isSupabaseConfigured, supabase } from './supabaseClient';
import { getTimeRecordsForUserDayRange } from '../../services/timeRecords.service';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  assertMonthOpenForEmployee,
  isTimesheetClosed,
  logBlockedTimesheetMutation,
  monthYearFromCivilYmd,
  monthYearFromIsoInSaoPaulo,
  reopenTimesheet,
  throwIfTimesheetClosedForPunchMutation,
} from './timesheetClosure';

export {
  assertMonthOpenForEmployee,
  isTimesheetClosed,
  logBlockedTimesheetMutation,
  monthYearFromCivilYmd,
  monthYearFromIsoInSaoPaulo,
  reopenTimesheet,
  throwIfTimesheetClosedForPunchMutation,
};

// ---------------------------------------------------------------------------
// Tipos (consumidos por timeEngine / payrollCalculator)
// ---------------------------------------------------------------------------

export interface RawTimeRecord {
  id: string;
  created_at: string;
  timestamp?: string | null;
  type: string;
  user_id?: string;
  company_id?: string;
  /** Metadados persistidos (ex.: sequence_adjusted no trigger de sequência). */
  raw_data?: Record<string, unknown> | null;
}

export interface WorkScheduleInfo {
  start_time: string;
  end_time: string;
  break_start: string;
  break_end: string;
  tolerance_minutes: number;
  daily_hours: number;
  work_days: number[];
}

export interface DailyProcessResult {
  total_worked_minutes: number;
  expected_minutes: number;
  overtime_minutes: number;
  late_minutes: number;
  entrada: string | null;
  saida: string | null;
  inicio_intervalo: string | null;
  fim_intervalo: string | null;
  /** true quando o dia não tem jornada na escala (folga): extras = todo o trabalhado. */
  scheduled_day_off: boolean;
}

/** Opções de `processDailyTime` (escala fixa na tela de Cálculos vs. escala por dia do colaborador). */
export type ProcessDailyTimeOpts = {
  fixedSchedule?: WorkScheduleInfo;
  toleranceOverride?: number;
};

/** Janela esperada do dia (espelho / status) — alinhado a `employee_shift_schedule` + turno. */
export type DayExpectedWindow = {
  entrada: string;
  saida: string;
  toleranceMin: number;
  saida_intervalo?: string;
  volta_intervalo?: string;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function padTime(t: string | undefined | null, fallback: string): string {
  if (!t) return fallback;
  const s = String(t).trim();
  if (s.length >= 5) return s.slice(0, 5);
  return fallback;
}

function timeToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map((x) => parseInt(x, 10));
  return (isNaN(h) ? 0 : h) * 60 + (isNaN(m) ? 0 : m);
}

/**
 * `employee_shift_schedule.day_of_week` usa o mesmo índice que `Date.getDay()` / `EXTRACT(DOW)`:
 * 0 = domingo … 6 = sábado.
 */
export function jsGetDayToScheduleDayIndex(jsDow: number): number {
  return jsDow;
}

/** Mantido por compatibilidade; ESS já está no índice JS. */
export function scheduleDayIndexToJsGetDay(idx: number): number {
  return idx;
}

function formatHHmm(d: Date): string {
  const h = d.getHours();
  const m = d.getMinutes();
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function sortedByTime(records: RawTimeRecord[]): RawTimeRecord[] {
  return [...records].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );
}

/** Data local YYYY-MM-DD (evita UTC do toISOString). */
export function getLocalDateString(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function normalizePunchType(t: string | undefined): string {
  const x = (t || '').toLowerCase().trim();
  if (x === 'saída' || x === 'saida') return 'saida';
  if (x === 'entrada') return 'entrada';
  if (x === 'pausa') return 'pausa';
  if (x === 'intervalo_saida') return 'pausa';
  if (x === 'intervalo_volta') return 'entrada';
  return x;
}

/**
 * Valida a próxima batida em relação às batidas já gravadas no dia.
 * Alinhado ao fluxo do ClockIn: entrada → pausa → entrada (retorno) → saída.
 */
const SEQUENCE_TOLERANCE_MS = 5 * 60 * 1000;

export function validatePunchSequence(
  dayRecords: RawTimeRecord[],
  nextTypeRaw: string,
  opts?: { nextEventTime?: Date | string }
): { valid: boolean; error?: string; sequenceTolerantExit?: boolean } {
  const next = normalizePunchType(nextTypeRaw);
  const sorted = sortedByTime(dayRecords);
  const lastRec = sorted[sorted.length - 1];
  const last = lastRec ? normalizePunchType(lastRec.type) : null;
  const nextEventMs = opts?.nextEventTime != null ? new Date(opts.nextEventTime).getTime() : Date.now();

  if (!last) {
    if (next === 'entrada') return { valid: true };
    return {
      valid: false,
      error: 'O primeiro registro do dia deve ser entrada.',
    };
  }

  if (last === 'entrada') {
    if (next === 'pausa' || next === 'saida') return { valid: true };
    if (next === 'entrada') {
      const lastMs = new Date(lastRec!.timestamp || lastRec!.created_at).getTime();
      if (nextEventMs - lastMs > SEQUENCE_TOLERANCE_MS) {
        return { valid: true, sequenceTolerantExit: true };
      }
      return { valid: false, error: 'Registre intervalo ou saída antes de uma nova entrada.' };
    }
  }

  if (last === 'pausa') {
    if (next === 'entrada') return { valid: true };
    if (next === 'pausa') {
      return { valid: false, error: 'Intervalo já iniciado. Finalize o intervalo antes de iniciar outro.' };
    }
    if (next === 'saida') {
      return { valid: false, error: 'Finalize o intervalo (retorno) antes da saída.' };
    }
  }

  if (last === 'saida') {
    if (next === 'entrada') return { valid: true };
    if (next === 'saida') {
      return { valid: false, error: 'Registre entrada antes de uma nova saída.' };
    }
    if (next === 'pausa') {
      return { valid: false, error: 'Registre entrada antes de iniciar intervalo.' };
    }
  }

  return { valid: true };
}

/** Jornada esperada em minutos a partir da escala */
function expectedMinutesFromSchedule(s: WorkScheduleInfo): number {
  const start = timeToMinutes(s.start_time);
  const end = timeToMinutes(s.end_time);
  const brk =
    timeToMinutes(s.break_end) > timeToMinutes(s.break_start)
      ? timeToMinutes(s.break_end) - timeToMinutes(s.break_start)
      : 0;
  const span = Math.max(0, end - start - brk);
  if (span > 0) return span;
  return Math.max(0, (s.daily_hours || 8) * 60);
}

/** Monta `WorkScheduleInfo` a partir de uma linha `work_shifts` (intervalo só se válido dentro do turno). */
export function shiftRecordToWorkScheduleInfo(sh: Record<string, unknown>): WorkScheduleInfo {
  const start_time = padTime((sh.start_time || sh.entry_time) as string | undefined, '08:00');
  const end_time = padTime((sh.end_time || sh.exit_time) as string | undefined, '17:00');
  const startM = timeToMinutes(start_time);
  const endM = timeToMinutes(end_time);
  const span = Math.max(0, endM - startM);
  const breakMin = Number(sh.break_minutes ?? 60);

  let break_start = sh.break_start_time ? padTime(String(sh.break_start_time), '12:00') : start_time;
  let break_end = sh.break_end_time ? padTime(String(sh.break_end_time), '13:00') : start_time;
  const bs = timeToMinutes(break_start);
  const be = timeToMinutes(break_end);
  const breakInside = be > bs && bs >= startM && be <= endM;

  if (!breakInside) {
    if (span > 6 * 60 && breakMin > 0 && (!sh.break_start_time || !sh.break_end_time)) {
      const sm = startM + Math.floor(span / 2);
      break_start = `${String(Math.floor(sm / 60)).padStart(2, '0')}:${String(sm % 60).padStart(2, '0')}`;
      const em = sm + breakMin;
      break_end = `${String(Math.floor(em / 60)).padStart(2, '0')}:${String(em % 60).padStart(2, '0')}`;
    } else {
      break_start = start_time;
      break_end = start_time;
    }
  }

  const tolerance = Number(sh.tolerance_minutes ?? sh.tolerancia_entrada ?? 10);
  const daily_hours = Number(sh.daily_hours ?? sh.limite_horas_dia ?? 8) || 8;

  return {
    start_time,
    end_time,
    break_start,
    break_end,
    tolerance_minutes: tolerance,
    daily_hours,
    work_days: [1, 2, 3, 4, 5],
  };
}

export interface EmployeeShiftScheduleRow {
  day_of_week: number;
  shift_id: string | null;
  work_shift_id?: string | null;
  is_day_off: boolean | null;
  is_workday?: boolean | null;
  start_time?: string | null;
  end_time?: string | null;
  break_start?: string | null;
  break_end?: string | null;
  tolerance_minutes?: number | null;
}

/** Evita N chamadas paralelas para a mesma escala legacy (reduz timeout em `db.select(users)`). */
const legacyScheduleInflight = new Map<string, Promise<WorkScheduleInfo | null>>();
const legacyScheduleCache = new Map<string, { value: WorkScheduleInfo | null; expiresAt: number }>();
const LEGACY_SCHEDULE_CACHE_TTL_MS = 30_000;

function essRowIsActiveWorkday(r: EmployeeShiftScheduleRow): boolean {
  if (r.is_workday === false) return false;
  if (r.is_day_off === true) return false;
  const hasInline = !!(r.start_time && r.end_time);
  const sid = r.shift_id || r.work_shift_id;
  return hasInline || !!sid;
}

/** Monta jornada do dia a partir da linha ESS (horários inline e/ou turno já carregado). */
function workScheduleFromEssRow(
  row: EmployeeShiftScheduleRow,
  shift: Record<string, unknown> | null
): WorkScheduleInfo | null {
  if (row.start_time && row.end_time) {
    return shiftRecordToWorkScheduleInfo({
      start_time: row.start_time,
      end_time: row.end_time,
      break_start_time: row.break_start ?? undefined,
      break_end_time: row.break_end ?? undefined,
      break_minutes: Number(shift?.break_minutes ?? 60),
      tolerance_minutes: row.tolerance_minutes ?? shift?.tolerance_minutes ?? shift?.tolerancia_entrada ?? 10,
      daily_hours: shift?.daily_hours ?? shift?.limite_horas_dia ?? 8,
    });
  }
  if (shift) return shiftRecordToWorkScheduleInfo(shift);
  return null;
}

async function fetchEmployeeShiftScheduleRows(
  employeeId: string,
  companyId: string
): Promise<EmployeeShiftScheduleRow[]> {
  if (!isSupabaseConfigured() || !employeeId || !companyId) return [];
  try {
    const rows = (await db.select(
      'employee_shift_schedule',
      [
        { column: 'employee_id', operator: 'eq', value: employeeId },
        { column: 'company_id', operator: 'eq', value: companyId },
      ],
      { column: 'day_of_week', ascending: true },
      20
    )) as EmployeeShiftScheduleRow[];
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

async function fetchWorkShiftById(
  shiftId: string,
  companyId: string
): Promise<Record<string, unknown> | null> {
  const shifts = (await db.select(
    'work_shifts',
    [
      { column: 'id', operator: 'eq', value: shiftId },
      { column: 'company_id', operator: 'eq', value: companyId },
    ],
    undefined,
    1
  )) as Record<string, unknown>[];
  return shifts?.[0] ?? null;
}

/**
 * Resolve a jornada do colaborador na data civil `dateStr` (America-friendly: use T12:00:00 no caller).
 * Prioriza `employee_shift_schedule`; se vazio, usa `users` → `schedules` → `work_shifts`.
 * `schedule === null` = dia sem jornada (folga na escala).
 */
export async function resolveEmployeeScheduleForDate(
  employeeId: string,
  companyId: string,
  dateStr: string
): Promise<{ schedule: WorkScheduleInfo | null; jsDayOfWeek: number }> {
  const jsDayOfWeek = new Date(`${dateStr}T12:00:00`).getDay();
  const ess = await fetchEmployeeShiftScheduleRows(employeeId, companyId);

  if (ess.length > 0) {
    const row = ess.find((r) => r.day_of_week === jsDayOfWeek);
    if (!row) {
      const legacy = await getLegacyScheduleFromUser(employeeId, companyId);
      if (legacy && legacy.work_days.includes(jsDayOfWeek)) {
        return { schedule: legacy, jsDayOfWeek };
      }
      return { schedule: null, jsDayOfWeek };
    }
    if (!essRowIsActiveWorkday(row)) {
      return { schedule: null, jsDayOfWeek };
    }
    const shiftId = row.shift_id || row.work_shift_id;
    const sh = shiftId ? await fetchWorkShiftById(shiftId, companyId) : null;
    const info = workScheduleFromEssRow(row, sh);
    if (!info) return { schedule: null, jsDayOfWeek };
    const workDays = ess.filter(essRowIsActiveWorkday).map((r) => r.day_of_week);
    return {
      schedule: { ...info, work_days: workDays.length ? [...new Set(workDays)].sort((a, b) => a - b) : info.work_days },
      jsDayOfWeek,
    };
  }

  const legacy = await getLegacyScheduleFromUser(employeeId, companyId);
  if (!legacy) return { schedule: null, jsDayOfWeek };
  if (!legacy.work_days.includes(jsDayOfWeek)) {
    return { schedule: null, jsDayOfWeek };
  }
  return { schedule: legacy, jsDayOfWeek };
}

/** Origem da resolução de escala (sem alterar regras de cálculo). */
export type ScheduleResolutionSource = 'employee' | 'default' | 'fallback';

/**
 * API explícita de resolução de jornada normalizada.
 * Não altera fórmulas; apenas descreve o estado retornado por `resolveEmployeeScheduleForDate`.
 */
export async function resolveWorkSchedule(
  employeeId: string,
  companyId: string,
  dateStr: string,
): Promise<{
  hasSchedule: boolean;
  schedule: WorkScheduleInfo | null;
  source: ScheduleResolutionSource;
}> {
  const resolved = await resolveEmployeeScheduleForDate(employeeId, companyId, dateStr);
  if (resolved.schedule) {
    return { hasSchedule: true, schedule: resolved.schedule, source: 'employee' };
  }
  return { hasSchedule: false, schedule: null, source: 'fallback' };
}

/**
 * Contexto para o espelho: dias úteis reais e janela entrada/saída por `getDay()` JS.
 */
export async function getEmployeeTimesheetScheduleContext(
  employeeId: string,
  companyId: string,
  options?: { useLegacyUserScheduleFallback?: boolean }
): Promise<{ workDays: number[]; windowByJsDow: Record<number, DayExpectedWindow | null> }> {
  const windowByJsDow: Record<number, DayExpectedWindow | null> = {
    0: null,
    1: null,
    2: null,
    3: null,
    4: null,
    5: null,
    6: null,
  };

  const ess = await fetchEmployeeShiftScheduleRows(employeeId, companyId);
  if (ess.length > 0) {
    const shiftCache = new Map<string, Record<string, unknown> | null>();
    for (const r of ess) {
      const js = r.day_of_week;
      if (!essRowIsActiveWorkday(r)) {
        windowByJsDow[js] = null;
        continue;
      }
      const shiftId = r.shift_id || r.work_shift_id;
      let sh: Record<string, unknown> | null = null;
      if (shiftId) {
        if (!shiftCache.has(shiftId)) {
          shiftCache.set(shiftId, await fetchWorkShiftById(shiftId, companyId));
        }
        sh = shiftCache.get(shiftId) ?? null;
      }
      const info = workScheduleFromEssRow(r, sh);
      if (info) {
        windowByJsDow[js] = {
          entrada: info.start_time,
          saida: info.end_time,
          toleranceMin: info.tolerance_minutes ?? 0,
          saida_intervalo: info.break_start,
          volta_intervalo: info.break_end,
        };
      } else {
        windowByJsDow[js] = null;
      }
    }
    const workDays = ess.filter(essRowIsActiveWorkday).map((r) => r.day_of_week);
    return {
      workDays: workDays.length ? [...new Set(workDays)].sort((a, b) => a - b) : [1, 2, 3, 4, 5],
      windowByJsDow,
    };
  }

  const useLegacyFallback = options?.useLegacyUserScheduleFallback !== false;
  if (!useLegacyFallback) {
    return { workDays: [1, 2, 3, 4, 5], windowByJsDow };
  }

  const legacy = await getLegacyScheduleFromUser(employeeId, companyId);
  const workDays = legacy?.work_days?.length ? legacy.work_days : [1, 2, 3, 4, 5];
  const win = legacy
    ? {
        entrada: legacy.start_time,
        saida: legacy.end_time,
        toleranceMin: legacy.tolerance_minutes ?? 0,
        saida_intervalo: legacy.break_start,
        volta_intervalo: legacy.break_end,
      }
    : null;
  for (let d = 0; d <= 6; d++) {
    windowByJsDow[d] = win && workDays.includes(d) ? win : null;
  }
  return { workDays, windowByJsDow };
}

async function getLegacyScheduleFromUser(
  employeeId: string,
  companyId: string
): Promise<WorkScheduleInfo | null> {
  if (!isSupabaseConfigured() || !employeeId) return null;
  const cacheKey = `${employeeId}::${companyId}`;
  const now = Date.now();
  const cached = legacyScheduleCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }
  const existingInflight = legacyScheduleInflight.get(cacheKey);
  if (existingInflight) {
    return existingInflight;
  }

  const inflight = (async (): Promise<WorkScheduleInfo | null> => {
    try {
      const users = (await db.select(
        'users',
        [{ column: 'id', operator: 'eq', value: employeeId }],
        undefined,
        1
      )) as { schedule_id?: string | null }[];

      const scheduleId = users?.[0]?.schedule_id;
      if (!scheduleId) return null;

      const schedules = (await db.select(
        'schedules',
        [{ column: 'id', operator: 'eq', value: scheduleId }],
        undefined,
        1
      )) as { shift_id?: string | null; work_days?: number[] | null; days?: number[] | null }[];

      const shiftId = schedules?.[0]?.shift_id;
      if (!shiftId) return null;

      const shifts = (await db.select(
        'work_shifts',
        [
          { column: 'id', operator: 'eq', value: shiftId },
          { column: 'company_id', operator: 'eq', value: companyId },
        ],
        undefined,
        1
      )) as Record<string, unknown>[];

      const sh = shifts?.[0];
      if (!sh) return null;

      const base = shiftRecordToWorkScheduleInfo(sh);
      const sched = schedules[0];
      const work_days = Array.isArray(sched?.days)
        ? (sched.days as number[])
        : Array.isArray(sched?.work_days)
          ? (sched.work_days as number[])
          : [1, 2, 3, 4, 5];

      return { ...base, work_days };
    } catch (e) {
      const msg = String((e as { message?: string })?.message ?? e ?? '');
      if (msg.includes('Tempo esgotado') || /timeout/i.test(msg)) {
        console.warn('[timeProcessingService] getLegacyScheduleFromUser: timeout transitório em users/schedules');
      } else {
        console.warn('[timeProcessingService] getLegacyScheduleFromUser:', e);
      }
      return null;
    }
  })();
  legacyScheduleInflight.set(cacheKey, inflight);
  inflight
    .then((value) => {
      legacyScheduleCache.set(cacheKey, { value, expiresAt: Date.now() + LEGACY_SCHEDULE_CACHE_TTL_MS });
    })
    .finally(() => {
      if (legacyScheduleInflight.get(cacheKey) === inflight) {
        legacyScheduleInflight.delete(cacheKey);
      }
    });
  return inflight;
}

/**
 * Busca registros de ponto do colaborador em uma data (timezone local do ISO).
 */
export async function getDayRecords(employeeId: string, dateStr: string): Promise<RawTimeRecord[]> {
  if (!isSupabaseConfigured()) return [];

  const start = `${dateStr}T00:00:00`;
  const end = `${dateStr}T23:59:59.999`;

  try {
    const rows = (await getTimeRecordsForUserDayRange(employeeId, start, end)) as RawTimeRecord[];
    return Array.isArray(rows) ? rows : [];
  } catch (e) {
    console.warn('[timeProcessingService] getDayRecords:', e);
    return [];
  }
}

/**
 * Busca escala padrão do colaborador.
 * Se existir `employee_shift_schedule`, `work_days` reflete os dias com jornada (ex.: 6x1 com sábado).
 * Horários padrão exibidos seguem o turno da segunda-feira (ou primeiro dia com trabalho).
 */
export async function getEmployeeSchedule(
  employeeId: string,
  companyId: string
): Promise<WorkScheduleInfo | null> {
  if (!isSupabaseConfigured() || !employeeId) return null;

  try {
    const ess = await fetchEmployeeShiftScheduleRows(employeeId, companyId);
    if (ess.length > 0) {
      const active = ess.filter(essRowIsActiveWorkday);
      const workDays = active.map((r) => r.day_of_week);
      const sortedDays = [...new Set(workDays)].sort((a, b) => a - b);
      const dowOrder = [1, 2, 3, 4, 5, 6, 0];
      const pickRow =
        dowOrder.map((d) => active.find((r) => r.day_of_week === d)).find(Boolean) || active[0];
      if (!pickRow) return null;
      const shiftId = pickRow.shift_id || pickRow.work_shift_id;
      const sh = shiftId ? await fetchWorkShiftById(shiftId, companyId) : null;
      const base = workScheduleFromEssRow(pickRow, sh);
      if (!base) return null;
      return {
        ...base,
        work_days: sortedDays.length ? sortedDays : base.work_days,
      };
    }

    return getLegacyScheduleFromUser(employeeId, companyId);
  } catch (e) {
    console.warn('[timeProcessingService] getEmployeeSchedule:', e);
    return null;
  }
}

/** Resumo de batidas brutas do dia (mesma ordem temporal que o espelho: `timestamp` antes de `created_at`). */
export function summarizeDayRecords(records: RawTimeRecord[]): {
  totalMinutes: number;
  entrada: string | null;
  saida: string | null;
  inicio_intervalo: string | null;
  fim_intervalo: string | null;
  break_minutes: number;
} {
  const instant = (r: RawTimeRecord) =>
    new Date((r.timestamp && String(r.timestamp).trim()) || r.created_at).getTime();

  const sorted = [...records].sort((a, b) => instant(a) - instant(b));

  let firstEntrada: Date | null = null;
  let lastSaida: Date | null = null;
  let intervaloSaidaAt: Date | null = null;
  let breakMs = 0;
  let displayInicioInt: Date | null = null;
  let displayFimInt: Date | null = null;

  for (const r of sorted) {
    const t = new Date((r.timestamp && String(r.timestamp).trim()) || r.created_at);
    const typ = (r.type || '').toLowerCase();

    if (typ === 'entrada') {
      if (!firstEntrada) firstEntrada = t;
    } else if (typ === 'intervalo_saida') {
      if (!displayInicioInt) displayInicioInt = t;
      intervaloSaidaAt = t;
    } else if (typ === 'intervalo_volta') {
      if (!displayFimInt) displayFimInt = t;
      if (intervaloSaidaAt) breakMs += t.getTime() - intervaloSaidaAt.getTime();
      intervaloSaidaAt = null;
    } else if (typ === 'saida' || typ === 'saída') {
      lastSaida = t;
    }
  }

  let totalMinutes = 0;
  if (firstEntrada && lastSaida) {
    totalMinutes = Math.max(
      0,
      Math.round((lastSaida.getTime() - firstEntrada.getTime() - breakMs) / 60000)
    );
  }

  return {
    totalMinutes,
    entrada: firstEntrada ? formatHHmm(firstEntrada) : null,
    saida: lastSaida ? formatHHmm(lastSaida) : null,
    inicio_intervalo: displayInicioInt ? formatHHmm(displayInicioInt) : null,
    fim_intervalo: displayFimInt ? formatHHmm(displayFimInt) : null,
    break_minutes: Math.round(breakMs / 60000),
  };
}

/**
 * Processa um dia: minutos trabalhados, esperados, extras e atraso na entrada.
 * Usa `employee_shift_schedule` + turno do dia quando disponível; senão, escala legacy do cadastro.
 */
export async function processDailyTime(
  employeeId: string,
  companyId: string,
  dateStr: string,
  opts?: ProcessDailyTimeOpts
): Promise<DailyProcessResult> {
  const records = await getDayRecords(employeeId, dateStr);
  const { totalMinutes, entrada, saida, inicio_intervalo, fim_intervalo } = summarizeDayRecords(records);

  let schedule: WorkScheduleInfo | null = null;
  let scheduled_day_off = false;

  if (opts?.fixedSchedule) {
    const dow = new Date(`${dateStr}T12:00:00`).getDay();
    scheduled_day_off = !opts.fixedSchedule.work_days.includes(dow);
    schedule = scheduled_day_off ? null : { ...opts.fixedSchedule };
  } else {
    const r = await resolveEmployeeScheduleForDate(employeeId, companyId, dateStr);
    scheduled_day_off = r.schedule === null;
    schedule = r.schedule;
  }

  if (schedule && opts?.toleranceOverride != null) {
    schedule = { ...schedule, tolerance_minutes: opts.toleranceOverride };
  }

  if (scheduled_day_off || !schedule) {
    return {
      total_worked_minutes: totalMinutes,
      expected_minutes: 0,
      overtime_minutes: totalMinutes,
      late_minutes: 0,
      entrada,
      saida,
      inicio_intervalo,
      fim_intervalo,
      scheduled_day_off: true,
    };
  }

  const expected = expectedMinutesFromSchedule(schedule);
  const overtime = Math.max(0, totalMinutes - expected);

  let late_minutes = 0;
  const firstEntradaRec = sortedByTime(records).find(
    (r) => (r.type || '').toLowerCase() === 'entrada'
  );
  if (firstEntradaRec && entrada) {
    const first = new Date(firstEntradaRec.created_at);
    const startMin = timeToMinutes(schedule.start_time);
    const actualMin = first.getHours() * 60 + first.getMinutes();
    const tol = schedule.tolerance_minutes || 0;
    if (actualMin > startMin + tol) {
      late_minutes = actualMin - startMin - tol;
    }
  }

  return {
    total_worked_minutes: totalMinutes,
    expected_minutes: expected,
    overtime_minutes: overtime,
    late_minutes,
    entrada,
    saida,
    inicio_intervalo,
    fim_intervalo,
    scheduled_day_off: false,
  };
}

/**
 * Atualiza banco de horas (crédito/débito) e retorna saldo consolidado do dia.
 */
export async function updateBankHours(
  employeeId: string,
  companyId: string,
  dateStr: string,
  hoursToAdd: number,
  hoursToRemove: number,
  source: string
): Promise<{ balance: number }> {
  if (!isSupabaseConfigured()) return { balance: 0 };

  try {
    const prevRows = (await db.select(
      'bank_hours',
      [{ column: 'employee_id', operator: 'eq', value: employeeId }],
      { column: 'date', ascending: false },
      1
    )) as { balance?: number }[];

    const prev = Number(prevRows?.[0]?.balance ?? 0);
    const balance = prev + Number(hoursToAdd || 0) - Number(hoursToRemove || 0);

    await db.insert('bank_hours', {
      employee_id: employeeId,
      company_id: companyId,
      date: dateStr,
      hours_added: hoursToAdd || 0,
      hours_removed: hoursToRemove || 0,
      balance,
      source: source || 'time_processing',
      created_at: new Date().toISOString(),
    });

    return { balance };
  } catch (e) {
    console.warn('[timeProcessingService] updateBankHours:', e);
    return { balance: 0 };
  }
}

// ---------------------------------------------------------------------------
// Fechamento de folha (motor timeEngine + marcação + snapshot)
// ---------------------------------------------------------------------------

/** Espelho na tela deve ser o mês civil completo = mês seleccionado no fecho — evita fechar período diferente do exibido. */
export function assertClosingPeriodMatchesEspelho(params: {
  closingMonthYm: string;
  periodStart: string;
  periodEnd: string;
}): void {
  const raw = params.closingMonthYm.trim();
  const match = /^(\d{4})-(\d{2})$/.exec(raw);
  if (!match) throw new Error('Mês de fechamento inválido.');
  const y = Number(match[1]);
  const m = Number(match[2]);
  if (!y || m < 1 || m > 12) throw new Error('Mês de fechamento inválido.');
  const lastDay = new Date(y, m, 0).getDate();
  const expStart = `${y}-${String(m).padStart(2, '0')}-01`;
  const expEnd = `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  if (params.periodStart.slice(0, 10) !== expStart || params.periodEnd.slice(0, 10) !== expEnd) {
    throw new Error(
      `Período exibido (${params.periodStart} → ${params.periodEnd}) diferente do mês civil do fecho (${expStart} → ${expEnd}). Ajuste os filtros do espelho antes de fechar.`,
    );
  }
}

export type RealTimesheetCloseResult = {
  closure: Record<string, unknown>;
  snapshot: Record<string, unknown>;
  totals: Record<string, unknown>;
  saldo_banco_final: number;
};

/**
 * Fechamento oficial: corre o motor (`timeEngine.closeTimesheet` já inclui recálculo do mês),
 * persiste `timesheet_closures` (gatilhos de travamento) e `timesheet_snapshots` (consolidados).
 * Idempotência: se já existe fecho para empresa/colaborador/ano/mês, devolve null sem repetir motor.
 */
export async function closeTimesheet(
  companyId: string,
  month: number,
  year: number,
  employeeId: string | undefined,
  closedBy?: string | null,
  espelho?: { periodStart: string; periodEnd: string; closingMonthYm: string },
): Promise<RealTimesheetCloseResult | null> {
  const client = supabase as SupabaseClient | null;
  if (!client) throw new Error('Supabase não inicializado');
  const empId = String(employeeId || '').trim();
  if (!empId) throw new Error('employeeId é obrigatório para fechar a folha.');

  const existing = await isTimesheetClosed(companyId, month, year, empId);
  if (existing) {
    console.warn('[FECHAMENTO IGNORADO - JÁ EXISTE]', { employeeId: empId, month, year });
    return null;
  }

  if (espelho) {
    assertClosingPeriodMatchesEspelho({
      closingMonthYm: espelho.closingMonthYm,
      periodStart: espelho.periodStart,
      periodEnd: espelho.periodEnd,
    });
  }

  const periodStart =
    espelho?.periodStart ??
    `${year}-${String(month).padStart(2, '0')}-01`;
  const periodEnd =
    espelho?.periodEnd ??
    `${year}-${String(month).padStart(2, '0')}-${String(new Date(year, month, 0).getDate()).padStart(2, '0')}`;

  console.log('[FECHAMENTO REAL START]', {
    employeeId: empId,
    periodStart: periodStart.slice(0, 10),
    periodEnd: periodEnd.slice(0, 10),
    year,
    month,
  });

  const { calculatePeriodTimesheetsWithSummary } = await import('./payrollCalculator');
  const preCloseHealth = await calculatePeriodTimesheetsWithSummary(
    empId,
    companyId,
    periodStart.slice(0, 10),
    periodEnd.slice(0, 10),
  );
  const ps = preCloseHealth.summary.period_status;
  if (ps === 'degraded' || ps === 'failed') {
    throw new Error('PERIOD_NOT_RELIABLE');
  }

  const { summary: preSum } = preCloseHealth;
  if (
    preSum.total_processed > 0 &&
    preSum.schedule_missing_count / preSum.total_processed > 0.2
  ) {
    throw new Error('TOO_MANY_SCHEDULE_FALLBACKS');
  }

  const { closeTimesheet: engineCloseTimesheet } = await import('../engine/timeEngine');
  const engineResult = await engineCloseTimesheet(empId, companyId, year, month);

  const ms = engineResult.engine.monthly_summary;
  const totals = {
    worked: engineResult.total_trabalhado,
    extra_50: engineResult.total_extra_50,
    extra_100: engineResult.total_extra_100,
    negative: ms.negative_total,
    faltas: engineResult.total_faltas,
    noturno: ms.total_noturno,
    atrasos: engineResult.total_atrasos,
    banco_credito_minutes: engineResult.total_banco_credito,
    banco_debito_minutes: engineResult.total_banco_debito,
    dsr_extra_50: ms.dsr_extra_50,
    dsr_extra_100: ms.dsr_extra_100,
    bank_balance_approx: ms.bank_balance_approx,
  };

  const snapshotPayload = {
    employee_id: empId,
    period_start: periodStart.slice(0, 10),
    period_end: periodEnd.slice(0, 10),
    totals,
    bank_hours_balance: engineResult.saldo_banco_final,
    closed_by: closedBy ?? null,
    violations_count: engineResult.engine.inconsistent_days,
    total_days: engineResult.engine.total_days,
    closed_at_iso: new Date().toISOString(),
  };

  console.log('[FECHAMENTO SNAPSHOT]', snapshotPayload);

  const { data: closure, error: errClosure } = await client
    .from('timesheet_closures')
    .insert({
      company_id: companyId,
      employee_id: empId,
      month,
      year,
      user_id: empId,
      closed_by: closedBy ?? null,
      closed_at: new Date().toISOString(),
      signature_metadata: { snapshot_totals_v1: totals },
    })
    .select()
    .single();

  if (errClosure) throw errClosure;

  const closureRow = closure as Record<string, unknown>;
  const closureId = closureRow?.id != null ? String(closureRow.id) : null;

  const { data: snapIns, error: errSnap } = await client
    .from('timesheet_snapshots')
    .insert({
      company_id: companyId,
      employee_id: empId,
      year,
      month,
      period_start: periodStart.slice(0, 10),
      period_end: periodEnd.slice(0, 10),
      totals,
      bank_hours_balance: engineResult.saldo_banco_final,
      timesheet_closure_id: closureId,
      closed_by: closedBy ?? null,
      closed_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (errSnap) {
    console.error('[FECHAMENTO] Falha ao gravar timesheet_snapshots:', errSnap);
    throw errSnap;
  }

  console.log('[FECHAMENTO DONE]');
  return {
    closure: closureRow,
    snapshot: snapIns as Record<string, unknown>,
    totals,
    saldo_banco_final: engineResult.saldo_banco_final,
  };
}

