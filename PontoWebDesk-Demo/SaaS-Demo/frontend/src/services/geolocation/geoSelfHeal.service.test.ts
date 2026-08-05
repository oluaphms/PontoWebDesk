import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../queryCache', () => ({
  invalidateOperationalGeoCaches: vi.fn(),
  invalidateRealtimeGeoEntity: vi.fn(),
}));

vi.mock('../currentOperationalState.service', () => ({
  refreshCurrentOperationalStateRpc: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../domain/operational/reconciliation/currentOperationalStateReconciler', () => ({
  reconcileCurrentOperationalState: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../supabaseClient', () => ({
  getSupabaseClient: () => null,
}));

vi.mock('../monitoring/realtimeGeoStreamCoordinator', () => ({
  getRealtimeGeoStreamCoordinator: vi.fn(() => ({
    requestFlush: vi.fn(),
  })),
}));

import { runGeoSelfHeal, __resetSelfHealLockForTests } from './geoSelfHeal.service';
import { invalidateRealtimeGeoEntity, invalidateOperationalGeoCaches } from '../queryCache';

describe('runGeoSelfHeal — anti-cascata', () => {
  beforeEach(() => {
    __resetSelfHealLockForTests();
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('executa quando não há heal ativo para a entidade', async () => {
    await runGeoSelfHeal({ companyId: 'co-1', employeeId: 'emp-1', reason: 'test' });
    expect(invalidateRealtimeGeoEntity).toHaveBeenCalledTimes(1);
    expect(invalidateOperationalGeoCaches).toHaveBeenCalledTimes(1);
  });

  it('bloqueia execuções concorrentes/seguidas para a mesma chave', async () => {
    const p1 = runGeoSelfHeal({ companyId: 'co-1', employeeId: 'emp-1', reason: 'test_a' });
    const p2 = runGeoSelfHeal({ companyId: 'co-1', employeeId: 'emp-1', reason: 'test_b' });
    const p3 = runGeoSelfHeal({ companyId: 'co-1', employeeId: 'emp-1', reason: 'test_c' });
    await Promise.all([p1, p2, p3]);
    expect(invalidateRealtimeGeoEntity).toHaveBeenCalledTimes(1);
  });

  it('libera a chave após 30s e permite novo heal', async () => {
    await runGeoSelfHeal({ companyId: 'co-1', employeeId: 'emp-1', reason: 'first' });
    expect(invalidateRealtimeGeoEntity).toHaveBeenCalledTimes(1);

    await runGeoSelfHeal({ companyId: 'co-1', employeeId: 'emp-1', reason: 'still_locked' });
    expect(invalidateRealtimeGeoEntity).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(30_001);
    await runGeoSelfHeal({ companyId: 'co-1', employeeId: 'emp-1', reason: 'after_ttl' });
    expect(invalidateRealtimeGeoEntity).toHaveBeenCalledTimes(2);
  });

  it('mantém locks isolados por (companyId, employeeId)', async () => {
    await runGeoSelfHeal({ companyId: 'co-1', employeeId: 'emp-1', reason: 'a' });
    await runGeoSelfHeal({ companyId: 'co-1', employeeId: 'emp-2', reason: 'b' });
    await runGeoSelfHeal({ companyId: 'co-2', employeeId: 'emp-1', reason: 'c' });
    expect(invalidateRealtimeGeoEntity).toHaveBeenCalledTimes(3);
  });
});
