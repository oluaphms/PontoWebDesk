/**
 * Serviço de processamento de ponto (SmartPonto).
 * Calcula jornada diária, horas trabalhadas, atrasos, horas extras, faltas, DSR e banco de horas.
 */

import { db, isSupabaseConfigured } from '../services/supabaseClient';

const TYPES = { entrada: 'entrada', saida: 'saída', pausa: 'pausa' } as const;
type PunchType = typeof TYPES[keyof typeof TYPES];

export interface RawTimeRecord {
  id: string;
  user_id: string;
  company_id: string;
  type: string;
  created_at: string;
  timestamp?: string;
  method?: string;
  location?: unknown;
}

export interface WorkScheduleInfo {
  start_time: string;
  end_time: string;
  break_start?: string | null;
  break_end?: string | null;
  tolerance_minutes: number;
  daily_hours: number;
  work_days: number[]; // 0=dom, 1=seg, ... 6=sab
}

export interface DailyProcessResult {
  date: string;
  employee_id: string;
  company_id: string;
  entrada: string | null;
  saida: string | null;
  inicio_intervalo: string | null;
  fim_intervalo: string | null;
  total_worked_minutes: number;
  expected_minutes: number;
  break_minutes: number;
  late_minutes: number;
  overtime_minutes: number;
  missing_minutes: number;
  absence: boolean;
  night_minutes: number;
  records: RawTimeRecord[];
}

const MS_PER_MINUTE = 60 * 1000;
const NIGHT_START = 22 * 60; // 22:00 em minutos do dia
const NIGHT_END = 5 * 60;    // 05:00 em minutos do dia

function toMinutes(date: Date): number {
  return date.getHours() * 60 + date.getMinutes() + date.getSeconds() / 60;
}

function isNightPeriod(from: Date, to: Date): boolean {
  const fromMin = from.getHours() * 60 + from.getMinutes();
  const toMin = to.getHours() * 60 + to.getMinutes();
  if (fromMin >= NIGHT_START || fromMin < NIGHT_END) return true;
  if (toMin >= NIGHT_START || toMin < NIGHT_END) return true;
  if (from.getTime() > to.getTime() && (fromMin >= NIGHT_START || toMin < NIGHT_END)) return true;
  return false;
}

function parseTimeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** Normaliza tipo do banco (saída/entrada/pausa) para comparação */
function normalizeType(type: string): PunchType {
  const lower = (type || '').toLowerCase();
  if (lower === 'saída' || lower === 'saida') return 'saída';
  if (lower === 'entrada') return 'entrada';
  if (lower === 'pausa') return 'pausa';
  return lower as PunchType;
}

