import { describe, expect, it } from 'vitest';
import {
  buildOperationalDayRange,
  getOperationalTodayYmd,
  isFutureOperationalTimestamp,
  normalizeOperationalDate,
  OPERATIONAL_TIMEZONE,
} from './operationalDateHardLock';

describe('operationalDateHardLock', () => {
  it('normalizeOperationalDate retorna UTC ISO', () => {
    const n = normalizeOperationalDate('2026-05-09T12:00:00-03:00');
    expect(n).not.toBeNull();
    expect(n!.utcIso).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('isFutureOperationalTimestamp respeita tolerância', () => {
    const now = 1_700_000_000_000;
    const near = new Date(now + 60_000).toISOString();
    expect(isFutureOperationalTimestamp(near, now)).toBe(false);
    const far = new Date(now + 10 * 60_000).toISOString();
    expect(isFutureOperationalTimestamp(far, now)).toBe(true);
  });

  it('buildOperationalDayRange usa America/Sao_Paulo', () => {
    const r = buildOperationalDayRange('2026-05-09', OPERATIONAL_TIMEZONE);
    expect(r.startUtcIso.length).toBeGreaterThan(10);
    expect(r.endUtcIso.length).toBeGreaterThan(10);
    expect(r.timezone).toBe('America/Sao_Paulo');
  });

  it('getOperationalTodayYmd formato YYYY-MM-DD', () => {
    expect(getOperationalTodayYmd()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
