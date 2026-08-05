import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FUTURE_PUNCH_TOLERANCE_MS,
  __resetFutureBlockDedupForTests,
  companyOperationalDayBoundsUtc,
  evaluateOperationalDayGeoForMonitoring,
  enrichPipelineRowForOperationalDay,
  filterRecordsForOperationalDay,
  getCompanyTodayYmd,
  getLastOperationalPunchForUser,
  punchInstantOperationalYmd,
  validateOperationalTimestamp,
} from './monitoringGeoHardLock.service';
import type { OperationalPunchRecord } from './monitoringGeoHardLock.service';
import { observabilityConsole } from '../../shared/logger/observabilityConsole';

describe('validateOperationalTimestamp', () => {
  it('rejeita instante além da tolerância futura', () => {
    const now = new Date('2026-05-09T12:00:00.000Z').getTime();
    const future = new Date(now + FUTURE_PUNCH_TOLERANCE_MS + 60_000).toISOString();
    const r = validateOperationalTimestamp(future, now);
    expect(r.ok).toBe(false);
    if (r.ok === false) expect(r.code).toBe('future');
  });

  it('aceita instante dentro da tolerância futura', () => {
    const now = new Date('2026-05-09T12:00:00.000Z').getTime();
    const near = new Date(now + 60_000).toISOString();
    const r = validateOperationalTimestamp(near, now);
    expect(r.ok).toBe(true);
  });
});

describe('getLastOperationalPunchForUser', () => {
  it('ignora batida futura e pega a anterior', () => {
    const now = new Date('2026-05-09T15:00:00.000Z').getTime();
    const rows: OperationalPunchRecord[] = [
      {
        id: '1',
        user_id: 'u1',
        type: 'entrada',
        created_at: new Date(now + 86400000).toISOString(),
        timestamp: new Date(now + 86400000).toISOString(),
      },
      {
        id: '2',
        user_id: 'u1',
        type: 'pausa',
        created_at: new Date(now - 3600000).toISOString(),
        timestamp: null,
      },
    ];
    const last = getLastOperationalPunchForUser(rows, 'u1', now);
    expect(last?.id).toBe('2');
  });
});

describe('punchInstantOperationalYmd + filtro do dia', () => {
  it('usa America/Sao_Paulo para data civil', () => {
    const ymd = punchInstantOperationalYmd({
      timestamp: '2026-05-09T02:00:00.000Z',
      created_at: '2026-05-09T02:00:00.000Z',
    });
    expect(ymd).toBe('2026-05-08');
  });

  it('filterRecordsForOperationalDay mantém só o dia solicitado', () => {
    const recs: OperationalPunchRecord[] = [
      {
        id: 'a',
        user_id: 'u',
        type: 'entrada',
        created_at: '2026-05-09T12:00:00.000Z',
        timestamp: '2026-05-09T12:00:00.000Z',
      },
      {
        id: 'b',
        user_id: 'u',
        type: 'saida',
        created_at: '2026-05-08T12:00:00.000Z',
        timestamp: '2026-05-08T12:00:00.000Z',
      },
    ];
    const d = filterRecordsForOperationalDay(recs, '2026-05-09');
    expect(d.map((r) => r.id)).toEqual(['a']);
  });
});

describe('companyOperationalDayBoundsUtc', () => {
  it('retorna início e fim do dia em UTC para SP', () => {
    const { startUtc, endUtc } = companyOperationalDayBoundsUtc('2026-05-09');
    expect(startUtc).toMatch(/^2026-05-09T03:00:00/);
    expect(endUtc).toMatch(/^2026-05-10T02:59:59/);
  });
});

describe('getCompanyTodayYmd', () => {
  it('retorna ISO date', () => {
    const y = getCompanyTodayYmd();
    expect(y).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('evaluateOperationalDayGeoForMonitoring', () => {
  it('aceita coordenadas negativas (Brasil) mesmo com idade acima do limite realtime', () => {
    const nowMs = new Date('2026-06-17T15:00:00.000Z').getTime();
    const punchMs = new Date('2026-06-17T10:57:00.000Z').getTime();
    const records: OperationalPunchRecord[] = [
      {
        id: 'paulo-1',
        user_id: 'u-paulo',
        type: 'entrada',
        timestamp: new Date(punchMs).toISOString(),
        created_at: new Date(punchMs).toISOString(),
        latitude: -10.9348,
        longitude: -37.0949,
      },
    ];
    const decision = evaluateOperationalDayGeoForMonitoring(records, 'u-paulo', nowMs);
    expect(decision.useForMap).toBe(true);
    if (decision.useForMap) {
      expect(decision.lat).toBeCloseTo(-10.9348, 4);
      expect(decision.lng).toBeCloseTo(-37.0949, 4);
    }
  });
});

describe('enrichPipelineRowForOperationalDay', () => {
  it('preenche GEO ausente a partir da batida do dia', () => {
    const nowMs = Date.now();
    const punchIso = '2026-06-17T10:57:00.000Z';
    const todayRecords: OperationalPunchRecord[] = [
      {
        id: 'r1',
        user_id: 'emp-1',
        type: 'entrada',
        timestamp: punchIso,
        created_at: punchIso,
        latitude: -10.9348,
        longitude: -37.0949,
      },
    ];
    const row = enrichPipelineRowForOperationalDay(
      {
        userId: 'emp-1',
        userName: 'PAULO',
        status: 'OFF_DUTY' as never,
        statusLabel: 'Fora da jornada',
        mapRenderTimestamp: nowMs,
        geoLocationExpired: true,
      },
      todayRecords,
      ['emp-1'],
      nowMs,
    );
    expect(row.lat).toBeCloseTo(-10.9348, 4);
    expect(row.lng).toBeCloseTo(-37.0949, 4);
    expect(row.geoLocationExpired).toBe(false);
    expect(row.statusLabel).toBe('Trabalhando');
  });
});

describe('dedup de [FUTURE DATE BLOCKED]', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    __resetFutureBlockDedupForTests();
    warnSpy = vi.spyOn(observabilityConsole, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    __resetFutureBlockDedupForTests();
  });

  it('emite log apenas uma vez para o mesmo iso futuro dentro da janela', () => {
    const now = new Date('2026-05-09T12:00:00.000Z').getTime();
    const future = new Date(now + FUTURE_PUNCH_TOLERANCE_MS + 60_000).toISOString();
    for (let i = 0; i < 20; i += 1) {
      const r = validateOperationalTimestamp(future, now);
      expect(r.ok).toBe(false);
    }
    const futureBlockCalls = warnSpy.mock.calls.filter((c) => c[0] === '[FUTURE DATE BLOCKED]');
    expect(futureBlockCalls.length).toBe(1);
  });

  it('emite log para isos distintos mesmo na mesma janela', () => {
    const now = new Date('2026-05-09T12:00:00.000Z').getTime();
    const futureA = new Date(now + FUTURE_PUNCH_TOLERANCE_MS + 60_000).toISOString();
    const futureB = new Date(now + FUTURE_PUNCH_TOLERANCE_MS + 120_000).toISOString();
    validateOperationalTimestamp(futureA, now);
    validateOperationalTimestamp(futureB, now);
    validateOperationalTimestamp(futureA, now);
    validateOperationalTimestamp(futureB, now);
    const futureBlockCalls = warnSpy.mock.calls.filter((c) => c[0] === '[FUTURE DATE BLOCKED]');
    expect(futureBlockCalls.length).toBe(2);
  });
});