/** Data local YYYY-MM-DD; use no lugar de `toISOString().slice(0,10)` para filtros do dia civil. */
export function getLocalDateString(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Busca marcações do dia para um funcionário (considerando ajustes aprovados).
 */
export async function getDayRecords(employeeId: string, dateStr: string): Promise<RawTimeRecord[]> {
  if (!isSupabaseConfigured) return [];
  const start = `${dateStr}T00:00:00`;
  const end = `${dateStr}T23:59:59.999`;
  const rows = await db.select(
    'time_records',
    [
      { column: 'user_id', operator: 'eq', value: employeeId },
      { column: 'created_at', operator: 'gte', value: start },
      { column: 'created_at', operator: 'lte', value: end },
    ],
    { column: 'created_at', ascending: true },
    50
  ) as RawTimeRecord[];
  return rows ?? [];
}

/**
 * Processa o ponto de um dia para um funcionário.
 * Pares: entrada -> (pausa -> entrada)* -> saída.
 * Calcula: horas trabalhadas, intervalo, atraso, hora extra, falta, hora noturna.
 */
export async function processDailyTime(
  employeeId: string,
  companyId: string,
  dateStr: string,
  schedule: WorkScheduleInfo
): Promise<DailyProcessResult> {
  const records = await getDayRecords(employeeId, dateStr);
  const date = new Date(dateStr);

  const result: DailyProcessResult = {
    date: dateStr,
    employee_id: employeeId,
    company_id: companyId,
    entrada: null,
    saida: null,
    inicio_intervalo: null,
    fim_intervalo: null,
    total_worked_minutes: 0,
    expected_minutes: 0,
    break_minutes: 0,
    late_minutes: 0,
    overtime_minutes: 0,
    missing_minutes: 0,
    absence: false,
    night_minutes: 0,
    records,
  };

  const dayOfWeek = date.getDay();
  const isWorkDay = schedule.work_days.includes(dayOfWeek);
  const startMin = parseTimeToMinutes(schedule.start_time);
  const endMin = parseTimeToMinutes(schedule.end_time);
  let breakMin = 0;
  if (schedule.break_start && schedule.break_end) {
    breakMin = parseTimeToMinutes(schedule.break_end) - parseTimeToMinutes(schedule.break_start);
  }
  const expectedMin = Math.max(0, endMin - startMin - breakMin);
  result.expected_minutes = isWorkDay ? expectedMin : 0;

  if (records.length === 0) {
    result.absence = isWorkDay;
    if (isWorkDay) result.missing_minutes = expectedMin;
    return result;
  }

  const sorted = [...records].sort(
    (a, b) => new Date(a.created_at || a.timestamp || 0).getTime() - new Date(b.created_at || b.timestamp || 0).getTime()
  );

  let firstEntrada: Date | null = null;
  let lastSaida: Date | null = null;
  let totalMs = 0;
  let breakMs = 0;
  let lastIn: Date | null = null;
  const intervalStarts: Date[] = [];
  const intervalEnds: Date[] = [];

  for (const rec of sorted) {
    const t = new Date(rec.timestamp || rec.created_at);
    const type = normalizeType(rec.type);

    if (type === 'entrada') {
      if (intervalStarts.length > intervalEnds.length) intervalEnds.push(t);
      if (!firstEntrada) firstEntrada = t;
      if (lastIn) breakMs += t.getTime() - lastIn.getTime();
      lastIn = t;
    } else if (type === 'pausa') {
      if (lastIn) {
        totalMs += t.getTime() - lastIn.getTime();
        intervalStarts.push(t);
      }
      lastIn = null;
    } else if (type === 'saída') {
      if (lastIn) totalMs += t.getTime() - lastIn.getTime();
      lastSaida = t;
      lastIn = null;
    }
  }
  if (intervalStarts.length > 0 && intervalEnds.length > 0) {
    breakMs = intervalEnds[0].getTime() - intervalStarts[0].getTime();
  }

  result.entrada = firstEntrada ? firstEntrada.toISOString().slice(11, 16) : null;
  result.saida = lastSaida ? lastSaida.toISOString().slice(11, 16) : null;
  if (intervalStarts.length > 0) result.inicio_intervalo = intervalStarts[0].toISOString().slice(11, 16);
  if (intervalEnds.length > 0) result.fim_intervalo = intervalEnds[0].toISOString().slice(11, 16);
  result.break_minutes = Math.round(breakMs / MS_PER_MINUTE);
  result.total_worked_minutes = Math.round(totalMs / MS_PER_MINUTE);

  if (firstEntrada && isWorkDay) {
    const firstMin = toMinutes(firstEntrada);
    const diff = firstMin - startMin;
    if (diff > schedule.tolerance_minutes) result.late_minutes = diff - schedule.tolerance_minutes;
  }

  const balance = result.total_worked_minutes - result.expected_minutes;
  if (balance > 0) result.overtime_minutes = balance;
  else if (balance < 0 && isWorkDay) result.missing_minutes = Math.abs(balance);

  result.absence = isWorkDay && !firstEntrada;

  for (let i = 0; i < sorted.length - 1; i++) {
    const from = new Date(sorted[i].timestamp || sorted[i].created_at);
    const to = new Date(sorted[i + 1].timestamp || sorted[i + 1].created_at);
    if (isNightPeriod(from, to)) {
      result.night_minutes += Math.round((to.getTime() - from.getTime()) / MS_PER_MINUTE);
    }
  }

  return result;
}

/**
 * Retorna a jornada do funcionário (work_shifts + schedules).
 */
export async function getEmployeeSchedule(employeeId: string, companyId: string): Promise<WorkScheduleInfo | null> {
  if (!isSupabaseConfigured) return null;
  const users = (await db.select('users', [{ column: 'id', operator: 'eq', value: employeeId }], undefined, 1)) as any[];
  const user = users?.[0];
  if (!user?.schedule_id) {
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
  const schedules = (await db.select('schedules', [{ column: 'id', operator: 'eq', value: user.schedule_id }], undefined, 1)) as any[];
  const schedule = schedules?.[0];
  if (!schedule?.shift_id) return null;
  const shifts = (await db.select('work_shifts', [{ column: 'id', operator: 'eq', value: schedule.shift_id }], undefined, 1)) as any[];
  const shift = shifts?.[0];
  if (!shift) return null;

  const start = shift.start_time ? `${String(shift.start_time).slice(0, 5)}` : '08:00';
  const end = shift.end_time ? `${String(shift.end_time).slice(0, 5)}` : '17:00';
  const breakStart = shift.break_start_time ? String(shift.break_start_time).slice(0, 5) : null;
  const breakEnd = shift.break_end_time ? String(shift.break_end_time).slice(0, 5) : null;
  const days = Array.isArray(schedule.days) ? schedule.days : [1, 2, 3, 4, 5];

  return {
    start_time: start,
    end_time: end,
    break_start: breakStart,
    break_end: breakEnd,
    tolerance_minutes: shift.tolerance_minutes ?? 10,
    daily_hours: 8,
    work_days: days,
  };
}

/**
 * Atualiza banco de horas do funcionário (crédito/débito e saldo).
 */
export async function updateBankHours(
  employeeId: string,
  companyId: string,
  dateStr: string,
  hoursToAdd: number,
  hoursToRemove: number,
  source: string
): Promise<{ balance: number }> {
  if (!isSupabaseConfigured) return { balance: 0 };
  const previous = (await db.select(
    'bank_hours',
    [{ column: 'employee_id', operator: 'eq', value: employeeId }],
    { column: 'date', ascending: false },
    1
  )) as any[];
  const prevBalance = previous?.[0]?.balance ?? 0;
  const balance = prevBalance + hoursToAdd - hoursToRemove;

  await db.insert('bank_hours', {
    employee_id: employeeId,
    company_id: companyId,
    date: dateStr,
    hours_added: hoursToAdd,
    hours_removed: hoursToRemove,
    balance,
    source,
  });
  return { balance };
}

/**
 * Fecha a folha de ponto de um mês para todos os funcionários da empresa.
 * Calcula totais, DSR, banco de horas e grava em timesheets com status closed.
 */
export async function closeTimesheet(companyId: string, month: number, year: number): Promise<{ closed: number; errors: string[] }> {
  const errors: string[] = [];
  let closed = 0;
  if (!isSupabaseConfigured) return { closed: 0, errors: ['Supabase não configurado'] };

  const users = (await db.select('users', [{ column: 'company_id', operator: 'eq', value: companyId }])) as any[];
  const employees = users?.filter((u: any) => u.role === 'employee' || u.role === 'admin' || u.role === 'hr') ?? [];

  const firstDay = new Date(year, month - 1, 1);
  const lastDay = new Date(year, month, 0);
  const daysInMonth = lastDay.getDate();

  for (const emp of employees) {
    try {
      const schedule = await getEmployeeSchedule(emp.id, companyId);
      if (!schedule) continue;

      let totalWorked = 0;
      let totalOvertime = 0;
      let totalNight = 0;
      let totalAbsences = 0;
      let totalDelays = 0;

      for (let d = 1; d <= daysInMonth; d++) {
        const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        const daily = await processDailyTime(emp.id, companyId, dateStr, schedule);
        totalWorked += daily.total_worked_minutes / 60;
        totalOvertime += daily.overtime_minutes / 60;
        totalNight += daily.night_minutes / 60;
        if (daily.absence) totalAbsences += 1;
        totalDelays += daily.late_minutes;
      }

      const overtimeRules = (await db.select('overtime_rules', [{ column: 'company_id', operator: 'eq', value: companyId }], undefined, 1)) as any[];
      const rules = overtimeRules?.[0];
      const dsrEnabled = rules?.dsr_enabled !== false;
      const dsrValue = dsrEnabled && totalOvertime > 0
        ? totalOvertime / 7
        : 0;

      const bankRows = (await db.select(
        'bank_hours',
        [{ column: 'employee_id', operator: 'eq', value: emp.id }],
        { column: 'date', ascending: false },
        1
      )) as any[];
      const bankBalance = bankRows?.[0]?.balance ?? 0;

      const payload = {
        employee_id: emp.id,
        company_id: companyId,
        month,
        year,
        total_worked_hours: Math.round(totalWorked * 100) / 100,
        total_overtime: Math.round(totalOvertime * 100) / 100,
        total_night_hours: Math.round(totalNight * 100) / 100,
        total_absences: totalAbsences,
        total_delays: totalDelays,
        dsr_value: Math.round(dsrValue * 100) / 100,
        bank_hours_balance: bankBalance,
        status: 'closed',
        closed_at: new Date().toISOString(),
      };
      const existing = (await db.select(
        'timesheets',
        [
          { column: 'employee_id', operator: 'eq', value: emp.id },
          { column: 'month', operator: 'eq', value: month },
          { column: 'year', operator: 'eq', value: year },
        ],
        undefined,
        1
      )) as any[];
      if (existing?.[0]?.id) {
        await db.update('timesheets', existing[0].id, payload);
      } else {
        await db.insert('timesheets', payload);
      }
      closed += 1;
    } catch (e: any) {
      errors.push(`${emp.nome || emp.id}: ${e?.message || 'Erro'}`);
    }
  }

  return { closed, errors };
}

/**
 * Valida sequência de batidas: não permitir duas entradas seguidas, duas saídas seguidas, intervalo sem entrada.
 */
export function validatePunchSequence(records: RawTimeRecord[], newType: string): { valid: boolean; error?: string } {
  const type = normalizeType(newType);
  if (records.length === 0) {
    if (type !== 'entrada') return { valid: false, error: 'Primeira marcação do dia deve ser Entrada.' };
    return { valid: true };
  }
  const sorted = [...records].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );
  const last = normalizeType(sorted[sorted.length - 1].type);
  if (last === type) {
    if (type === 'entrada') return { valid: false, error: 'Não é permitido duas entradas seguidas.' };
    if (type === 'saída') return { valid: false, error: 'Não é permitido duas saídas seguidas.' };
    if (type === 'pausa') {
      return {
        valid: false,
        error: 'Não é permitido duas pausas seguidas. Finalize o intervalo com Entrada (retorno) antes de nova pausa.',
      };
    }
  }
  if (last === 'pausa' && type === 'saída') return { valid: false, error: 'Após pausa, registre retorno (Entrada) antes da Saída.' };
  if (last === 'saída' && type === 'pausa')
    return { valid: false, error: 'Após saída, registre uma nova entrada antes do intervalo.' };
  return { valid: true };
}
