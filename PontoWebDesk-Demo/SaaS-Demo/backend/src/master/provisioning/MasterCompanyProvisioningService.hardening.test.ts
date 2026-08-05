// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  queryMaster,
  checkDatabaseConnection,
  getTenantsService,
  getAudit,
  getLifecycle,
  getLicenseManager,
  journeyProvision,
  journeyResendFirstAccess,
  findOperationalCompanyByDocument,
} = vi.hoisted(() => ({
  queryMaster: vi.fn(async (..._args: unknown[]) => ({ rows: [] as unknown[], rowCount: 0 })),
  checkDatabaseConnection: vi.fn(async () => true),
  getTenantsService: vi.fn(),
  getAudit: vi.fn(),
  getLifecycle: vi.fn(),
  getLicenseManager: vi.fn(),
  journeyProvision: vi.fn(),
  journeyResendFirstAccess: vi.fn(),
  findOperationalCompanyByDocument: vi.fn(
    async (): Promise<{
      id: string;
      cnpj: string | null;
      nome: string | null;
      name: string | null;
    } | null> => null,
  ),
}));

vi.mock('../../db/index.js', () => ({
  pool: { queryMaster },
  checkDatabaseConnection,
  runMasterDomainTransaction: vi.fn(async (fn: (c: unknown) => Promise<unknown>) => fn({})),
  isMasterDomainTransactionActive: vi.fn(() => false),
  recordMasterDomainStep: vi.fn(),
  getMasterDomainTxClient: vi.fn(() => null),
}));

vi.mock('../../services/master/masterPlatformService.js', () => ({
  MasterPlatformService: {
    getTenantsService,
    getAudit,
    getLifecycle,
    getLicenseManager,
    getPersistence: vi.fn(() => 'memory'),
  },
}));

vi.mock('../journey/CommercialJourneyService.js', () => ({
  CommercialJourneyService: {
    provision: journeyProvision,
    resendFirstAccess: journeyResendFirstAccess,
  },
}));

vi.mock('../operationalDiscovery/OperationalCompanyDiscoveryService.js', () => ({
  OperationalCompanyDiscoveryService: {
    findOperationalCompanyByDocument,
  },
}));

vi.mock('../crm/CommercialCrmService.js', () => ({
  CommercialCrmService: { getSnapshot: vi.fn(async () => ({ profile: null })) },
}));

vi.mock('../subscriptionFinance/SubscriptionFinanceService.js', () => ({
  SubscriptionFinanceService: class {
    async listCompanyTimeline() {
      return [];
    }
    async createPayment() {
      return { id: 'fin_1' };
    }
  },
}));

vi.mock('../subscriptionNotifications/SubscriptionNotificationService.js', () => ({
  SubscriptionNotificationService: class {
    async updatePreferences() {
      return { ok: true };
    }
  },
}));

import { MasterCompanyProvisioningService } from './MasterCompanyProvisioningService.js';

function journeyOk(tenantId: string, operationalCompanyId: string) {
  return {
    tenantId,
    operationalCompanyId,
    state: 'completed',
    completedSteps: ['company', 'plan', 'license', 'activation', 'admin'],
    customerId: `cust_${tenantId}`,
    subscriptionId: `sub_${tenantId}`,
    licenseId: `lic_${tenantId}`,
    adminUserId: `usr_${tenantId}`,
    adminEmail: 'admin@load.test',
    inviteSentAt: null,
    firstLoginAt: null,
    lastError: null,
    nextAction: null,
    steps: [],
    wizard: {
      tenantId,
      mode: 'SAAS',
      plan: 'MONTHLY',
      progressPercent: 100,
      currentStepIndex: -1,
      currentStepId: null,
      implantationStatus: 'Implantação concluída',
      canResume: false,
      wizardSteps: [],
      installationId: null,
      agentTokenIssuedAt: null,
      agentSkipped: false,
      implantationCompletedAt: null,
      summary: {
        companyCreated: true,
        licenseActive: true,
        adminCreated: true,
        firstAccessSent: false,
        updaterRegistered: false,
        implantationCompleted: true,
      },
    },
  };
}

