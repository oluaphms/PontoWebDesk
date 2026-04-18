/**
 * Processamento de jornada diária, escalas e banco de horas.
 * Usado por payrollCalculator, timeEngine e fechamento de folha.
 */

import { db, isSupabaseConfigured, supabase } from './supabaseClient';
import type { SupabaseClient } from '@supabase/supabase-js';

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
}

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

function normalizePunchType(t: string | undefined): string {
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
export function validatePunchSequence(
  dayRecords: RawTimeRecord[],
  nextTypeRaw: string
): { valid: boolean; error?: string } {
  const next = normalizePunchType(nextTypeRaw);
  const sorted = sortedByTime(dayRecords);
  const lastRec = sorted[sorted.length - 1];
  const last = lastRec ? normalizePunchType(lastRec.type) : null;

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

/**
 * Busca registros de ponto do colaborador em uma data (timezone local do ISO).
 */
export async function getDayRecords(employeeId: string, dateStr: string): Promise<RawTimeRecord[]> {
  if (!isSupabaseConfigured) return [];

  const start = `${dateStr}T00:00:00`;
  const end = `${dateStr}T23:59:59.999`;

  try {
    const rows = (await db.select('time_records', [
      { column: 'user_id', operator: 'eq', value: employeeId },
      { column: 'created_at', operator: 'gte', value: start },
      { column: 'created_at', operator: 'lte', value: end },
    ], { column: 'created_at', ascending: true })) as RawTimeRecord[];

    return Array.isArray(rows) ? rows : [];
  } catch (e) {
    console.warn('[timeProcessingService] getDayRecords:', e);
    return [];
  }
}

/**
 * Busca escala padrão do colaborador (users → schedules → work_shifts).
 */
export async function getEmployeeSchedule(
  employeeId: string,
  companyId: string
): Promise<WorkScheduleInfo | null> {
  if (!isSupabaseConfigured || !employeeId) return null;

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
    )) as { shift_id?: string | null; work_days?: number[] | null }[];

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

    const start_time = padTime(
      (sh.start_time || sh.entry_time) as string | undefined,
      '08:00'
    );
    const end_time = padTime((sh.end_time || sh.exit_time) as string | undefined, '17:00');

    let break_start = padTime(sh.break_start_time as string | undefined, '12:00');
    let break_end = padTime(sh.break_end_time as string | undefined, '13:00');
    const breakMin = Number(sh.break_minutes ?? 60);
    if (
      (!sh.break_start_time && !sh.break_end_time && breakMin > 0) ||
      timeToMinutes(break_end) <= timeToMinutes(break_start)
    ) {
      const sm = timeToMinutes(start_time) + Math.floor((timeToMinutes(end_time) - timeToMinutes(start_time)) / 2);
      break_start = `${String(Math.floor(sm / 60)).padStart(2, '0')}:${String(sm % 60).padStart(2, '0')}`;
      const em = sm + breakMin;
      break_end = `${String(Math.floor(em / 60)).padStart(2, '0')}:${String(em % 60).padStart(2, '0')}`;
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
      work_days: Array.isArray(schedules[0]?.work_days) ? (schedules[0].work_days as number[]) : [1, 2, 3, 4, 5],
    };
  } catch (e) {
    console.warn('[timeProcessingService] getEmployeeSchedule:', e);
    return null;
  }
}

function summarizeDayRecords(records: RawTimeRecord[]): {
  totalMinutes: number;
  entrada: string | null;
  saida: string | null;
  inicio_intervalo: string | null;
  fim_intervalo: string | null;
} {
  const sorted = [...records].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );

  let firstEntrada: Date | null = null;
  let lastSaida: Date | null = null;
  let intervaloSaidaAt: Date | null = null;
  let breakMs = 0;
  let displayInicioInt: Date | null = null;
  let displayFimInt: Date | null = null;

  for (const r of sorted) {
    const t = new Date(r.created_at);
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
  };
}

/**
 * Processa um dia: minutos trabalhados, esperados, extras e atraso na entrada.
 */
export async function processDailyTime(
  employeeId: string,
  companyId: string,
  dateStr: string,
  schedule: WorkScheduleInfo
): Promise<DailyProcessResult> {
  const records = await getDayRecords(employeeId, dateStr);
  const { totalMinutes, entrada, saida, inicio_intervalo, fim_intervalo } = summarizeDayRecords(records);

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
  if (!isSupabaseConfigured) return { balance: 0 };

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
// Fechamento de folha (já usado pela UI)
// ---------------------------------------------------------------------------

export async function closeTimesheet(
  companyId: string,
  month: number,
  year: number,
  userId?: string
) {
  const client = supabase as SupabaseClient | null;
  if (!client) throw new Error('Supabase não inicializado');

  const { data, error } = await client
    .from('timesheet_closures')
    .insert({
      company_id: companyId,
      month,
      year,
      user_id: userId,
      closed_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function isTimesheetClosed(
  companyId: string,
  month: number,
  year: number
): Promise<boolean> {
  const client = supabase as SupabaseClient | null;
  if (!client) return false;

  const { data, error } = await client
    .from('timesheet_closures')
    .select('id')
    .eq('company_id', companyId)
    .eq('month', month)
    .eq('year', year)
    .maybeSingle();

  if (error) throw error;
  return !!data;
}
