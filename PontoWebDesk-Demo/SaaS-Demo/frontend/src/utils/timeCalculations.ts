import { TimeRecord, LogType } from '../../types';
import { getRecordCreatedAtDate } from '../../services/pontoService';

export interface DailyBalance {
  date: string;
  workedHours: number;
  expectedHours: number;
  balanceHours: number;
  lateMinutes: number;
  overtimeMinutes: number;
  missingMinutes: number;
}

export interface MonthlyBalance {
  month: string;
  totalWorkedHours: number;
  totalExpectedHours: number;
  extraHours: number;
  debitHours: number;
  finalBalance: number;
  days: DailyBalance[];
}

export interface WorkSchedule {
  id: string;
  name: string;
  start_time: string; // HH:mm
  end_time: string;   // HH:mm
  break_start?: string | null;
  break_end?: string | null;
  tolerance_minutes?: number | null;
}

const MS_IN_HOUR = 1000 * 60 * 60;
const MS_IN_MINUTE = 1000 * 60;

const TABLE_DATE_PT_BR: Intl.DateTimeFormatOptions = {
  weekday: 'short',
  day: '2-digit',
  month: 'short',
  year: 'numeric',
};

/** Rótulo de dia para tabelas (pt-BR), evitando `toDateString()` em inglês. */
function formatDayLabelPtBr(d: Date): string {
  return new Intl.DateTimeFormat('pt-BR', TABLE_DATE_PT_BR).format(d);
}

/** Formata data vinda do banco (ISO ou `YYYY-MM-DD`) para exibição em pt-BR. */
export function formatDateForTablePtBr(isoOrDate: string | Date): string {
  const d =
    typeof isoOrDate === 'string'
      ? new Date(isoOrDate.includes('T') ? isoOrDate : `${isoOrDate.slice(0, 10)}T12:00:00`)
      : isoOrDate;
  if (Number.isNaN(d.getTime())) {
    return typeof isoOrDate === 'string' ? isoOrDate : '—';
  }
  return new Intl.DateTimeFormat('pt-BR', TABLE_DATE_PT_BR).format(d);
}

function parseTimeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

function msToHours(ms: number): number {
  return ms / MS_IN_HOUR;
}

export function calculateWorkedHours(records: TimeRecord[], date: Date): number {
  const target = date.toDateString();
  const dayRecords = records
    .map((r) => ({ r, d: getRecordCreatedAtDate(r) }))
    .filter((x): x is { r: TimeRecord; d: Date } => x.d !== null && x.d.toDateString() === target)
    .map(({ r, d }) => ({ r, createdAt: d }))
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  if (dayRecords.length === 0) return 0;

  let totalMs = 0;
  let lastIn: number | null = null;

  for (const { r: rec, createdAt } of dayRecords) {
    if (rec.type === LogType.IN) {
      lastIn = createdAt.getTime();
    } else if (lastIn && (rec.type === LogType.OUT || rec.type === LogType.BREAK)) {
      totalMs += createdAt.getTime() - lastIn;
      lastIn = null;
    }
  }

  // Se ainda está trabalhando, conta até agora
  if (lastIn) {
    totalMs += Date.now() - lastIn;
  }

  return msToHours(totalMs);
}

export function calculateDailyBalance(
  records: TimeRecord[],
  date: Date,
  schedule: WorkSchedule,
): DailyBalance {
  const workedHours = calculateWorkedHours(records, date);

  const startMinutes = parseTimeToMinutes(schedule.start_time);
  const endMinutes = parseTimeToMinutes(schedule.end_time);
  const expectedMinutes = endMinutes - startMinutes;

  let breakMinutes = 0;
  if (schedule.break_start && schedule.break_end) {
    breakMinutes = parseTimeToMinutes(schedule.break_end) - parseTimeToMinutes(schedule.break_start);
  }

  const netExpectedMinutes = expectedMinutes - breakMinutes;
  const expectedHours = netExpectedMinutes / 60;

  const balanceHours = workedHours - expectedHours;

  // Atraso: diferença entre primeiro IN e horário de início (respeitando tolerância)
  const tolerance = schedule.tolerance_minutes ?? 0;
  const targetDateStr = date.toDateString();
  const dayRecords = records
    .map((r) => ({ r, d: getRecordCreatedAtDate(r) }))
    .filter((x): x is { r: TimeRecord; d: Date } => x.d !== null && x.d.toDateString() === targetDateStr)
    .map(({ r, d }) => ({ r, createdAt: d }))
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  let lateMinutes = 0;
  if (dayRecords.length > 0) {
    const firstIn = dayRecords.find((entry) => entry.r.type === LogType.IN);
    if (firstIn) {
      const firstMinutes = firstIn.createdAt.getHours() * 60 + firstIn.createdAt.getMinutes();
      const diff = firstMinutes - startMinutes;
      if (diff > tolerance) lateMinutes = diff;
    }
  }

  const workedMinutes = Math.round(workedHours * 60);
  const balanceMinutes = workedMinutes - netExpectedMinutes;

  const overtimeMinutes = balanceMinutes > 0 ? balanceMinutes : 0;
  const missingMinutes = balanceMinutes < 0 ? Math.abs(balanceMinutes) : 0;

  return {
    date: formatDayLabelPtBr(date),
    workedHours,
    expectedHours,
    balanceHours,
    lateMinutes,
    overtimeMinutes,
    missingMinutes,
  };
}

export function calculateMonthlyBalance(
  records: TimeRecord[],
  schedulesByDate: (date: Date) => WorkSchedule | null,
  month: number,
  year: number,
): MonthlyBalance {
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);

  const days: DailyBalance[] = [];

  for (let d = firstDay.getDate(); d <= lastDay.getDate(); d++) {
    const date = new Date(year, month, d);
    const schedule = schedulesByDate(date);
    if (!schedule) continue; // dia sem escala configurada

    const dayBalance = calculateDailyBalance(records, date, schedule);
    days.push(dayBalance);
  }

  const totalWorkedHours = days.reduce((acc, d) => acc + d.workedHours, 0);
  const totalExpectedHours = days.reduce((acc, d) => acc + d.expectedHours, 0);

  const totalOvertimeMinutes = days.reduce((acc, d) => acc + d.overtimeMinutes, 0);
  const totalMissingMinutes = days.reduce((acc, d) => acc + d.missingMinutes, 0);

  const extraHours = totalOvertimeMinutes / 60;
  const debitHours = totalMissingMinutes / 60;
  const finalBalance = totalWorkedHours - totalExpectedHours;

  return {
    month: `${String(month + 1).padStart(2, '0')}/${year}`,
    totalWorkedHours,
    totalExpectedHours,
    extraHours,
    debitHours,
    finalBalance,
    days,
  };
}

