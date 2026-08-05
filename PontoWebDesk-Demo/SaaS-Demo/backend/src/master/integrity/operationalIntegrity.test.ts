// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../db/index.js', () => ({
  pool: {
    queryMaster: vi.fn(),
    queryTrustedBootstrap: vi.fn(),
  },
}));

import { pool } from '../../db/index.js';
import {
  formatOperationalIntegrityReport,
  runOperationalIntegrityAudit,
} from './operationalIntegrity.js';

describe('operationalIntegrity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reporta tenant sem company, user órfão, license e subscription sem tenant', async () => {
    vi.mocked(pool.queryMaster).mockImplementation(async (sql: string) => {
      const s = String(sql);
      if (s.includes('from public.master_tenants t') && s.includes('not exists')) {
        return {
          rows: [
            {
              tenant_id: 'tn_orphan',
              company_id: 'co_missing',
              company_name: 'Órfã',
              tenant_status: 'active',
              plan: 'MONTHLY',
              admin_email: 'a@t.com',
            },
          ],
          rowCount: 1,
        } as never;
      }
      if (s.includes('operational_company_id is null')) {
        return { rows: [], rowCount: 0 } as never;
      }
      if (s.includes('from public.master_licenses')) {
        return {
          rows: [{ license_id: 'lic_x', tenant_id: 'tn_gone', status: 'active' }],
          rowCount: 1,
        } as never;
      }
      if (s.includes('from public.master_subscriptions')) {
        if (s.includes('count(*)')) return { rows: [{ n: 1 }], rowCount: 1 } as never;
        return {
          rows: [{ subscription_id: 'sub_x', tenant_id: 'tn_gone', status: 'active' }],
          rowCount: 1,
        } as never;
      }
      if (s.includes('count(*)')) return { rows: [{ n: 0 }], rowCount: 1 } as never;
      return { rows: [], rowCount: 0 } as never;
    });

    vi.mocked(pool.queryTrustedBootstrap).mockImplementation(async (sql: string) => {
      const s = String(sql);
      if (s.includes('from public.companies c') && s.includes('not exists')) {
        return {
          rows: [{ company_id: 'co_alone', name: 'Sem tenant' }],
          rowCount: 1,
        } as never;
      }
      if (s.includes('from public.users u')) {
        return {
          rows: [
            {
              user_id: 'u1',
              email: 'x.golive@pontowebdesk.local',
              company_id: 'co_missing',
              role: 'admin',
              status: 'active',
            },
          ],
          rowCount: 1,
        } as never;
      }
      if (s.includes('count(*)')) return { rows: [{ n: 1 }], rowCount: 1 } as never;
      return { rows: [], rowCount: 0 } as never;
    });

    const report = await runOperationalIntegrityAudit();
    expect(report.ok).toBe(false);
    expect(report.counts.tenant_missing_company).toBe(1);
    expect(report.counts.company_missing_tenant).toBe(1);
    expect(report.counts.user_missing_company).toBe(1);
    expect(report.counts.license_missing_tenant).toBe(1);
    expect(report.counts.subscription_missing_tenant).toBe(1);
    expect(formatOperationalIntegrityReport(report)).toContain('tenant_missing_company');
  });

  it('ok=true quando não há inconsistências críticas', async () => {
    vi.mocked(pool.queryMaster).mockResolvedValue({ rows: [], rowCount: 0 } as never);
    vi.mocked(pool.queryTrustedBootstrap).mockImplementation(async (sql: string) => {
      if (String(sql).includes('count(*)')) return { rows: [{ n: 2 }], rowCount: 1 } as never;
      return { rows: [], rowCount: 0 } as never;
    });
    vi.mocked(pool.queryMaster).mockImplementation(async (sql: string) => {
      if (String(sql).includes('count(*)')) return { rows: [{ n: 2 }], rowCount: 1 } as never;
      return { rows: [], rowCount: 0 } as never;
    });

    const report = await runOperationalIntegrityAudit();
    expect(report.ok).toBe(true);
    expect(report.findings).toEqual([]);
  });
});
