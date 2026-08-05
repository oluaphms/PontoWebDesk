import { observabilityConsole } from '../shared/logger/observabilityConsole';
/**
 * Hard lock de datas operacionais: fuso fixo America/Sao_Paulo (Luxon).
 * Evita mistura UTC/local e horários futuros espúrios em pipelines de monitoramento.
 */

import { DateTime } from 'luxon';
import { opLog } from './operationalLogger';

export const OPERATIONAL_TIMEZONE = 'America/Sao_Paulo';

/** Alinhado ao tolerância de batida futura em monitoramento. */
export const OPERATIONAL_FUTURE_TOLERANCE_MS = 5 * 60 * 1000;

export type NormalizeOperationalDateOptions = {
  /** Loga normalização bem-sucedida (evitar em hot paths). */
  log?: boolean;
  /** Identificador do chamador para auditoria. */
  source?: string;
  /** Não emite `[INVALID OPERATIONAL DATE SOURCE]` (ex.: checagens booleanas). */
  quiet?: boolean;
};

/**
 * Normaliza instante para ISO UTC canônico. Entrada pode ser ISO com zona, epoch ou Date.
 */
export function normalizeOperationalDate(
  input: string | number | Date | null | undefined,
  opts?: NormalizeOperationalDateOptions,
): { utcIso: string; instantMs: number } | null {
  if (input == null) {
    if (!opts?.quiet) logInvalidOperationalDateSource('null_or_undefined', opts?.source);
    return null;
  }

  let dt: DateTime;
  if (input instanceof Date) {
    if (!Number.isFinite(input.getTime())) {
      if (!opts?.quiet) logInvalidOperationalDateSource('invalid_date_object', opts?.source);
      return null;
    }
    dt = DateTime.fromMillis(input.getTime(), { zone: 'utc' });
  } else if (typeof input === 'number') {
    if (!Number.isFinite(input)) {
      if (!opts?.quiet) logInvalidOperationalDateSource('invalid_epoch', opts?.source);
      return null;
    }
    dt = DateTime.fromMillis(input, { zone: 'utc' });
  } else {
    const raw = String(input).trim();
    if (!raw) {
      if (!opts?.quiet) logInvalidOperationalDateSource('empty_string', opts?.source);
      return null;
    }
    dt = DateTime.fromISO(raw, { setZone: true });
    if (!dt.isValid) {
      const t = Date.parse(raw);
      if (!Number.isFinite(t)) {
        if (!opts?.quiet) logInvalidOperationalDateSource('unparseable_string', opts?.source, { raw: raw.slice(0, 80) });
        return null;
      }
      dt = DateTime.fromMillis(t, { zone: 'utc' });
    }
  }

  const utcIso = dt.toUTC().toISO();
  if (!utcIso) {
    if (!opts?.quiet) logInvalidOperationalDateSource('luxon_no_utc_iso', opts?.source);
    return null;
  }
  const instantMs = dt.toMillis();
  if (opts?.log) {
    observabilityConsole.info('[OPERATIONAL DATE NORMALIZED]', {
      utc_iso: utcIso,
      timezone: OPERATIONAL_TIMEZONE,
      source: opts.source ?? 'unknown',
    });
  }
  return { utcIso, instantMs };
}

export function logInvalidOperationalDateSource(
  reason: string,
  source?: string,
  extra: Record<string, unknown> = {},
): void {
  observabilityConsole.warn('[INVALID OPERATIONAL DATE SOURCE]', { reason, caller: source ?? 'unknown', ...extra });
}

/** Ajuste opcional alinhado ao `operational_server_epoch_ms()` (Supabase); 0 = relógio local bruto. */
let operationalWallClockOffsetMs = 0;

export function setOperationalWallClockOffsetMs(ms: number): void {
  operationalWallClockOffsetMs = Number.isFinite(ms) ? ms : 0;
}

export function getOperationalWallClockOffsetMs(): number {
  return operationalWallClockOffsetMs;
}

/** Relógio operacional: `Date.now()` + offset de servidor quando sincronizado. */
export function operationalClockMs(): number {
  return Date.now() + operationalWallClockOffsetMs;
}

/**
 * Hora local operacional (pt-BR, HH:mm) a partir de ISO; não usa `Intl` solto fora do Luxon.
 */
export function formatOperationalTimeHmFromIso(
  isoInput: string | null | undefined,
  timezone: string = OPERATIONAL_TIMEZONE,
): string | null {
  const n = normalizeOperationalDate(isoInput, { quiet: true, source: 'formatOperationalTimeHmFromIso' });
  if (!n) return null;
  const local = DateTime.fromMillis(n.instantMs, { zone: 'utc' }).setZone(timezone);
  return local.toFormat('HH:mm');
}

/**
 * true se o instante está além do horizonte futuro permitido (operacional).
 */
export function isFutureOperationalTimestamp(
  isoInput: string | null | undefined,
  nowMs: number = Date.now(),
  toleranceMs: number = OPERATIONAL_FUTURE_TOLERANCE_MS,
): boolean {
  const n = normalizeOperationalDate(isoInput, { quiet: true, source: 'isFutureOperationalTimestamp' });
  if (!n) return false;
  return n.instantMs - nowMs > toleranceMs;
}

export function logFutureOperationalDateBlocked(
  isoInput: string | null | undefined,
  nowMs: number,
  diffMs: number,
  context: Record<string, unknown> = {},
): void {
  observabilityConsole.warn('[FUTURE DATE BLOCKED]', {
    iso: isoInput,
    now_ms: nowMs,
    diff_ms: diffMs,
    timezone: OPERATIONAL_TIMEZONE,
    ...context,
  });
}

/**
 * Início/fim do dia civil em `timezone` (padrão SP), retornando limites em ISO UTC.
 */
export function buildOperationalDayRange(
  dateYmd: string,
  timezone: string = OPERATIONAL_TIMEZONE,
): { startUtcIso: string; endUtcIso: string; dateYmd: string; timezone: string } {
  const start = DateTime.fromISO(dateYmd, { zone: timezone }).startOf('day');
  const end = DateTime.fromISO(dateYmd, { zone: timezone }).endOf('day');
  opLog.diag('TIMEZONE HARDLOCK', {
    op: 'buildOperationalDayRange',
    dateYmd,
    timezone,
    start_utc: start.toUTC().toISO(),
    end_utc: end.toUTC().toISO(),
  });
  return {
    startUtcIso: start.toUTC().toISO() ?? '',
    endUtcIso: end.toUTC().toISO() ?? '',
    dateYmd,
    timezone,
  };
}

/** "Hoje" civil operacional (YYYY-MM-DD) em America/Sao_Paulo. */
export function getOperationalTodayYmd(timezone: string = OPERATIONAL_TIMEZONE): string {
  return DateTime.now().setZone(timezone).toISODate() ?? '';
}

/**
 * Agora como ISO UTC derivado do relógio ancorado no fuso operacional (sem `new Date().toISOString()` solto em caminhos operacionais).
 */
export function operationalNowUtcIso(timezone: string = OPERATIONAL_TIMEZONE): string {
  const utc = DateTime.now().setZone(timezone).toUTC().toISO();
  return utc ?? DateTime.utc().toISO() ?? '';
}
