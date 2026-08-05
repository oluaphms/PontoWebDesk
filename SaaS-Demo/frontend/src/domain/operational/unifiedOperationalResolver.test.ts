import { describe, expect, it } from 'vitest';
import { resolveUnifiedOperationalState } from './unifiedOperationalResolver';
import type { OperationalPunchRecord } from '../../services/monitoring/monitoringGeoHardLock.service';

describe('resolveUnifiedOperationalState', () => {
  it('modo legado: produz pipeline e presença sem COS', () => {
    const nowMs = Date.now();
    const users = [{ id: 'u1', nome: 'A' }];
    const records: OperationalPunchRecord[] = [];
    const r = resolveUnifiedOperationalState({
      companyId: 'c1',
      users,
      cosRows: [],
      timeRecords: records,
      liveByEmployee: new Map(),
      todayYmd: '2099-01-01',
      nowMs,
    });
    expect(r.usingOperationalStateTable).toBe(false);
    expect(r.pipelineRows.length).toBe(1);
    expect(r.presenceList.length).toBe(1);
  });

  it('presença usa batidas do dia (entrada → working) mesmo com COS desatualizado', () => {
    const punchIso = '2026-06-17T10:57:00.000Z';
    const nowMs = new Date('2026-06-17T15:00:00.000Z').getTime();
    const users = [{ id: 'u1', nome: 'PAULO HENRIQUE' }];
    const records: OperationalPunchRecord[] = [
      {
        id: 'r1',
        user_id: 'emp-linked',
        type: 'entrada',
        timestamp: punchIso,
        created_at: punchIso,
        latitude: -10.9348,
        longitude: -37.0949,
      },
    ];
    const recordUserToRosterId = new Map([['emp-linked', 'u1']]);
    const r = resolveUnifiedOperationalState({
      companyId: 'c1',
      users,
      cosRows: [{ employee_id: 'u1', company_id: 'c1', operational_status: 'OFF_DUTY' } as never],
      timeRecords: records,
      liveByEmployee: new Map(),
      todayYmd: '2026-06-17',
      nowMs,
      recordUserToRosterId,
    });
    expect(r.presenceList[0]?.status).toBe('working');
    expect(r.pipelineRows[0]?.lat).toBeCloseTo(-10.9348, 4);
  });
});
