/**
 * Motor avançado de jornada e escalas (SmartPonto).
 * Interpreta escalas, valida marcações, detecta inconsistências,
 * calcula jornada, horas extras, noturnas, DSR e banco de horas.
 */

import { db, isSupabaseConfigured } from '../services/supabaseClient';
import {
  getDayRecords,
  getEmployeeSchedule,
  processDailyTime,
  updateBankHours,
  type RawTimeRecord,
  type WorkScheduleInfo,
  type DailyProcessResult,
} from '../services/timeProcessingService';

export type ShiftType = 'fixed' | 'flexible' | '6x1' | '5x2' | '12x36' | '24x72' | 'custom';

export type ParsedPunchType = 'entrada' | 'saida' | 'inicio_intervalo' | 'fim_intervalo';

export interface ParsedSegment {
  type: ParsedPunchType;
  at: Date;
  recordId: string;
}

/** Sequência interpretada: um ou mais pares entrada->saída, com opcional inicio_intervalo->fim_intervalo */
export interface ParsedDay {
  date: string;
  segments: ParsedSegment[];
  sequences: { entrada: Date; saida: Date; inicioIntervalo?: Date; fimIntervalo?: Date }[];
  totalWorkedMinutes: number;
  breakMinutes: number;
}

export type InconsistencyType =
  | 'missing_entry'
  | 'missing_exit'
  | 'missing_break'
  | 'duplicate_records'
  | 'invalid_sequence';

export interface TimeInconsistency {
  employee_id: string;
  date: string;
  type: InconsistencyType;
  description: string;
}

export interface OvertimeResult {
  date: string;
  overtime_50_minutes: number;
  overtime_100_minutes: number;
  is_holiday_or_off: boolean;
}

export interface DaySummary {
  date: string;
  daily: DailyProcessResult;
  inconsistencies: TimeInconsistency[];
  overtime: OvertimeResult | null;
  night_minutes: number;
  dsr_minutes?: number;
  bank_hours_delta?: number;
}

const MS_PER_MINUTE = 60 * 1000;
const NIGHT_START_MIN = 22 * 60;
const NIGHT_END_MIN = 5 * 60;
const MAX_WORK_MINUTES_PER_DAY = 16 * 60;
const MIN_BREAK_IF_WORK_OVER = 6 * 60;
const FRAUD_MIN_INTERVAL_MS = 60 * 1000;

function normalizeType(type: string): string {
  const t = (type || '').toLowerCase();
  if (t === 'saída' || t === 'saida') return 'saida';
  if (t === 'entrada') return 'entrada';
  if (t === 'pausa') return 'pausa';
  return t;
}

/** Mapeia pausa/entrada para inicio_intervalo e fim_intervalo na sequência do dia */
function mapToStandardTypes(records: RawTimeRecord[]): ParsedSegment[] {
  const sorted = [...records].sort(
    (a, b) => new Date(a.created_at || a.timestamp || 0).getTime() - new Date(b.created_at || b.timestamp || 0).getTime()
  );
  const out: ParsedSegment[] = [];
  let lastWasPausa = false;
  for (const r of sorted) {
    const at = new Date(r.timestamp || r.created_at);
    const raw = (r.type || '').toLowerCase();
    const type = normalizeType(r.type);
    // Tipos do banco (Portaria / app web)
    if (raw === 'intervalo_saida') {
      out.push({ type: 'inicio_intervalo', at, recordId: r.id });
      lastWasPausa = true;
      continue;
    }
    if (raw === 'intervalo_volta') {
      out.push({ type: 'fim_intervalo', at, recordId: r.id });
      lastWasPausa = false;
      continue;
    }
    if (type === 'entrada') {
      if (lastWasPausa) {
        out.push({ type: 'fim_intervalo', at, recordId: r.id });
      } else {
        out.push({ type: 'entrada', at, recordId: r.id });
      }
      lastWasPausa = false;
    } else if (type === 'pausa') {
      out.push({ type: 'inicio_intervalo', at, recordId: r.id });
      lastWasPausa = true;
    } else if (type === 'saida') {
      out.push({ type: 'saida', at, recordId: r.id });
      lastWasPausa = false;
    }
  }
  return out;
}

/**
 * Interpreta marcações do dia em sequências válidas: entrada [inicio_intervalo fim_intervalo] saida.
 * Suporta múltiplos turnos: entrada saida entrada saida.
 */
