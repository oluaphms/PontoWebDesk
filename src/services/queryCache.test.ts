import { describe, it, expect, beforeEach } from 'vitest';
import {
  queryCache,
  invalidateCompanyListCaches,
  invalidateAfterPunch,
  invalidateAfterTimesheetMonthClose,
  invalidatePendingRequestsCachesForUsers,
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

  it('invalidateAfterPunch cobre empresa e usuário', async () => {
    await queryCache.getOrFetch('users:c1', async () => [], 60_000);
    await queryCache.getOrFetch('time_records:user:u1:recent', async () => [], 60_000);
    await queryCache.getOrFetch('time_balance:u1:2026-04', async () => [], 60_000);
    invalidateAfterPunch('u1', 'c1');
    expect(queryCache.get('users:c1')).toBeNull();
    expect(queryCache.get('time_records:user:u1:recent')).toBeNull();
    expect(queryCache.get('time_balance:u1:2026-04')).toBeNull();
  });

  it('invalidateAfterTimesheetMonthClose limpa banco de horas admin e time_balance global', async () => {
    await queryCache.getOrFetch('admin_bank_hours:co1:all:2026-04:e5', async () => ({ bankRows: [], balanceRows: [] }), 60_000);
    await queryCache.getOrFetch('time_balance:u2:2026-03', async () => [], 60_000);
    invalidateAfterTimesheetMonthClose('co1');
    expect(queryCache.get('admin_bank_hours:co1:all:2026-04:e5')).toBeNull();
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
