/**
 * Relógio operacional único para monitoramento GEO / COS / live (evita mistura solta de Date/UTC).
 */

import {
  normalizeOperationalDate,
  operationalClockMs as clockMs,
  operationalNowUtcIso as nowUtcIso,
  OPERATIONAL_TIMEZONE,
  setOperationalWallClockOffsetMs,
  getOperationalWallClockOffsetMs,
} from './operationalDateHardLock';

/** Futuro além disso é bloqueado em caminhos de monitoramento GEO (alinhado à especificação produção). */
export const MONITORING_GEO_FUTURE_TOLERANCE_MS = 2 * 60 * 1000;

/** Idade máxima da captura GPS em fontes “tempo real” (live/COS) antes de rejeitar candidato. */
export const MONITORING_REALTIME_MAX_CAPTURE_AGE_MS = 5 * 60 * 1000;

/** Ocultar marcador / tratar localização expirada na UI. */
export const MONITORING_MARKER_STALE_HIDE_MS = 5 * 60 * 1000;

export { OPERATIONAL_TIMEZONE, setOperationalWallClockOffsetMs, getOperationalWallClockOffsetMs };

export function operationalClockMs(): number {
  return clockMs();
}

export function operationalNowUtcIso(timezone: string = OPERATIONAL_TIMEZONE): string {
  return nowUtcIso(timezone);
}

/** Instante “agora” como Date; use só quando a API exigir Date (ex.: timers). */
export function operationalNow(): Date {
  return new Date(operationalClockMs());
}

export function normalizeOperationalTimestamp(
  input: string | number | Date | null | undefined,
  opts?: { source?: string; log?: boolean },
): { utcIso: string; instantMs: number } | null {
  const n = normalizeOperationalDate(input, { quiet: true, source: opts?.source ?? 'operationalClock' });
  if (n && opts?.log) {
    console.info('[OPERATIONAL CLOCK NORMALIZED]', { utc_iso: n.utcIso, source: opts?.source ?? 'operationalClock' });
  }
  return n;
}

export function isOperationalTimestampFuture(
  iso: string | null | undefined,
  nowMs: number = operationalClockMs(),
  toleranceMs: number = MONITORING_GEO_FUTURE_TOLERANCE_MS,
): boolean {
  const n = normalizeOperationalDate(iso, { quiet: true, source: 'isOperationalTimestampFuture' });
  if (!n) return false;
  return n.instantMs - nowMs > toleranceMs;
}

export function isOperationalTimestampStale(
  iso: string | null | undefined,
  nowMs: number = operationalClockMs(),
  maxAgeMs: number = MONITORING_REALTIME_MAX_CAPTURE_AGE_MS,
): boolean {
  const n = normalizeOperationalDate(iso, { quiet: true, source: 'isOperationalTimestampStale' });
  if (!n) return true;
  return nowMs - n.instantMs > maxAgeMs;
}
