import { observabilityConsole } from '../shared/logger/observabilityConsole';
import { normalizeOperationalDate, OPERATIONAL_TIMEZONE } from './operationalDateHardLock';

const MAX_FUTURE_MS = 2 * 60 * 1000;
const MIN_YEAR = 2024;

type TemporalMemory = { instantMs: number };
const byKey = new Map<string, TemporalMemory>();

export function getStrictOperationalNow(): number {
  return Date.now();
}

export function assertOperationalTimezone(): boolean {
  const ok = OPERATIONAL_TIMEZONE === 'America/Sao_Paulo';
  if (!ok) observabilityConsole.warn('[STRICT REALTIME CLOCK BLOCK]', { reason: 'timezone', timezone: OPERATIONAL_TIMEZONE });
  return ok;
}

export function assertOperationalYear(instantMs: number, nowMs = getStrictOperationalNow()): boolean {
  const year = new Date(instantMs).getUTCFullYear();
  const maxYear = new Date(nowMs).getUTCFullYear() + 1;
  if (year < MIN_YEAR || year > maxYear) {
    observabilityConsole.warn('[INVALID OPERATIONAL YEAR]', { year, min_year: MIN_YEAR, max_year: maxYear });
    return false;
  }
  return true;
}

export function assertOperationalRealtimeTimestamp(iso: string, nowMs = getStrictOperationalNow()): { ok: boolean; instantMs?: number } {
  const n = normalizeOperationalDate(iso, { quiet: true, source: 'strictOperationalRealtimeClock' });
  if (!n) {
    observabilityConsole.warn('[STRICT REALTIME CLOCK BLOCK]', { reason: 'invalid_parse', iso });
    return { ok: false };
  }
  if (n.instantMs - nowMs > MAX_FUTURE_MS) {
    observabilityConsole.warn('[STRICT REALTIME CLOCK BLOCK]', { reason: 'future', iso, diff_ms: n.instantMs - nowMs });
    return { ok: false };
  }
  if (!assertOperationalYear(n.instantMs, nowMs)) return { ok: false };
  if (!assertOperationalTimezone()) return { ok: false };
  return { ok: true, instantMs: n.instantMs };
}

export function assertOperationalTemporalMonotonicity(key: string, nextInstantMs: number): boolean {
  const prev = byKey.get(key);
  if (prev && nextInstantMs < prev.instantMs) {
    observabilityConsole.warn('[TEMPORAL MONOTONICITY VIOLATION]', {
      key,
      previous_ms: prev.instantMs,
      next_ms: nextInstantMs,
    });
    return false;
  }
  byKey.set(key, { instantMs: nextInstantMs });
  return true;
}