export function parseTimeRecords(records: RawTimeRecord[]): ParsedDay {
  const segments = mapToStandardTypes(records);
  const date = segments[0]?.at?.toISOString().slice(0, 10) || new Date().toISOString().slice(0, 10);
  const sequences: ParsedDay['sequences'] = [];
  let totalWorkedMinutes = 0;
  let breakMinutes = 0;
  let i = 0;
  while (i < segments.length) {
    const ent = segments[i];
    if (ent.type !== 'entrada') {
      i++;
      continue;
    }
    let saida: Date | undefined;
    let inicioIntervalo: Date | undefined;
    let fimIntervalo: Date | undefined;
    let j = i + 1;
    while (j < segments.length) {
      const s = segments[j];
      if (s.type === 'inicio_intervalo') {
        inicioIntervalo = s.at;
        totalWorkedMinutes += (s.at.getTime() - ent.at.getTime()) / MS_PER_MINUTE;
        j++;
      } else if (s.type === 'fim_intervalo') {
        fimIntervalo = s.at;
        if (inicioIntervalo) breakMinutes += (s.at.getTime() - inicioIntervalo.getTime()) / MS_PER_MINUTE;
        j++;
      } else if (s.type === 'saida') {
        saida = s.at;
        if (fimIntervalo) totalWorkedMinutes += (s.at.getTime() - fimIntervalo.getTime()) / MS_PER_MINUTE;
        else if (inicioIntervalo) {
          // saida sem fim_intervalo: conta até saida como trabalho (inconsistência tratada depois)
          totalWorkedMinutes += (s.at.getTime() - inicioIntervalo.getTime()) / MS_PER_MINUTE;
        } else totalWorkedMinutes += (s.at.getTime() - ent.at.getTime()) / MS_PER_MINUTE;
        j++;
        break;
      } else {
        j++;
      }
    }
    sequences.push({
      entrada: ent.at,
      saida: saida || ent.at,
      inicioIntervalo,
      fimIntervalo,
    });
    i = j;
  }
  return {
    date,
    segments,
    sequences,
    totalWorkedMinutes: Math.round(totalWorkedMinutes),
    breakMinutes: Math.round(breakMinutes),
  };
}

/**
 * Detecta inconsistências: falta entrada/saída, intervalo incompleto, duplicadas, sequência inválida.
 */
export function detectInconsistencies(
  employeeId: string,
  dateStr: string,
  records: RawTimeRecord[],
  schedule: WorkScheduleInfo | null
): TimeInconsistency[] {
  const list: TimeInconsistency[] = [];
  const parsed = parseTimeRecords(records);
  const dayOfWeek = new Date(dateStr).getDay();
  const isWorkDay = schedule ? schedule.work_days.includes(dayOfWeek) : true;

  if (records.length === 0) {
    if (isWorkDay) list.push({ employee_id: employeeId, date: dateStr, type: 'missing_entry', description: 'Falta de entrada (dia de trabalho sem marcação)' });
    return list;
  }

  for (let i = 0; i < parsed.segments.length; i++) {
    const curr = parsed.segments[i];
    const prev = parsed.segments[i - 1];
    if (prev && prev.type === curr.type) {
      list.push({
        employee_id: employeeId,
        date: dateStr,
        type: 'duplicate_records',
        description: `Duas marcações seguidas do mesmo tipo: ${curr.type}`,
      });
    }
  }

  if (parsed.segments[0]?.type !== 'entrada') {
    list.push({ employee_id: employeeId, date: dateStr, type: 'invalid_sequence', description: 'Primeira marcação do dia deve ser entrada' });
  }

  const last = parsed.segments[parsed.segments.length - 1];
  if (last?.type === 'entrada' || last?.type === 'inicio_intervalo') {
    list.push({ employee_id: employeeId, date: dateStr, type: 'missing_exit', description: 'Falta de saída (entrada ou intervalo sem saída)' });
  }

  const hasInicio = parsed.segments.some((s) => s.type === 'inicio_intervalo');
  const hasFim = parsed.segments.some((s) => s.type === 'fim_intervalo');
  if (hasInicio && !hasFim) {
    list.push({ employee_id: employeeId, date: dateStr, type: 'missing_break', description: 'Intervalo incompleto (início sem fim)' });
  }

  const workedMin = parsed.totalWorkedMinutes;
  if (schedule && isWorkDay && schedule.break_start && schedule.break_end && workedMin > MIN_BREAK_IF_WORK_OVER && parsed.breakMinutes < 30) {
    list.push({ employee_id: employeeId, date: dateStr, type: 'missing_break', description: 'Jornada > 6h sem intervalo mínimo' });
  }

  return list;
}