describe('MasterCompanyProvisioningService hardening', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    checkDatabaseConnection.mockResolvedValue(true);
    getAudit.mockReturnValue({ append: vi.fn() });
    getLifecycle.mockReturnValue({
      findCurrentByTenant: vi.fn(async () => null),
      remove: vi.fn(async () => true),
    });
    getLicenseManager.mockReturnValue({
      getByTenantId: vi.fn(async () => null),
      action: vi.fn(async () => ({ id: 'lic_rb' })),
    });
    journeyResendFirstAccess.mockResolvedValue(null);
    queryMaster.mockResolvedValue({ rows: [], rowCount: 0 });
    findOperationalCompanyByDocument.mockResolvedValue(null);
  });

  it('idempotência sob concorrência alta (10,50,100,500,1000)', async () => {
    const levels = [10, 50, 100, 500, 1000];
    for (const level of levels) {
      const store = new Map<string, Record<string, unknown>>();
      const create = vi.fn(async (input: any) => {
        await Promise.resolve();
        const tenant = {
          id: 'tn_load_1',
          operationalCompanyId: input.operationalCompanyId,
          plan: 'MONTHLY',
          status: 'trial',
          mode: 'SAAS',
          gateway: 'none',
          installationType: 'SAAS_WEB',
          license: {},
          company: { name: 'Load', document: '12345678000190', tradeName: null },
          admin: { name: 'Admin', email: 'admin@load.test' },
          domain: 'load.test',
          storage: { driver: 'local' },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        store.set(String(tenant.id), tenant);
        return tenant;
      });
      const tenantsService = {
        create,
        update: vi.fn(async (_id: string, patch: any) => {
          const current = store.get('tn_load_1')!;
          const merged = { ...current, ...patch };
          store.set('tn_load_1', merged);
          return merged;
        }),
        list: vi.fn(async () => [...store.values()] as never[]),
        get: vi.fn(async () => store.get('tn_load_1') as never),
        delete: vi.fn(async (id: string) => store.delete(id)),
      };
      getTenantsService.mockReturnValue(tenantsService as never);
      journeyProvision.mockResolvedValue(journeyOk('tn_load_1', 'co_load_1') as never);

      const payload = {
        company: { name: 'Load', document: '12.345.678/0001-90' },
        admin: { name: 'Admin', email: 'admin@load.test' },
        domain: 'load.test',
        plan: 'MONTHLY' as const,
        installationType: 'SAAS_WEB' as const,
        operationalCompanyId: 'co_load_1',
      };
      const results = await Promise.all(
        Array.from({ length: level }, () =>
          MasterCompanyProvisioningService.createFullyProvisioned(payload),
        ),
      );

      expect(create).toHaveBeenCalledTimes(1);
      expect(results.every((row) => row.tenant.id === 'tn_load_1')).toBe(true);
    }
  });

  it('empresa operacional existente -> vincula sem INSERT em public.companies', async () => {
    findOperationalCompanyByDocument.mockResolvedValue({
      id: 'co_existing_2',
      cnpj: '15048950000163',
      nome: 'FL LOCADORA LTDA',
      name: 'FL LOCADORA LTDA',
    });
    const store = new Map<string, Record<string, unknown>>();
    const create = vi.fn(async (input: any) => {
      const tenant = {
        id: 'tn_existing_2',
        operationalCompanyId: input.operationalCompanyId,
        plan: 'MONTHLY',
        status: 'trial',
        mode: 'SAAS',
        gateway: 'none',
        installationType: 'SAAS_WEB',
        license: {},
        company: { name: 'FL LOCADORA LTDA', document: '15.048.950/0001-63', tradeName: null },
        admin: { name: 'Admin', email: 'admin@fl.test' },
        domain: 'fl.test',
        storage: { driver: 'local' },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      store.set(String(tenant.id), tenant);
      return tenant;
    });
    const update = vi.fn(async (id: string, patch: any) => {
      const current = store.get(id)!;
      const merged = { ...current, ...patch };
      store.set(id, merged);
      return merged;
    });
    getTenantsService.mockReturnValue({
      create,
      update,
      list: vi.fn(async () => []),
      get: vi.fn(async (id: string) => store.get(id) as never),
      delete: vi.fn(async () => true),
    } as never);
    journeyProvision.mockResolvedValue(journeyOk('tn_existing_2', 'co_existing_2') as never);

    await MasterCompanyProvisioningService.createFullyProvisioned({
      company: { name: 'FL LOCADORA LTDA', document: '15.048.950/0001-63' },
      admin: { name: 'Admin', email: 'admin@fl.test' },
      domain: 'fl.test',
      plan: 'MONTHLY',
      installationType: 'SAAS_WEB',
    });

    const insertCompaniesCall = queryMaster.mock.calls.find((args) =>
      /insert into public\.companies/i.test(String(args[0] || '')),
    );
    expect(insertCompaniesCall).toBeFalsy();
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ operationalCompanyId: 'co_existing_2' }));
  });

  it('executa rollback em ordem inversa e remove companies por último', async () => {
    const tenantsService = {
      create: vi.fn(async (input: any) => ({
        id: 'tn_rb_1',
        operationalCompanyId: input.operationalCompanyId,
        plan: 'MONTHLY',
        status: 'trial',
        mode: 'SAAS',
        gateway: 'none',
        installationType: 'SAAS_WEB',
        license: {},
        company: { name: 'Rollback', document: '12345678000190', tradeName: null },
        admin: { name: 'Admin', email: 'admin@rollback.test' },
        domain: 'rollback.test',
        storage: { driver: 'local' },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })),
      update: vi.fn(async (_id: string, patch: any) => ({
        id: 'tn_rb_1',
        operationalCompanyId: patch.operationalCompanyId,
        plan: 'MONTHLY',
        status: 'trial',
        mode: 'SAAS',
        gateway: 'none',
        installationType: 'SAAS_WEB',
        license: {},
        company: { name: 'Rollback', document: '12345678000190', tradeName: null },
        admin: { name: 'Admin', email: 'admin@rollback.test' },
        domain: 'rollback.test',
        storage: { driver: 'local' },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })),
      list: vi.fn(async () => []),
      get: vi.fn(async () => null),
      delete: vi.fn(async () => true),
    };
    getTenantsService.mockReturnValue(tenantsService as never);

    const lifecycleRemove = vi.fn(async () => true);
    getLifecycle.mockReturnValue({
      findCurrentByTenant: vi.fn(async () => ({ id: 'sub_rb_1' })),
      remove: lifecycleRemove,
    } as never);
    const licenseDelete = vi.fn(async () => ({ id: 'lic_rb_1' }));
    getLicenseManager.mockReturnValue({
      getByTenantId: vi.fn(async () => ({ id: 'lic_rb_1' })),
      action: licenseDelete,
    } as never);

    queryMaster.mockImplementation(async (...args: unknown[]) => {
      const sql = String(args[0] || '');
      if (/select subscription_id, license_id, admin_user_id/i.test(sql)) {
        return {
          rows: [{ subscription_id: 'sub_rb_1', license_id: 'lic_rb_1', admin_user_id: 'usr_rb_1' }],
          rowCount: 1,
        } as never;
      }
      return { rows: [], rowCount: 0 } as never;
    });

    journeyProvision.mockRejectedValue(new Error('LICENSE_STAGE_FAILED'));

    await expect(
      MasterCompanyProvisioningService.createFullyProvisioned({
        company: { name: 'Rollback', document: '12.345.678/0001-90' },
        admin: { name: 'Admin', email: 'admin@rollback.test' },
        domain: 'rollback.test',
        plan: 'MONTHLY',
        installationType: 'SAAS_WEB',
        operationalCompanyId: 'co_rb_1',
      }),
    ).rejects.toBeTruthy();

    expect(licenseDelete).toHaveBeenCalledWith('lic_rb_1', 'delete');
    expect(lifecycleRemove).toHaveBeenCalledWith('sub_rb_1');
    expect(tenantsService.delete).toHaveBeenCalledWith('tn_rb_1');

    const companyDeleteCall = queryMaster.mock.calls.find((args) =>
      /delete from public\.companies/i.test(String(args[0])),
    );
    expect(companyDeleteCall).toBeTruthy();

    const companyDeleteOrder = queryMaster.mock.invocationCallOrder.find((_, index) =>
      /delete from public\.companies/i.test(String(queryMaster.mock.calls[index]?.[0] || '')),
    );
    expect(companyDeleteOrder).toBeTruthy();
    expect(licenseDelete.mock.invocationCallOrder[0]).toBeLessThan(companyDeleteOrder!);
    expect(lifecycleRemove.mock.invocationCallOrder[0]).toBeLessThan(companyDeleteOrder!);
    expect(tenantsService.delete.mock.invocationCallOrder[0]).toBeLessThan(companyDeleteOrder!);
  });

  it('executa envio de convite apenas após jornada obrigatória', async () => {
    const tenant = {
      id: 'tn_mail_1',
      operationalCompanyId: 'co_mail_1',
      plan: 'MONTHLY',
      status: 'trial',
      mode: 'SAAS',
      gateway: 'none',
      installationType: 'SAAS_WEB',
      license: {},
      company: { name: 'Mail', document: null, tradeName: null },
      admin: { name: 'Admin', email: 'admin@mail.test' },
      domain: 'mail.test',
      storage: { driver: 'local' },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    getTenantsService.mockReturnValue({
      create: vi.fn(async () => tenant),
      update: vi.fn(async () => tenant),
      list: vi.fn(async () => []),
      get: vi.fn(async () => tenant),
      delete: vi.fn(async () => true),
    } as never);
    journeyProvision.mockResolvedValue(journeyOk('tn_mail_1', 'co_mail_1') as never);

    await MasterCompanyProvisioningService.createFullyProvisioned({
      company: { name: 'Mail' },
      admin: { name: 'Admin', email: 'admin@mail.test' },
      domain: 'mail.test',
      plan: 'MONTHLY',
      installationType: 'SAAS_WEB',
      operationalCompanyId: 'co_mail_1',
    });

    expect(journeyProvision).toHaveBeenCalledWith(
      'tn_mail_1',
      'master-create:tn_mail_1',
      expect.any(Object),
      { sendFirstAccess: false },
    );
    expect(journeyResendFirstAccess).toHaveBeenCalledWith('tn_mail_1');
  });

  it('recupera consistência após falha e nova tentativa', async () => {
    const store = new Map<string, Record<string, unknown>>();
    const tenantsService = {
      create: vi.fn(async (input: any) => {
        const tenant = {
          id: `tn_retry_${store.size + 1}`,
          operationalCompanyId: input.operationalCompanyId,
          plan: 'MONTHLY',
          status: 'trial',
          mode: 'SAAS',
          gateway: 'none',
          installationType: 'SAAS_WEB',
          license: {},
          company: { name: 'Retry', document: '12345678000190', tradeName: null },
          admin: { name: 'Admin', email: 'admin@retry.test' },
          domain: 'retry.test',
          storage: { driver: 'local' },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        store.set(String(tenant.id), tenant);
        return tenant;
      }),
      update: vi.fn(async (id: string, patch: any) => {
        const current = store.get(id)!;
        const merged = { ...current, ...patch };
        store.set(id, merged);
        return merged;
      }),
      list: vi.fn(async () => [...store.values()] as never[]),
      get: vi.fn(async (id: string) => store.get(id) as never),
      delete: vi.fn(async (id: string) => store.delete(id)),
    };
    getTenantsService.mockReturnValue(tenantsService as never);
    queryMaster.mockImplementation(async (...args: unknown[]) => {
      const sql = String(args[0] || '');
      if (/select subscription_id, license_id, admin_user_id/i.test(sql)) {
        return { rows: [], rowCount: 0 } as never;
      }
      return { rows: [], rowCount: 0 } as never;
    });
    journeyProvision
      .mockRejectedValueOnce(new Error('TIMEOUT_DURING_JOURNEY'))
      .mockResolvedValueOnce(journeyOk('tn_retry_2', 'co_retry_1') as never);

    const payload = {
      company: { name: 'Retry', document: '12.345.678/0001-90' },
      admin: { name: 'Admin', email: 'admin@retry.test' },
      domain: 'retry.test',
      plan: 'MONTHLY' as const,
      installationType: 'SAAS_WEB' as const,
      operationalCompanyId: 'co_retry_1',
    };
    await expect(MasterCompanyProvisioningService.createFullyProvisioned(payload)).rejects.toBeTruthy();
    const success = await MasterCompanyProvisioningService.createFullyProvisioned(payload);
    expect(success.provisioned).toBe(true);
    expect([...store.values()]).toHaveLength(1);
  });

  it.each([
    'TENANT_CREATE_FAILED',
    'INSERT_COMPANY_FAILED',
    'SUBSCRIPTION_STAGE_FAILED',
    'LICENSE_STAGE_FAILED',
    'ADMIN_STAGE_FAILED',
    'PROJECTION_STAGE_FAILED',
  ])('rollback completo quando etapa obrigatória falha: %s', async (failureCode) => {
    const tenantsService = {
      create: vi.fn(async (input: any) => {
        if (failureCode === 'TENANT_CREATE_FAILED') throw new Error(failureCode);
        return {
          id: 'tn_fail_1',
          operationalCompanyId: input.operationalCompanyId,
          plan: 'MONTHLY',
          status: 'trial',
          mode: 'SAAS',
          gateway: 'none',
          installationType: 'SAAS_WEB',
          license: {},
          company: { name: 'Failure', document: '12345678000190', tradeName: null },
          admin: { name: 'Admin', email: 'admin@failure.test' },
          domain: 'failure.test',
          storage: { driver: 'local' },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
      }),
      update: vi.fn(async (_id: string, patch: any) => ({
        id: 'tn_fail_1',
        operationalCompanyId: patch.operationalCompanyId,
        plan: 'MONTHLY',
        status: 'trial',
        mode: 'SAAS',
        gateway: 'none',
        installationType: 'SAAS_WEB',
        license: {},
        company: { name: 'Failure', document: '12345678000190', tradeName: null },
        admin: { name: 'Admin', email: 'admin@failure.test' },
        domain: 'failure.test',
        storage: { driver: 'local' },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })),
      list: vi.fn(async () => []),
      get: vi.fn(async () => null),
      delete: vi.fn(async () => true),
    };
    getTenantsService.mockReturnValue(tenantsService as never);
    const lifecycleRemove = vi.fn(async () => true);
    getLifecycle.mockReturnValue({
      findCurrentByTenant: vi.fn(async () => ({ id: 'sub_fail_1' })),
      remove: lifecycleRemove,
    } as never);
    const licenseDelete = vi.fn(async () => ({ id: 'lic_fail_1' }));
    getLicenseManager.mockReturnValue({
      getByTenantId: vi.fn(async () => ({ id: 'lic_fail_1' })),
      action: licenseDelete,
    } as never);

    queryMaster.mockImplementation(async (...args: unknown[]) => {
      const sql = String(args[0] || '');
      if (failureCode === 'INSERT_COMPANY_FAILED' && /insert into public\.companies/i.test(sql)) {
        throw new Error(failureCode);
      }
      if (/select subscription_id, license_id, admin_user_id/i.test(sql)) {
        return {
          rows: [
            {
              subscription_id: 'sub_fail_1',
              license_id: 'lic_fail_1',
              admin_user_id: 'usr_fail_1',
            },
          ],
          rowCount: 1,
        } as never;
      }
      return { rows: [], rowCount: 0 } as never;
    });

    if (failureCode === 'TENANT_CREATE_FAILED' || failureCode === 'INSERT_COMPANY_FAILED') {
      journeyProvision.mockResolvedValue(journeyOk('tn_fail_1', 'co_fail_1') as never);
    } else {
      journeyProvision.mockRejectedValue(new Error(failureCode));
    }

    await expect(
      MasterCompanyProvisioningService.createFullyProvisioned({
        company: { name: 'Failure', document: '12.345.678/0001-90' },
        admin: { name: 'Admin', email: 'admin@failure.test' },
        domain: 'failure.test',
        plan: 'MONTHLY',
        installationType: 'SAAS_WEB',
        operationalCompanyId: 'co_fail_1',
      }),
    ).rejects.toBeTruthy();

    if (failureCode === 'TENANT_CREATE_FAILED') {
      expect(tenantsService.delete).not.toHaveBeenCalled();
      return;
    }

    const companyDelete = queryMaster.mock.calls.some((args) =>
      /delete from public\.companies/i.test(String(args[0])),
    );
    expect(companyDelete).toBe(true);
    expect(tenantsService.delete).toHaveBeenCalledWith('tn_fail_1');
    if (!['INSERT_COMPANY_FAILED'].includes(failureCode)) {
      expect(licenseDelete).toHaveBeenCalled();
      expect(lifecycleRemove).toHaveBeenCalled();
    }
  });
});

