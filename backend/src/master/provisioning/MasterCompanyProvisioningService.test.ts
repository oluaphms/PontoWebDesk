// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../db/index.js', () => ({
  pool: { queryMaster: vi.fn(async () => ({ rows: [], rowCount: 0 })) },
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

vi.mock('../subscriptionNotifications/SubscriptionNotificationService.js', () => ({
  SubscriptionNotificationService: class {},
}));

vi.mock('../operationalDiscovery/OperationalCompanyDiscoveryService.js', () => ({
  OperationalCompanyDiscoveryService: {
    findOperationalCompanyByDocument: vi.fn(async () => null),
  },
}));

import { MasterPlatformService } from '../../services/master/masterPlatformService.js';
import { checkDatabaseConnection } from '../../db/index.js';
import { CommercialJourneyService } from '../journey/CommercialJourneyService.js';
import { CommercialCrmService } from '../crm/CommercialCrmService.js';
import {
  MasterCompanyProvisioningService,
  insertOperationalCompanyFromTenant,
} from './MasterCompanyProvisioningService.js';
import { OperationalCompanyDiscoveryService } from '../operationalDiscovery/OperationalCompanyDiscoveryService.js';
import { pool } from '../../db/index.js';

describe('MasterCompanyProvisioningService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(checkDatabaseConnection).mockResolvedValue(true);
    vi.mocked(CommercialCrmService.getSnapshot).mockResolvedValue({ profile: null } as never);
    vi.mocked(MasterPlatformService.getAudit).mockReturnValue({
      append: vi.fn(),
    } as never);
    vi.mocked(MasterPlatformService.getLifecycle).mockReturnValue({
      findCurrentByTenant: vi.fn(async () => null),
      remove: vi.fn(async () => true),
    } as never);
    vi.mocked(MasterPlatformService.getLicenseManager).mockReturnValue({
      getByTenantId: vi.fn(async () => null),
      action: vi.fn(async () => ({ id: 'lic_rollback' })),
    } as never);
    vi.mocked(CommercialJourneyService.resendFirstAccess).mockResolvedValue(null as never);
    vi.mocked(OperationalCompanyDiscoveryService.findOperationalCompanyByDocument).mockResolvedValue(null);
  });

  it('falha sem criar tenant quando banco operacional está indisponível', async () => {
    vi.mocked(checkDatabaseConnection).mockResolvedValue(false);
    const create = vi.fn();
    vi.mocked(MasterPlatformService.getTenantsService).mockReturnValue({
      create,
      update: vi.fn(),
      get: vi.fn(),
      list: vi.fn(async () => []),
      delete: vi.fn(),
    } as never);

    await expect(
      MasterCompanyProvisioningService.createFullyProvisioned({
        company: { name: 'Nova Empresa' },
        admin: { name: 'Admin', email: 'admin@nova.test' },
        domain: 'nova.test',
        plan: 'MONTHLY',
        installationType: 'SAAS_WEB',
      }),
    ).rejects.toMatchObject({ code: 'OPERATIONAL_DATABASE_UNAVAILABLE' });
    expect(create).not.toHaveBeenCalled();
  });

  it('provisiona com sucesso quando banco operacional está disponível', async () => {
    const create = vi.fn(async (input: { operationalCompanyId?: string | null }) => ({
      id: 'tn_mem_1',
      operationalCompanyId: input.operationalCompanyId,
      plan: 'MONTHLY',
      status: 'trial',
      mode: 'SAAS',
      gateway: 'none',
      installationType: 'SAAS_WEB',
      license: {},
      company: { name: 'Nova Empresa', document: null, tradeName: null },
      admin: { name: 'Admin', email: 'admin@nova.test' },
      domain: 'nova.test',
      storage: { driver: 'local' },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }));
    vi.mocked(MasterPlatformService.getTenantsService).mockReturnValue({
      create,
      update: vi.fn(),
      list: vi.fn(async () => []),
      get: vi.fn(async () => ({
        id: 'tn_mem_1',
        operationalCompanyId: 'co_1',
        plan: 'MONTHLY',
        status: 'active',
        mode: 'SAAS',
        gateway: 'none',
        installationType: 'SAAS_WEB',
        license: {},
        company: { name: 'Nova Empresa', document: null, tradeName: null },
        admin: { name: 'Admin', email: 'admin@nova.test' },
        domain: 'nova.test',
        storage: { driver: 'local' },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })),
      delete: vi.fn(async () => true),
    } as never);
    vi.mocked(CommercialJourneyService.provision).mockResolvedValue({
      tenantId: 'tn_mem_1',
      operationalCompanyId: 'co_1',
      state: 'completed',
      completedSteps: ['company', 'plan', 'license', 'activation', 'admin'],
      customerId: 'cust_1',
      subscriptionId: 'sub_1',
      licenseId: 'lic_1',
      adminUserId: 'usr_1',
      adminEmail: 'admin@nova.test',
      inviteSentAt: new Date().toISOString(),
      firstLoginAt: null,
      lastError: null,
      nextAction: null,
      steps: [],
      wizard: {
        tenantId: 'tn_mem_1',
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
          firstAccessSent: true,
          updaterRegistered: false,
          implantationCompleted: true,
        },
      },
    } as never);

    const result = await MasterCompanyProvisioningService.createFullyProvisioned({
      company: { name: 'Nova Empresa' },
      admin: { name: 'Admin', email: 'admin@nova.test' },
      domain: 'nova.test',
      plan: 'MONTHLY',
      installationType: 'SAAS_WEB',
    });

    expect(result.provisioned).toBe(true);
    expect(result.provisionCorrelationId).toBeTruthy();
    expect(result.tenant.id).toBe('tn_mem_1');
    expect(result.subscriptionId).toBe('sub_1');
    expect(result.licenseId).toBe('lic_1');
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        operationalCompanyId: result.operationalCompanyId,
        status: 'trial',
      }),
    );
  });

  it('reaplica compatibilidade do bootstrap quando erro entry_time ocorre no trigger', async () => {
    const entryTimeError = Object.assign(
      new Error('coluna "entry_time" da relação "work_shifts" não existe'),
      {
        where: 'função PL/pgSQL pwd_bootstrap_company_defaults(text) linha 53 em comando SQL',
        internalQuery:
          "INSERT INTO public.work_shifts (company_id, name, entry_time, exit_time) VALUES ('co_1','Jornada 44h Semanais','08:00','18:00')",
      },
    );
    vi.mocked(pool.queryMaster)
      .mockRejectedValueOnce(entryTimeError as never)
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as never)
      .mockResolvedValueOnce({ rows: [], rowCount: 1 } as never);

    await insertOperationalCompanyFromTenant(
      {
        id: 'tn_bootstrap_fix',
        company: { name: 'Empresa Teste', document: null, tradeName: null },
        domain: 'empresa-teste.operational.local',
        admin: { name: 'Admin', email: 'admin@test.local' },
        plan: 'MONTHLY',
        status: 'trial',
        mode: 'SAAS',
        gateway: 'none',
        installationType: 'SAAS_WEB',
        license: {},
        storage: { driver: 'local' },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      } as never,
      'co_1',
    );

    expect(vi.mocked(pool.queryMaster)).toHaveBeenCalledTimes(3);
    const repairSql = String(vi.mocked(pool.queryMaster).mock.calls[1]?.[0] || '');
    expect(repairSql).toContain('CREATE OR REPLACE FUNCTION public.pwd_bootstrap_company_defaults');
  });

  it('reutiliza cadastro em chamada duplicada (idempotência por CNPJ)', async () => {
    const tenantsStore: Array<Record<string, unknown>> = [];
    const create = vi.fn(async (input: { operationalCompanyId?: string | null }) => {
      const row = {
        id: 'tn_dup_1',
        operationalCompanyId: input.operationalCompanyId,
        plan: 'MONTHLY',
        status: 'trial',
        mode: 'SAAS',
        gateway: 'none',
        installationType: 'SAAS_WEB',
        license: {},
        company: { name: 'Empresa Dup', document: '12.345.678/0001-90', tradeName: null },
        admin: { name: 'Admin', email: 'admin@dup.test' },
        domain: 'dup.test',
        storage: { driver: 'local' },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      tenantsStore.push(row);
      return row;
    });
    vi.mocked(MasterPlatformService.getTenantsService).mockReturnValue({
      create,
      update: vi.fn(),
      list: vi.fn(async () => tenantsStore as never[]),
      get: vi.fn(async () => tenantsStore[0] as never),
      delete: vi.fn(async () => true),
    } as never);
    vi.mocked(CommercialJourneyService.provision).mockResolvedValue({
      tenantId: 'tn_dup_1',
      operationalCompanyId: 'co_dup_1',
      state: 'completed',
      completedSteps: [],
      customerId: 'cust_dup',
      subscriptionId: 'sub_dup_1',
      licenseId: 'lic_dup_1',
      adminUserId: 'usr_dup',
      adminEmail: 'admin@dup.test',
      inviteSentAt: null,
      firstLoginAt: null,
      lastError: null,
      nextAction: null,
      steps: [],
      wizard: {
        tenantId: 'tn_dup_1',
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
    } as never);

    const payload = {
      company: { name: 'Empresa Dup', document: '12.345.678/0001-90' },
      admin: { name: 'Admin', email: 'admin@dup.test' },
      domain: 'dup.test',
      plan: 'MONTHLY' as const,
      installationType: 'SAAS_WEB' as const,
      operationalCompanyId: 'co_dup_1',
    };
    const first = await MasterCompanyProvisioningService.createFullyProvisioned(payload);
    const second = await MasterCompanyProvisioningService.createFullyProvisioned(payload);

    expect(first.tenant.id).toBe('tn_dup_1');
    expect(second.tenant.id).toBe('tn_dup_1');
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('quando empresa operacional já existe (mesmo CNPJ), vincula sem recriar companies', async () => {
    vi.mocked(OperationalCompanyDiscoveryService.findOperationalCompanyByDocument).mockResolvedValue({
      id: 'co_existing_1',
      cnpj: '12.345.678/0001-90',
      nome: 'Operacional Existente',
      name: 'Operacional Existente',
    });
    const create = vi.fn(async (input: { operationalCompanyId?: string | null }) => ({
      id: 'tn_existing_1',
      operationalCompanyId: input.operationalCompanyId,
      plan: 'MONTHLY',
      status: 'trial',
      mode: 'SAAS',
      gateway: 'none',
      installationType: 'SAAS_WEB',
      license: {},
      company: { name: 'Operacional Existente', document: '12.345.678/0001-90', tradeName: null },
      admin: { name: 'Admin', email: 'admin@existing.test' },
      domain: 'existing.test',
      storage: { driver: 'local' },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }));
    const update = vi.fn(async (_id: string, patch: { operationalCompanyId?: string }) => ({
      id: 'tn_existing_1',
      operationalCompanyId: patch.operationalCompanyId ?? 'co_existing_1',
      plan: 'MONTHLY',
      status: 'trial',
      mode: 'SAAS',
      gateway: 'none',
      installationType: 'SAAS_WEB',
      license: {},
      company: { name: 'Operacional Existente', document: '12.345.678/0001-90', tradeName: null },
      admin: { name: 'Admin', email: 'admin@existing.test' },
      domain: 'existing.test',
      storage: { driver: 'local' },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }));
    vi.mocked(MasterPlatformService.getTenantsService).mockReturnValue({
      create,
      update,
      list: vi.fn(async () => []),
      get: vi.fn(async () => ({
        id: 'tn_existing_1',
        operationalCompanyId: 'co_existing_1',
        plan: 'MONTHLY',
        status: 'active',
        mode: 'SAAS',
        gateway: 'none',
        installationType: 'SAAS_WEB',
        license: {},
        company: { name: 'Operacional Existente', document: '12.345.678/0001-90', tradeName: null },
        admin: { name: 'Admin', email: 'admin@existing.test' },
        domain: 'existing.test',
        storage: { driver: 'local' },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })),
      delete: vi.fn(async () => true),
    } as never);
    vi.mocked(CommercialJourneyService.provision).mockResolvedValue({
      tenantId: 'tn_existing_1',
      operationalCompanyId: 'co_existing_1',
      state: 'completed',
      completedSteps: ['company', 'plan', 'license', 'activation', 'admin'],
      customerId: 'cust_existing_1',
      subscriptionId: 'sub_existing_1',
      licenseId: 'lic_existing_1',
      adminUserId: 'usr_existing_1',
      adminEmail: 'admin@existing.test',
      inviteSentAt: null,
      firstLoginAt: null,
      lastError: null,
      nextAction: null,
      steps: [],
      wizard: {
        tenantId: 'tn_existing_1',
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
    } as never);

    const result = await MasterCompanyProvisioningService.createFullyProvisioned({
      company: { name: 'Operacional Existente', document: '12.345.678/0001-90' },
      admin: { name: 'Admin', email: 'admin@existing.test' },
      domain: 'existing.test',
      plan: 'MONTHLY',
      installationType: 'SAAS_WEB',
    });

    expect(OperationalCompanyDiscoveryService.findOperationalCompanyByDocument).toHaveBeenCalled();
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ operationalCompanyId: 'co_existing_1' }));
    expect(result.operationalCompanyId).toBe('co_existing_1');
  });

  it('empresa operacional existente + onboarding existente: reaproveita onboarding sem criar novo', async () => {
    vi.mocked(OperationalCompanyDiscoveryService.findOperationalCompanyByDocument).mockResolvedValue({
      id: 'co_existing_onb_1',
      cnpj: '15048950000163',
      nome: 'FL LOCADORA LTDA',
      name: 'FL LOCADORA LTDA',
    });
    const queryMaster = vi.mocked(pool.queryMaster);
    queryMaster.mockImplementation(async (sql: string) => {
      if (/from public\.master_commercial_onboardings[\s\S]*operational_company_id/i.test(sql)) {
        return {
          rows: [
            {
              id: 'onb_existing_1',
              master_tenant_id: 'tn_old_1',
              operational_company_id: 'co_existing_onb_1',
              customer_id: 'cust_tn_old_1',
              subscription_id: null,
              license_id: null,
              admin_email: 'admin@old.test',
            },
          ],
          rowCount: 1,
        } as never;
      }
      return { rows: [], rowCount: 0 } as never;
    });
    const create = vi.fn(async (input: { operationalCompanyId?: string | null }) => ({
      id: 'tn_new_1',
      operationalCompanyId: input.operationalCompanyId,
      plan: 'MONTHLY',
      status: 'trial',
      mode: 'SAAS',
      gateway: 'none',
      installationType: 'SAAS_WEB',
      license: {},
      company: { name: 'FL LOCADORA LTDA', document: '15.048.950/0001-63', tradeName: null },
      admin: { name: 'Admin', email: 'admin@new.test' },
      domain: 'fl.test',
      storage: { driver: 'local' },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }));
    vi.mocked(MasterPlatformService.getTenantsService).mockReturnValue({
      create,
      update: vi.fn(async (_id: string, patch: { operationalCompanyId?: string | null }) => ({
        id: 'tn_new_1',
        operationalCompanyId: patch.operationalCompanyId || 'co_existing_onb_1',
        plan: 'MONTHLY',
        status: 'trial',
        mode: 'SAAS',
        gateway: 'none',
        installationType: 'SAAS_WEB',
        license: {},
        company: { name: 'FL LOCADORA LTDA', document: '15.048.950/0001-63', tradeName: null },
        admin: { name: 'Admin', email: 'admin@new.test' },
        domain: 'fl.test',
        storage: { driver: 'local' },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })),
      list: vi.fn(async () => []),
      get: vi.fn(async () => ({
        id: 'tn_new_1',
        operationalCompanyId: 'co_existing_onb_1',
        plan: 'MONTHLY',
        status: 'active',
        mode: 'SAAS',
        gateway: 'none',
        installationType: 'SAAS_WEB',
        license: {},
        company: { name: 'FL LOCADORA LTDA', document: '15.048.950/0001-63', tradeName: null },
        admin: { name: 'Admin', email: 'admin@new.test' },
        domain: 'fl.test',
        storage: { driver: 'local' },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })),
      delete: vi.fn(async () => true),
    } as never);
    vi.mocked(CommercialJourneyService.provision).mockResolvedValue({
      tenantId: 'tn_new_1',
      operationalCompanyId: 'co_existing_onb_1',
      state: 'completed',
      completedSteps: [],
      customerId: 'cust_tn_new_1',
      subscriptionId: 'sub_new_1',
      licenseId: 'lic_new_1',
      adminUserId: 'usr_new_1',
      adminEmail: 'admin@new.test',
      inviteSentAt: null,
      firstLoginAt: null,
      lastError: null,
      nextAction: null,
      steps: [],
      wizard: {
        tenantId: 'tn_new_1',
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
    } as never);

    await MasterCompanyProvisioningService.createFullyProvisioned({
      company: { name: 'FL LOCADORA LTDA', document: '15.048.950/0001-63' },
      admin: { name: 'Admin', email: 'admin@new.test' },
      domain: 'fl.test',
      plan: 'MONTHLY',
      installationType: 'SAAS_WEB',
    });

    const onboardingInsert = queryMaster.mock.calls.find((args) =>
      /insert into public\.master_commercial_onboardings/i.test(String(args[0] || '')),
    );
    expect(onboardingInsert).toBeFalsy();
    const onboardingUpdate = queryMaster.mock.calls.find((args) =>
      /update public\.master_commercial_onboardings[\s\S]*master_tenant_id/i.test(
        String(args[0] || ''),
      ),
    );
    expect(onboardingUpdate).toBeTruthy();
  });

  it('empresa operacional existente + onboarding inexistente: segue provisionamento sem conflito', async () => {
    vi.mocked(OperationalCompanyDiscoveryService.findOperationalCompanyByDocument).mockResolvedValue({
      id: 'co_existing_onb_2',
      cnpj: '15048950000163',
      nome: 'FL LOCADORA LTDA',
      name: 'FL LOCADORA LTDA',
    });
    const queryMaster = vi.mocked(pool.queryMaster);
    queryMaster.mockResolvedValue({ rows: [], rowCount: 0 } as never);
    const create = vi.fn(async (input: { operationalCompanyId?: string | null }) => ({
      id: 'tn_new_2',
      operationalCompanyId: input.operationalCompanyId,
      plan: 'MONTHLY',
      status: 'trial',
      mode: 'SAAS',
      gateway: 'none',
      installationType: 'SAAS_WEB',
      license: {},
      company: { name: 'FL LOCADORA LTDA', document: '15.048.950/0001-63', tradeName: null },
      admin: { name: 'Admin', email: 'admin@new2.test' },
      domain: 'fl2.test',
      storage: { driver: 'local' },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }));
    vi.mocked(MasterPlatformService.getTenantsService).mockReturnValue({
      create,
      update: vi.fn(async (_id: string, patch: { operationalCompanyId?: string | null }) => ({
        id: 'tn_new_2',
        operationalCompanyId: patch.operationalCompanyId || 'co_existing_onb_2',
        plan: 'MONTHLY',
        status: 'trial',
        mode: 'SAAS',
        gateway: 'none',
        installationType: 'SAAS_WEB',
        license: {},
        company: { name: 'FL LOCADORA LTDA', document: '15.048.950/0001-63', tradeName: null },
        admin: { name: 'Admin', email: 'admin@new2.test' },
        domain: 'fl2.test',
        storage: { driver: 'local' },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })),
      list: vi.fn(async () => []),
      get: vi.fn(async () => ({
        id: 'tn_new_2',
        operationalCompanyId: 'co_existing_onb_2',
        plan: 'MONTHLY',
        status: 'active',
        mode: 'SAAS',
        gateway: 'none',
        installationType: 'SAAS_WEB',
        license: {},
        company: { name: 'FL LOCADORA LTDA', document: '15.048.950/0001-63', tradeName: null },
        admin: { name: 'Admin', email: 'admin@new2.test' },
        domain: 'fl2.test',
        storage: { driver: 'local' },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })),
      delete: vi.fn(async () => true),
    } as never);
    vi.mocked(CommercialJourneyService.provision).mockResolvedValue({
      tenantId: 'tn_new_2',
      operationalCompanyId: 'co_existing_onb_2',
      state: 'completed',
      completedSteps: [],
      customerId: 'cust_tn_new_2',
      subscriptionId: 'sub_new_2',
      licenseId: 'lic_new_2',
      adminUserId: 'usr_new_2',
      adminEmail: 'admin@new2.test',
      inviteSentAt: null,
      firstLoginAt: null,
      lastError: null,
      nextAction: null,
      steps: [],
      wizard: {
        tenantId: 'tn_new_2',
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
    } as never);

    const result = await MasterCompanyProvisioningService.createFullyProvisioned({
      company: { name: 'FL LOCADORA LTDA', document: '15.048.950/0001-63' },
      admin: { name: 'Admin', email: 'admin@new2.test' },
      domain: 'fl2.test',
      plan: 'MONTHLY',
      installationType: 'SAAS_WEB',
    });
    expect(result.operationalCompanyId).toBe('co_existing_onb_2');
  });

  it('mesma empresa cadastrada duas vezes permanece idempotente', async () => {
    const tenantsStore: Array<Record<string, unknown>> = [];
    vi.mocked(OperationalCompanyDiscoveryService.findOperationalCompanyByDocument).mockResolvedValue({
      id: 'co_existing_same_1',
      cnpj: '15048950000163',
      nome: 'FL LOCADORA LTDA',
      name: 'FL LOCADORA LTDA',
    });
    const create = vi.fn(async (input: { operationalCompanyId?: string | null }) => {
      const row = {
        id: 'tn_same_1',
        operationalCompanyId: input.operationalCompanyId,
        plan: 'MONTHLY',
        status: 'trial',
        mode: 'SAAS',
        gateway: 'none',
        installationType: 'SAAS_WEB',
        license: {},
        company: { name: 'FL LOCADORA LTDA', document: '15.048.950/0001-63', tradeName: null },
        admin: { name: 'Admin', email: 'admin@same.test' },
        domain: 'same.test',
        storage: { driver: 'local' },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      tenantsStore.push(row);
      return row;
    });
    vi.mocked(MasterPlatformService.getTenantsService).mockReturnValue({
      create,
      update: vi.fn(async (_id: string, patch: any) => ({
        ...(tenantsStore[0] as Record<string, unknown>),
        ...patch,
      }) as never),
      list: vi.fn(async () => tenantsStore as never[]),
      get: vi.fn(async () => tenantsStore[0] as never),
      delete: vi.fn(async () => true),
    } as never);
    vi.mocked(CommercialJourneyService.provision).mockResolvedValue({
      tenantId: 'tn_same_1',
      operationalCompanyId: 'co_existing_same_1',
      state: 'completed',
      completedSteps: [],
      customerId: 'cust_same_1',
      subscriptionId: 'sub_same_1',
      licenseId: 'lic_same_1',
      adminUserId: 'usr_same_1',
      adminEmail: 'admin@same.test',
      inviteSentAt: null,
      firstLoginAt: null,
      lastError: null,
      nextAction: null,
      steps: [],
      wizard: {
        tenantId: 'tn_same_1',
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
    } as never);

    const payload = {
      company: { name: 'FL LOCADORA LTDA', document: '15.048.950/0001-63' },
      admin: { name: 'Admin', email: 'admin@same.test' },
      domain: 'same.test',
      plan: 'MONTHLY' as const,
      installationType: 'SAAS_WEB' as const,
    };
    const first = await MasterCompanyProvisioningService.createFullyProvisioned(payload);
    const second = await MasterCompanyProvisioningService.createFullyProvisioned(payload);
    expect(first.tenant.id).toBe('tn_same_1');
    expect(second.tenant.id).toBe('tn_same_1');
    expect(create).toHaveBeenCalledTimes(1);
  });
});