/** Calcula minutos no período noturno (22:00–05:00) entre dois instantes */
function nightMinutesBetween(from: Date, to: Date): number {
  let min = 0;
  const step = 60 * 1000;
  let t = from.getTime();
  const end = to.getTime();
  while (t < end) {
    const d = new Date(t);
    const m = d.getHours() * 60 + d.getMinutes();
    if (m >= NIGHT_START_MIN || m < NIGHT_END_MIN) min += 1;
    t += step;
  }
  return min;
}

/**
 * Calcula horas noturnas do dia (22h–05h) a partir das marcações.
 */
export function calculateNightHours(records: RawTimeRecord[]): number {
  const parsed = parseTimeRecords(records);
  let total = 0;
  for (const seq of parsed.sequences) {
    if (seq.saida) total += nightMinutesBetween(seq.entrada, seq.saida);
  }
  return total;
}

/**
 * Calcula horas extras: 50% (seg–sáb) e 100% (domingo/feriado/folga).
 */
export function calculateOvertime(
  dateStr: string,
  workedMinutes: number,
  expectedMinutes: number,
  isHolidayOrDayOff: boolean
): OvertimeResult {
  const balance = workedMinutes - expectedMinutes;
  const overtime = Math.max(0, balance);
  return {
    date: dateStr,
    overtime_50_minutes: isHolidayOrDayOff ? 0 : overtime,
    overtime_100_minutes: isHolidayOrDayOff ? overtime : 0,
    is_holiday_or_off: isHolidayOrDayOff,
  };
}

/**
 * DSR: média das horas extras da semana aplicada ao descanso.
 * Formula simplificada: (soma horas extras da semana / dias úteis) * domingos/feriados no mês (ou 1 por semana).
 */
export function calculateDSR(weekOvertimeMinutes: number, workingDaysInWeek: number): number {
  if (workingDaysInWeek <= 0) return 0;
  return weekOvertimeMinutes / workingDaysInWeek;
}

/**
 * Processa um dia completo: jornada, inconsistências, extras, noturnas.
 */
export async function processEmployeeDay(
  employeeId: string,
  companyId: string,
  dateStr: string
): Promise<DaySummary> {
  const schedule = await getEmployeeSchedule(employeeId, companyId);
  const records = await getDayRecords(employeeId, dateStr);
  const daily = await processDailyTime(employeeId, companyId, dateStr, schedule || defaultSchedule());
  const inconsistencies = detectInconsistencies(employeeId, dateStr, records, schedule);
  const night_minutes = calculateNightHours(records);
  const dayOfWeek = new Date(dateStr).getDay();
  const isOff = schedule ? !schedule.work_days.includes(dayOfWeek) : false;
  const overtime = calculateOvertime(
    dateStr,
    daily.total_worked_minutes,
    daily.expected_minutes,
    isOff
  );
  return {
    date: dateStr,
    daily,
    inconsistencies,
    overtime,
    night_minutes,
  };
}

/**
 * Processa a semana do funcionário (7 dias a partir de startDate).
 */
export async function processEmployeeWeek(
  employeeId: string,
  companyId: string,
  startDate: string
): Promise<DaySummary[]> {
  const results: DaySummary[] = [];
  const start = new Date(startDate);
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const dateStr = d.toISOString().slice(0, 10);
    results.push(await processEmployeeDay(employeeId, companyId, dateStr));
  }
  return results;
}

/**
 * Processa o mês do funcionário.
 */
export async function processEmployeeMonth(
  employeeId: string,
  companyId: string,
  year: number,
  month: number
): Promise<DaySummary[]> {
  const results: DaySummary[] = [];
  const lastDay = new Date(year, month, 0).getDate();
  for (let d = 1; d <= lastDay; d++) {
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    results.push(await processEmployeeDay(employeeId, companyId, dateStr));
  }
  return results;
}

/**
 * Helper para montar o espelho mensal (timesheet) de um colaborador.
 * Usado por rotas API externas sem acoplar diretamente ao client do Supabase.
 */
export async function buildTimesheetForPeriod(params: {
  supabase?: unknown; // mantido apenas para compatibilidade com chamadas existentes
  employeeId: string;
  companyId?: string;
  year: number;
  month: number;
}): Promise<DaySummary[]> {
  const { employeeId, companyId, year, month } = params;
  // Reaproveita o motor interno, usando companyId vazio se não fornecido.
  return processEmployeeMonth(employeeId, companyId ?? '', year, month);
}

function defaultSchedule(): WorkScheduleInfo {
  return {
    start_time: '08:00',
    end_time: '17:00',
    break_start: '12:00',
    break_end: '13:00',
    tolerance_minutes: 10,
    daily_hours: 8,
    work_days: [1, 2, 3, 4, 5],
  };
}

