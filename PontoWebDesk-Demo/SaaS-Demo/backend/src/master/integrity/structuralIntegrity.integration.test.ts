// @vitest-environment node
/**
 * Testes de integridade estrutural: deleteTenant/rollback/repair/API delete companies.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { QueryResult } from 'pg';

vi.mock('../../db/index.js', () => ({
  pool: {
    queryMaster: vi.fn(async () => ({ rows: [], rowCount: 0 })),
    query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
  },
  checkDatabaseConnection: vi.fn(async () => true),
  runMasterDomainTransaction: vi.fn(async (fn: (c: unknown) => Promise<unknown>) => fn({})),
  isMasterDomainTransactionActive: vi.fn(() => false),
  recordMasterDomainStep: vi.fn(),
  getMasterDomainTxClient: vi.fn(() => null),
}));

vi.mock('../../services/master/masterPlatformService.js', () => ({
  MasterPlatformService: {
    getTenantsService: vi.fn(),
    getAudit: vi.fn(),
    getLifecycle: vi.fn(),
    getLicenseManager: vi.fn(),
    getPersistence: vi.fn(() => 'memory'),
  },
}));

vi.mock('../journey/CommercialJourneyService.js', () => ({
  CommercialJourneyService: { provision: vi.fn(), resendFirstAccess: vi.fn() },
}));

vi.mock('../crm/CommercialCrmService.js', () => ({
  CommercialCrmService: { getSnapshot: vi.fn() },
}));

vi.mock('../subscriptionFinance/SubscriptionFinanceService.js', () => ({
  SubscriptionFinanceService: class {},
}));

function asQueryResult<T extends Record<string, unknown>>(rows: T[]): QueryResult<T> {
  return {
    rows,
    rowCount: rows.length,
    command: 'SELECT',
    oid: 0,
    fields: [],
  };
}

vi.mock('../subscriptionNotifications/SubscriptionNotificationService.js', () => ({
  SubscriptionNotificationService: class {},
}));

vi.mock('../operationalDiscovery/OperationalCompanyDiscoveryService.js', () => ({
  OperationalCompanyDiscoveryService: {
    findOperationalCompanyByDocument: vi.fn(async () => null),
  },
}));

vi.mock('../commercial/CommercialProjectionService.js', () => ({
  projectCommercialStateToSaas: vi.fn(async () => ({})),
}));

import { MasterPlatformService } from '../../services/master/masterPlatformService.js';
import { pool } from '../../db/index.js';
import { MasterCompanyProvisioningService } from '../provisioning/MasterCompanyProvisioningService.js';
import type { AuthedRequest } from '../../middlewares/authMiddleware.js';
import { deleteDataController } from '../../controllers/dataController.js';
import type { Response } from 'express';

function mockRes() {
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
  return res as unknown as Response & { status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> };
}

describe('integridade estrutural Master ↔ Operacional', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(MasterPlatformService.getAudit).mockReturnValue({ append: vi.fn() } as never);
    vi.mocked(MasterPlatformService.getLifecycle).mockReturnValue({
      findCurrentByTenant: vi.fn(async () => null),
      remove: vi.fn(async () => true),
    } as never);
    vi.mocked(MasterPlatformService.getLicenseManager).mockReturnValue({
      getByTenantId: vi.fn(async () => null),
      action: vi.fn(async () => ({ id: 'lic' })),
    } as never);
  });

  it('deleteDataController bloqueia DELETE em companies (evita órfãos Master)', async () => {
    const req = {
      params: { table: 'companies', id: 'a145b0cd-76f4-4dc8-b50c-02b0c9bfe24b' },
      auth: { role: 'admin', companyId: 'a145b0cd-76f4-4dc8-b50c-02b0c9bfe24b', userId: 'u1' },
    } as unknown as AuthedRequest;
    const res = mockRes();

    await deleteDataController(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'COMPANY_GENERIC_DELETE_FORBIDDEN' }),
    );
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('updateDataController bloqueia UPDATE em companies (writer canônico only)', async () => {
    const { updateDataController } = await import('../../controllers/dataController.js');
    const req = {
      params: { table: 'companies', id: 'a145b0cd-76f4-4dc8-b50c-02b0c9bfe24b' },
      auth: { role: 'admin', companyId: 'a145b0cd-76f4-4dc8-b50c-02b0c9bfe24b', userId: 'u1' },
      body: { name: 'Hack' },
    } as unknown as AuthedRequest;
    const res = mockRes();

    await updateDataController(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'COMPANY_GENERIC_UPDATE_FORBIDDEN' }),
    );
  });

  it('purgeFullyProvisioned remove users da company antes de apagar companies', async () => {
    const tenant = {
      id: 'tn_purge_1',
      operationalCompanyId: 'co_purge_1',
      plan: 'MONTHLY',
      status: 'active',
      mode: 'SAAS',
      gateway: 'none',
      installationType: 'SAAS_WEB',
      license: {},
      company: { name: 'Purge Co', document: null, tradeName: null },
      admin: { name: 'Admin', email: 'admin@purge.test', userId: 'usr_admin' },
      domain: 'purge.test',
      storage: { driver: 'local' },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    vi.mocked(MasterPlatformService.getTenantsService).mockReturnValue({
      get: vi.fn(async () => tenant),
      delete: vi.fn(async () => true),
      list: vi.fn(async () => []),
      create: vi.fn(),
      update: vi.fn(),
    } as never);

    const executed: string[] = [];
    vi.mocked(pool.queryMaster).mockImplementation(async (sql: string) => {
      const s = String(sql);
      executed.push(s);
      if (/select subscription_id, license_id, admin_user_id/i.test(s)) {
        return {
          rows: [{ subscription_id: null, license_id: null, admin_user_id: 'usr_admin' }],
          rowCount: 1,
        } as never;
      }
      if (/union all/i.test(s) && /count\(\)/i.test(s)) {
        return { rows: [], rowCount: 0 } as never;
      }
      return { rows: [], rowCount: 0 } as never;
    });

    await MasterCompanyProvisioningService.purgeFullyProvisioned('tn_purge_1', {
      userId: 'master_1',
      email: 'master@test',
    });

    const usersDelete = executed.find(
      (s) => /delete from public\.users/i.test(s) && /company_id::text = \$1/i.test(s) && !/email/i.test(s),
    );
    const companyDelete = executed.find((s) => /delete from public\.companies/i.test(s));
    expect(usersDelete).toBeTruthy();
    expect(companyDelete).toBeTruthy();
    expect(executed.indexOf(usersDelete!)).toBeLessThan(executed.indexOf(companyDelete!));
  });

  it('repairMissingOperationalCompany recria company com mesmo id e não deixa órfão', async () => {
    const tenant = {
      id: 'tn_repair_1',
      operationalCompanyId: 'co_repair_1',
      plan: 'MONTHLY',
      status: 'active',
      mode: 'SAAS',
      gateway: 'none',
      installationType: 'SAAS_WEB',
      license: {},
      company: { name: 'Repair Co', document: '11.111.111/0001-11', tradeName: null },
      admin: { name: 'Admin', email: 'admin@repair.test' },
      domain: 'repair.test',
      storage: { driver: 'local' },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    vi.mocked(MasterPlatformService.getTenantsService).mockReturnValue({
      get: vi.fn(async () => tenant),
      delete: vi.fn(),
      list: vi.fn(async () => []),
      create: vi.fn(),
      update: vi.fn(),
    } as never);
    vi.mocked(MasterPlatformService.getLicenseManager).mockReturnValue({
      getByTenantId: vi.fn(async () => ({ id: 'lic_1', status: 'active' })),
      action: vi.fn(),
    } as never);
    vi.mocked(MasterPlatformService.getLifecycle).mockReturnValue({
      findCurrentByTenant: vi.fn(async () => ({ id: 'sub_1', status: 'active' })),
      remove: vi.fn(),
    } as never);

    let companyExists = false;
    vi.mocked(pool.queryMaster).mockImplementation(async (sql: string, params?: unknown[]) => {
      const s = String(sql);
      if (/select id::text as id from public\.companies/i.test(s)) {
        return companyExists
          ? asQueryResult([{ id: 'co_repair_1' }])
          : asQueryResult([]);
      }
      if (/insert into public\.companies/i.test(s)) {
        expect(params?.[0]).toBe('co_repair_1');
        companyExists = true;
        return asQueryResult([{ id: 'co_repair_1' }]);
      }
      return asQueryResult([]);
    });

    const result = await MasterCompanyProvisioningService.repairMissingOperationalCompany('tn_repair_1');
    expect(result.repaired).toBe(true);
    expect(result.operationalCompanyId).toBe('co_repair_1');
    expect(companyExists).toBe(true);

    const skip = await MasterCompanyProvisioningService.repairMissingOperationalCompany('tn_repair_1');
    expect(skip.repaired).toBe(false);
    expect(skip.alreadyPresent).toBe(true);
  });
});
