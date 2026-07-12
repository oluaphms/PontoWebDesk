import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  queryCache,
  invalidateCompanyListCaches,
  invalidateAfterPunch,
  invalidateAfterTimesheetMonthClose,
  invalidatePendingRequestsCachesForUsers,
  invalidateOperationalGeoCaches,
  invalidateRealtimeGeoEntity,
  invalidateStaticCatalogCaches,
  flushPendingGeoCacheInvalidations,
  __resetCacheInvalidationCoalescersForTests,
} from './queryCache';

describe('queryCache.invalidate', () => {
  beforeEach(() => {
    queryCache.clear();
  });

  it('remove chaves cujo prefixo coincide (dashboard admin / batidas)', async () => {
    await queryCache.getOrFetch(
      'time_records:week:company-1:2026-04-14',
      async () => [{ id: '1' }],
      60_000,
    );
    await queryCache.getOrFetch(
      'time_records:week:company-2:2026-04-14',
      async () => [{ id: '2' }],
      60_000,
    );
    expect(queryCache.get('time_records:week:company-1:2026-04-14')).not.toBeNull();

    queryCache.invalidate('time_records:week:company-1');
    expect(queryCache.get('time_records:week:company-1:2026-04-14')).toBeNull();
    expect(queryCache.get('time_records:week:company-2:2026-04-14')).not.toBeNull();
  });

  it('invalidateCompanyListCaches limpa users, time_records:week e admin_report da empresa', async () => {
    await queryCache.getOrFetch('users:cid-1', async () => [], 60_000);
    await queryCache.getOrFetch('time_records:week:cid-1:day', async () => [], 60_000);
    await queryCache.getOrFetch('admin_report:cid-1:work_hours:2026-04', async () => [], 60_000);
    invalidateCompanyListCaches('cid-1');
    expect(queryCache.get('users:cid-1')).toBeNull();
    expect(queryCache.get('time_records:week:cid-1:day')).toBeNull();
    expect(queryCache.get('admin_report:cid-1:work_hours:2026-04')).toBeNull();
  });

  it('invalidateAfterPunch limpa registros/saldo sem apagar catálogos estáticos', async () => {
    await queryCache.getOrFetch('departments:list:c1', async () => [], 60_000);
    await queryCache.getOrFetch('time_records:user:u1:recent', async () => [], 60_000);
    await queryCache.getOrFetch('time_balance:u1:2026-04', async () => [], 60_000);
    await queryCache.getOrFetch('time_records:admin_dash:recent:c1', async () => [], 60_000);
    invalidateAfterPunch('u1', 'c1');
    expect(queryCache.get('departments:list:c1')).not.toBeNull();
    expect(queryCache.get('time_records:user:u1:recent')).toBeNull();
    expect(queryCache.get('time_balance:u1:2026-04')).toBeNull();
    expect(queryCache.get('time_records:admin_dash:recent:c1')).toBeNull();
  });

  it('invalidateStaticCatalogCaches limpa só catálogos', async () => {
    await queryCache.getOrFetch('departments:list:c1', async () => [], 60_000);
    await queryCache.getOrFetch('time_records:admin_dash:recent:c1', async () => [], 60_000);
    invalidateStaticCatalogCaches('c1');
    expect(queryCache.get('departments:list:c1')).toBeNull();
    expect(queryCache.get('time_records:admin_dash:recent:c1')).not.toBeNull();
  });

  it('respeita teto de entradas no queryCache (eviction)', async () => {
    for (let i = 0; i < 420; i += 1) {
      await queryCache.getOrFetch(`scale-test:${i}`, async () => ({ i }), 60_000);
    }
    expect(queryCache.get('scale-test:0')).toBeNull();
    expect(queryCache.get('scale-test:419')).not.toBeNull();
  });

  it('invalidateAfterTimesheetMonthClose limpa banco de horas admin e time_balance global', async () => {
    await queryCache.getOrFetch('admin_bank_hours:co1:all:2026-04', async () => ({ bankRows: [], balanceRows: [] }), 60_000);
    await queryCache.getOrFetch('time_balance:u2:2026-03', async () => [], 60_000);
    invalidateAfterTimesheetMonthClose('co1');
    expect(queryCache.get('admin_bank_hours:co1:all:2026-04')).toBeNull();
    expect(queryCache.get('time_balance:u2:2026-03')).toBeNull();
  });

  it('invalidatePendingRequestsCachesForUsers remove requests:pending por usuário', async () => {
    await queryCache.getOrFetch('requests:pending:u1', async () => [], 60_000);
    await queryCache.getOrFetch('requests:pending:u2', async () => [], 60_000);
    invalidatePendingRequestsCachesForUsers(['u1', 'u2', 'u1']);
    expect(queryCache.get('requests:pending:u1')).toBeNull();
    expect(queryCache.get('requests:pending:u2')).toBeNull();
  });
});

describe('coalesce de invalidação geo', () => {
  beforeEach(() => {
    __resetCacheInvalidationCoalescersForTests();
    queryCache.clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    __resetCacheInvalidationCoalescersForTests();
  });

  it('comprime múltiplas chamadas a invalidateOperationalGeoCaches em 1 flush por janela', async () => {
    await queryCache.getOrFetch('current_operational_state:co-1:keep', async () => ({}), 60_000);
    await queryCache.getOrFetch('time_records:admin_dash:co-1:keep', async () => ({}), 60_000);

    invalidateOperationalGeoCaches('reason_a');
    invalidateOperationalGeoCaches('reason_b');
    invalidateOperationalGeoCaches('reason_c');

    expect(queryCache.get('current_operational_state:co-1:keep')).not.toBeNull();
    expect(queryCache.get('time_records:admin_dash:co-1:keep')).not.toBeNull();

    vi.advanceTimersByTime(250);
    expect(queryCache.get('current_operational_state:co-1:keep')).toBeNull();
    expect(queryCache.get('time_records:admin_dash:co-1:keep')).toBeNull();
  });

  it('flushPendingGeoCacheInvalidations executa imediatamente o pending', async () => {
    await queryCache.getOrFetch('current_operational_state:co-2:foo', async () => ({}), 60_000);
    invalidateOperationalGeoCaches('immediate_test');
    expect(queryCache.get('current_operational_state:co-2:foo')).not.toBeNull();
    flushPendingGeoCacheInvalidations();
    expect(queryCache.get('current_operational_state:co-2:foo')).toBeNull();
  });

  it('coalesce por entidade respeita (employeeId, companyId) distintos', async () => {
    await queryCache.getOrFetch('current_operational_state:co-A:cache1', async () => ({}), 60_000);
    await queryCache.getOrFetch('current_operational_state:co-B:cache2', async () => ({}), 60_000);

    invalidateRealtimeGeoEntity('emp-1', 'co-A');
    invalidateRealtimeGeoEntity('emp-1', 'co-A');
    invalidateRealtimeGeoEntity('emp-2', 'co-B');
    invalidateRealtimeGeoEntity('emp-1', 'co-A');

    expect(queryCache.get('current_operational_state:co-A:cache1')).not.toBeNull();
    expect(queryCache.get('current_operational_state:co-B:cache2')).not.toBeNull();

    vi.advanceTimersByTime(300);
    expect(queryCache.get('current_operational_state:co-A:cache1')).toBeNull();
    expect(queryCache.get('current_operational_state:co-B:cache2')).toBeNull();
  });
});
