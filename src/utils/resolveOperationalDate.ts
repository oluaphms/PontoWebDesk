/**
 * Data operacional única da plataforma (YYYY-MM-DD).
 * Regra: a jornada que atravessa meia-noite pertence à data da primeira entrada.
 */

import { DateTime } from 'luxon';
import { calendarDateForEspelhoRow } from './calendarUtils';
import { isRhAdjustmentOrigin, recordPunchInstantIso } from './punchOrigin';
import { OPERATIONAL_TIMEZONE } from './operationalDateHardLock';

/** Duração máxima de jornada noturna contínua (22:00 → até 10:00 do dia seguinte). */
export const MAX_NIGHT_JOURNEY_MINUTES = 12 * 60;

export interface DayScheduleSlots {
  entrada: string;
  saida_intervalo: string;
  volta_intervalo: string;
  saida_final: string;
  toleranceMin?: number;
}

export type OperationalDateRecord = {
  id: string;
  timestamp?: string | null;
  created_at?: string | null;
  type?: string | null;
  metadata?: unknown;
  raw_data?: unknown;
  source?: string | null;
  method?: string | null;
  manual_reason?: string | null;
};

export type OperationalDateContext = {
  periodStartYmd: string;
  periodEndYmd: string;
  scheduleByDay?: (date: string) => DayScheduleSlots | null | undefined;
};

export type ResolveOperationalDateOptions = OperationalDateContext;

