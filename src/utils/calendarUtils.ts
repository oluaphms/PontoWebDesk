/**
 * Dia civil único (fusos locais do runtime) — espelho, filtros `timestamptz` e UI.
 * Centraliza `calendarDateForEspelhoRow`, `localCalendarDayStartUtc`, `localCalendarDayEndUtc`.
 */
import { opLog } from './operationalLogger';

/** Mínimo para ancorar batida em dia civil (alinhado a `TimeRecord` sem importar timesheetMirror). */
export type CalendarDayRecordAnchor = {
  timestamp?: string | null;
  created_at: string;
};

function recordAnchorIso(record: CalendarDayRecordAnchor): string {
  const ts = record.timestamp;
  const ca = record.created_at;
  if (ts && String(ts).trim()) return ts;
  if (ca && String(ca).trim()) return ca;
  return new Date().toISOString();
}

/**
 * Data civil local (YYYY-MM-DD) a partir de um instante ISO — alinha com filtros em UTC e batidas gravadas em horário local.
 */
export function extractLocalCalendarDateFromIso(isoString: string): string {
  const date = new Date(isoString);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Data civil (YYYY-MM-DD) para agrupar a batida no espelho.
 * Sempre usa o dia do horário oficial (`timestamp`); só recorre a `created_at` quando não há timestamp.
 * Não reatribui batidas de ontem/importação AFD para «hoje» só porque foram gravadas hoje na base.
 */
export function calendarDateForEspelhoRow(
  record: CalendarDayRecordAnchor,
  _periodStartYmd?: string,
  _periodEndYmd?: string,
): string {
  const ts = record.timestamp;
  if (ts && String(ts).trim()) {
    return extractLocalCalendarDateFromIso(ts);
  }
  return extractLocalCalendarDateFromIso(record.created_at);
}

/** Início do dia civil local (00:00) em ISO UTC — filtros `created_at` / `timestamptz`. */
export function localCalendarDayStartUtc(dateYmd: string): string {
  const datePart = (dateYmd || '').trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datePart)) {
    throw new RangeError(`Data inválida para dia civil (use AAAA-MM-DD): "${dateYmd}"`);
  }
  const [ys, ms, ds] = datePart.split('-');
  const y = parseInt(ys || '0', 10);
  const mo = parseInt(ms || '1', 10);
  const d = parseInt(ds || '1', 10);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) {
    throw new RangeError(`Data inválida: "${dateYmd}"`);
  }
  const dt = new Date(y, mo - 1, d, 0, 0, 0, 0);
  if (Number.isNaN(dt.getTime())) {
    throw new RangeError(`Combinação data inválida no calendário local: ${datePart}`);
  }
  return dt.toISOString();
}

/** Fim do dia civil local (23:59:59.999) em ISO UTC — filtros `created_at` / `timestamptz`. */
export function localCalendarDayEndUtc(dateYmd: string): string {
  const datePart = (dateYmd || '').trim().slice(0, 10);
  const [ys, ms, ds] = datePart.split('-');
  const y = parseInt(ys || '0', 10);
  const mo = parseInt(ms || '1', 10);
  const d = parseInt(ds || '1', 10);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) {
    return new Date().toISOString();
  }
  const dt = new Date(y, mo - 1, d, 23, 59, 59, 999);
  if (Number.isNaN(dt.getTime())) {
    return new Date().toISOString();
  }
  return dt.toISOString();
}

/** Debug: mesmo dia civil usado em query de batidas, verificação pós-recalc e agrupamento. */
export function logCalendarDayConsistencyDebug(params: { user_id: string; date: string }): void {
  const date = String(params.date || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
  let start_utc: string;
  let end_utc: string;
  try {
    start_utc = localCalendarDayStartUtc(date);
    end_utc = localCalendarDayEndUtc(date);
  } catch {
    return;
  }
  opLog.diag('CALENDAR DAY CONSISTENCY', {
    user_id: params.user_id,
    date,
    start_utc,
    end_utc,
  });
}