/**
 * Persiste inconsistências na tabela time_inconsistencies (evita duplicar por data/funcionário/tipo).
 */
export async function saveInconsistencies(
  employeeId: string,
  companyId: string,
  dateStr: string,
  inconsistencies: TimeInconsistency[]
): Promise<void> {
  if (!isSupabaseConfigured || inconsistencies.length === 0) return;
  for (const inc of inconsistencies) {
    await db.insert('time_inconsistencies', {
      employee_id: employeeId,
      company_id: companyId,
      date: dateStr,
      type: inc.type,
      description: inc.description,
      resolved: false,
    }).catch(() => {});
  }
}

/**
 * Persiste horas noturnas em night_hours (upsert por employee_id + date).
 */
export async function saveNightHours(
  employeeId: string,
  companyId: string,
  dateStr: string,
  minutes: number
): Promise<void> {
  if (!isSupabaseConfigured) return;
  const existing = (await db.select(
    'night_hours',
    [
      { column: 'employee_id', operator: 'eq', value: employeeId },
      { column: 'date', operator: 'eq', value: dateStr },
    ],
    undefined,
    1
  )) as any[];
  const payload = { employee_id: employeeId, company_id: companyId, date: dateStr, minutes, updated_at: new Date().toISOString() };
  if (existing?.[0]?.id) {
    await db.update('night_hours', existing[0].id, payload);
  } else {
    await db.insert('night_hours', payload);
  }
}

/**
 * Banco de horas: crédito (hora extra) ou débito (falta). Atualiza bank_hours e retorna saldo.
 */
export async function calculateBankHours(
  employeeId: string,
  companyId: string,
  dateStr: string,
  overtimeHours: number,
  missingHours: number,
  bankHoursEnabled: boolean
): Promise<{ balance: number; credited: number; debited: number }> {
  if (!bankHoursEnabled) return { balance: 0, credited: 0, debited: 0 };
  const toAdd = Math.max(0, overtimeHours);
  const toRemove = Math.max(0, missingHours);
  const { balance } = await updateBankHours(
    employeeId,
    companyId,
    dateStr,
    toAdd,
    toRemove,
    'engine_daily'
  );
  return { balance, credited: toAdd, debited: toRemove };
}

/**
 * Detecção de fraude/alertas: marcações muito próximas, jornada > 16h, intervalo obrigatório.
 */
export function detectFraudAlerts(
  employeeId: string,
  dateStr: string,
  records: RawTimeRecord[],
  totalWorkedMinutes: number,
  breakMinutes: number
): { type: string; description: string; severity: 'info' | 'warning' | 'critical' }[] {
  const alerts: { type: string; description: string; severity: 'info' | 'warning' | 'critical' }[] = [];
  const sorted = [...records].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );
  for (let i = 1; i < sorted.length; i++) {
    const prev = new Date(sorted[i - 1].created_at);
    const curr = new Date(sorted[i].created_at);
    const diffMs = curr.getTime() - prev.getTime();
    if (diffMs > 0 && diffMs < FRAUD_MIN_INTERVAL_MS) {
      alerts.push({
        type: 'punch_too_close',
        description: `Marcações com menos de 1 minuto de diferença (${sorted[i - 1].type} → ${sorted[i].type})`,
        severity: 'warning',
      });
    }
  }
  if (totalWorkedMinutes > MAX_WORK_MINUTES_PER_DAY) {
    alerts.push({
      type: 'impossible_journey',
      description: `Jornada superior a 16 horas (${(totalWorkedMinutes / 60).toFixed(1)}h)`,
      severity: 'critical',
    });
  }
  if (totalWorkedMinutes > MIN_BREAK_IF_WORK_OVER && breakMinutes < 30) {
    alerts.push({
      type: 'missing_break',
      description: 'Jornada superior a 6 horas sem intervalo mínimo de 30 min',
      severity: 'warning',
    });
  }
  return alerts;
}

/**
 * Persiste alertas em time_alerts.
 */
export async function saveTimeAlerts(
  employeeId: string,
  companyId: string,
  dateStr: string,
  alerts: { type: string; description: string; severity: string }[]
): Promise<void> {
  if (!isSupabaseConfigured || alerts.length === 0) return;
  for (const a of alerts) {
    await db.insert('time_alerts', {
      employee_id: employeeId,
      company_id: companyId,
      date: dateStr,
      type: a.type,
      description: a.description,
      severity: a.severity,
      resolved: false,
    }).catch(() => {});
  }
}
