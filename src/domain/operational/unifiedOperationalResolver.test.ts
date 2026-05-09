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
});
