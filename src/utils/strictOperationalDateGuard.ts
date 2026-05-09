import { normalizeOperationalDate, OPERATIONAL_TIMEZONE } from './operationalDateHardLock';
import { operationalClockMs } from './operationalClock';

const MAX_FUTURE_MS = 2 * 60 * 1000;
const MIN_YEAR = 2020;
const MAX_YEAR_DRIFT = 1;

export type StrictDateGuardResult = {
  ok: boolean;
  reason: 'future' | 'invalid_parse' | 'invalid_year' | 'timezone_drift' | null;
  instantMs: number | null;
};

export function strictOperationalDateGuard(
  input: string | null | undefined,
  nowMs: number = operationalClockMs(),
): StrictDateGuardResult {
  const n = normalizeOperationalDate(input, { quiet: true, source: 'strictOperationalDateGuard' });
  if (!n) return { ok: false, reason: 'invalid_parse', instantMs: null };
  if (n.instantMs - nowMs > MAX_FUTURE_MS) {
    console.warn('[STRICT FUTURE DATE BLOCKED]', { input, now_ms: nowMs, instant_ms: n.instantMs });
    return { ok: false, reason: 'future', instantMs: n.instantMs };
  }
  const y = new Date(n.instantMs).getUTCFullYear();
  const nowY = new Date(nowMs).getUTCFullYear();
  if (y < MIN_YEAR || y > nowY + MAX_YEAR_DRIFT) {
    console.warn('[STRICT INVALID YEAR]', { input, year: y, now_year: nowY });
    return { ok: false, reason: 'invalid_year', instantMs: n.instantMs };
  }
  if (!OPERATIONAL_TIMEZONE || OPERATIONAL_TIMEZONE !== 'America/Sao_Paulo') {
    console.warn('[STRICT TIMEZONE DRIFT]', { configured_timezone: OPERATIONAL_TIMEZONE });
    return { ok: false, reason: 'timezone_drift', instantMs: n.instantMs };
  }
  return { ok: true, reason: null, instantMs: n.instantMs };
}

