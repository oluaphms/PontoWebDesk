import { DateTime } from 'luxon';

const DEFAULT_OPERATIONAL_TIMEZONE = 'America/Sao_Paulo';

/**
 * Converte data (YYYY-MM-DD) + hora (HH:mm) no fuso operacional da empresa em ISO UTC.
 * O padrão fixo evita que navegador/host em UTC reprocesse uma batida digitada no horário do Brasil.
 */
export function localDateAndTimeToIsoUtc(
  dateYmd: string,
  timeHm: string,
  timezone: string = DEFAULT_OPERATIONAL_TIMEZONE,
): string {
  const datePart = (dateYmd || '').trim().slice(0, 10);
  const timePart = ((timeHm || '').trim() || '00:00').slice(0, 5);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datePart)) {
    throw new RangeError(`Data inválida para registro (use AAAA-MM-DD): "${dateYmd}"`);
  }
  const [ys, ms, ds] = datePart.split('-');
  const [hs, mins] = timePart.split(':');
  const y = parseInt(ys || '0', 10);
  const mo = parseInt(ms || '1', 10);
  const d = parseInt(ds || '1', 10);
  const hh = parseInt(hs !== undefined ? hs : '0', 10);
  const mm = parseInt(mins !== undefined ? mins : '0', 10);
  if (
    !Number.isFinite(y) ||
    !Number.isFinite(mo) ||
    !Number.isFinite(d) ||
    !Number.isFinite(hh) ||
    !Number.isFinite(mm)
  ) {
    throw new RangeError(`Data ou horário inválido: "${dateYmd}" "${timeHm}"`);
  }
  const dt = DateTime.fromObject(
    { year: y, month: mo, day: d, hour: hh, minute: mm, second: 0, millisecond: 0 },
    { zone: timezone || DEFAULT_OPERATIONAL_TIMEZONE },
  );
  if (!dt.isValid) {
    throw new RangeError(`Combinação data/hora inválida no calendário local: ${datePart} ${timePart}`);
  }
  const iso = dt.toUTC().toISO();
  if (!iso) {
    throw new RangeError(`Não foi possível normalizar data/hora: ${datePart} ${timePart}`);
  }
  return iso;
}

/** YYYY-MM-DD no calendário local (não UTC) — alinha agrupamento do espelho com a data escolhida no formulário. */
export function localCalendarYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Reexport: definição canônica em `calendarUtils` (dia civil único). */
export { localCalendarDayEndUtc, localCalendarDayStartUtc } from './calendarUtils';

/** Lista cada dia civil entre start e end (inclusive), em YYYY-MM-DD local. */
export function enumerateLocalCalendarDays(startYmd: string, endYmd: string): string[] {
  const dates: string[] = [];
  const start = new Date(startYmd + 'T00:00:00');
  const end = new Date(endYmd + 'T00:00:00');
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    dates.push(localCalendarYmd(d));
  }
  return dates;
}