function addDaysYmd(ymd: string, delta: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(y, (m || 1) - 1, (d || 1) + delta);
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

function hhmmToMinutes(hhmm: string): number {
  const [h, m] = String(hhmm || '00:00').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

/** Data de linha declarada pelo RH (metadata RPC). */
export function readAdminMirrorDateYmd(record: OperationalDateRecord): string | null {
  const bags: unknown[] = [record.metadata, record.raw_data];
  for (const bag of bags) {
    if (!bag || typeof bag !== 'object') continue;
    const obj = bag as Record<string, unknown>;
    const nested =
      obj.metadata && typeof obj.metadata === 'object'
        ? (obj.metadata as Record<string, unknown>)
        : null;
    const raw = obj.mirror_date_ymd ?? obj.admin_mirror_date ?? nested?.mirror_date_ymd;
    const s = String(raw ?? '').trim().slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  }
  return null;
}

/** Turno com entrada após saída final (ex.: 22:00 → 06:00). */
export function isNightShiftSchedule(schedule: DayScheduleSlots): boolean {
  return hhmmToMinutes(schedule.entrada) > hhmmToMinutes(schedule.saida_final);
}

export function localMinutesFromOperationalIso(iso: string): number {
  const dt = DateTime.fromISO(iso, { zone: 'utc' }).setZone(OPERATIONAL_TIMEZONE);
  if (!dt.isValid) return 0;
  return dt.hour * 60 + dt.minute;
}

/**
 * Limite de minutos (relógio civil do dia seguinte) para batidas ainda na jornada noturna iniciada ontem.
 */
export function nightJourneyPostMidnightCutoffMinutes(schedule: DayScheduleSlots): number {
  const entradaMin = hhmmToMinutes(schedule.entrada);
  const scheduleCutoff = hhmmToMinutes(schedule.saida_final) + (schedule.toleranceMin ?? 60);
  const journeyCapMin = (entradaMin + MAX_NIGHT_JOURNEY_MINUTES) % (24 * 60);
  return Math.max(scheduleCutoff, journeyCapMin);
}

export function postMidnightBelongsToPreviousNightJourney(
  timeMin: number,
  prevSchedule: DayScheduleSlots,
): boolean {
  if (!isNightShiftSchedule(prevSchedule)) return false;
  return timeMin <= nightJourneyPostMidnightCutoffMinutes(prevSchedule);
}

/**
 * Resolve a data operacional (YYYY-MM-DD) de uma batida.
 * Ponto único de verdade — nenhum módulo deve reimplementar agrupamento noturno.
 */
export function resolveOperationalDate(
  record: OperationalDateRecord,
  ctx: ResolveOperationalDateOptions,
): string {
  return getOperationalDate(record, ctx);
}

/** Alias público solicitado na especificação. */
export function getOperationalDate(
  record: OperationalDateRecord,
  ctx: ResolveOperationalDateOptions,
): string {
  const declared = readAdminMirrorDateYmd(record);
  if (declared) return declared;

  const civil = calendarDateForEspelhoRow(record, ctx.periodStartYmd, ctx.periodEndYmd);
  if (isRhAdjustmentOrigin(record)) return civil;

  const scheduleByDay = ctx.scheduleByDay;
  if (!scheduleByDay) return civil;

  const iso = recordPunchInstantIso(record);
  const timeMin = localMinutesFromOperationalIso(iso);
  const yesterday = addDaysYmd(civil, -1);
  if (yesterday < ctx.periodStartYmd.slice(0, 10)) return civil;

  const prevSchedule = scheduleByDay(yesterday);
  if (prevSchedule && postMidnightBelongsToPreviousNightJourney(timeMin, prevSchedule)) {
    return yesterday;
  }

  return civil;
}

/** Mapa record_id → operational_date para lote na mesma janela. */
export function buildOperationalDateIndex(
  records: OperationalDateRecord[],
  ctx: OperationalDateContext,
): Map<string, string> {
  const index = new Map<string, string>();
  for (const r of records) {
    index.set(r.id, resolveOperationalDate(r, ctx));
  }
  return index;
}

export function filterRecordsByOperationalDate<T extends OperationalDateRecord>(
  records: T[],
  operationalDateYmd: string,
  ctx: OperationalDateContext,
): T[] {
  return records.filter((r) => resolveOperationalDate(r, ctx) === operationalDateYmd);
}

/**
 * Janela de busca em UTC para carregar batidas de um dia operacional (inclui madrugada do dia civil seguinte).
 */
export function buildOperationalDateFetchBoundsUtc(
  operationalDateYmd: string,
  scheduleByDay?: (date: string) => DayScheduleSlots | null | undefined,
): { startUtc: string; endUtc: string } {
  const day = operationalDateYmd.slice(0, 10);
  const schedule = scheduleByDay?.(day) ?? null;
  const nextDay = addDaysYmd(day, 1);
  const start = DateTime.fromISO(day, { zone: OPERATIONAL_TIMEZONE }).startOf('day');
  let end = DateTime.fromISO(nextDay, { zone: OPERATIONAL_TIMEZONE }).endOf('day');
  if (schedule && isNightShiftSchedule(schedule)) {
    const cutoffMin = nightJourneyPostMidnightCutoffMinutes(schedule);
    const h = Math.floor(cutoffMin / 60);
    const m = cutoffMin % 60;
    const capEnd = DateTime.fromISO(nextDay, { zone: OPERATIONAL_TIMEZONE }).set({
      hour: h,
      minute: m,
      second: 59,
      millisecond: 999,
    });
    if (capEnd > end) end = capEnd;
  }
  return {
    startUtc: start.toUTC().toISO() ?? '',
    endUtc: end.toUTC().toISO() ?? '',
  };
}

/**
 * Minutos trabalhados em jornada noturna na mesma linha operacional (entrada 22:00 → saída 07:24).
 */
export function computeNightAwareWorkedMinutes(
  operationalDateYmd: string,
  entradaHhmm: string,
  saidaHhmm: string,
  intervaloSaidaHhmm?: string | null,
  voltaIntervaloHhmm?: string | null,
): number {
  const toMs = (hhmm: string, dayOffset = 0): number => {
    const ymd = addDaysYmd(operationalDateYmd, dayOffset);
    const dt = DateTime.fromISO(`${ymd}T${hhmm}`, { zone: OPERATIONAL_TIMEZONE });
    return dt.isValid ? dt.toMillis() : 0;
  };

  const entradaMs = toMs(entradaHhmm, 0);
  let saidaMs = toMs(saidaHhmm, 0);
  if (saidaMs <= entradaMs) saidaMs = toMs(saidaHhmm, 1);

  let worked = Math.round((saidaMs - entradaMs) / 60000);
  if (intervaloSaidaHhmm && voltaIntervaloHhmm) {
    let intSaidaMs = toMs(intervaloSaidaHhmm, 0);
    let intVoltaMs = toMs(voltaIntervaloHhmm, 0);
    if (intSaidaMs < entradaMs) intSaidaMs = toMs(intervaloSaidaHhmm, 1);
    if (intVoltaMs < intSaidaMs) intVoltaMs = toMs(voltaIntervaloHhmm, 1);
    worked -= Math.round((intVoltaMs - intSaidaMs) / 60000);
  }
  return Math.max(0, worked);
}

/**
 * Jornada ainda aberta (última batida não é saída final).
 */
export function isJourneyStructurallyOpen(records: OperationalDateRecord[]): boolean {
  if (!records.length) return false;
  const sorted = [...records].sort(
    (a, b) =>
      new Date(recordPunchInstantIso(a)).getTime() - new Date(recordPunchInstantIso(b)).getTime(),
  );
  const last = sorted[sorted.length - 1]!;
  const t = String(last.type ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
  return t !== 'saida';
}

/**
 * Jornada aberta dentro da janela máxima (entrada/retorno sem saída final).
 */
export function isOpenNightJourney(
  records: OperationalDateRecord[],
  nowMs: number = Date.now(),
): boolean {
  if (!records.length) return false;
  const sorted = [...records].sort(
    (a, b) =>
      new Date(recordPunchInstantIso(a)).getTime() - new Date(recordPunchInstantIso(b)).getTime(),
  );
  const last = sorted[sorted.length - 1]!;
  const t = String(last.type ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
  if (t !== 'entrada' && t !== 'intervalo_volta') return false;
  if (nowMs == null) return isJourneyStructurallyOpen(records);
  const lastMs = new Date(recordPunchInstantIso(last)).getTime();
  return nowMs - lastMs <= MAX_NIGHT_JOURNEY_MINUTES * 60_000;
}

export { addDaysYmd };
