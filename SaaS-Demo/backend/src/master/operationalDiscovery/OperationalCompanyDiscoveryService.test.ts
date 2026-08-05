// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../db/index.js', () => ({
  pool: {
    queryMaster: vi.fn(),
  },
  checkDatabaseConnection: vi.fn(async () => true),
}));

vi.mock('../../services/master/masterPlatformService.js', () => ({
  MasterPlatformService: {
    getTenantsService: vi.fn(),
    getLifecycle: vi.fn(),
    getLicenseManager: vi.fn(),
  },
}));

vi.mock('../commercial/index.js', () => ({
  projectCommercialStateToSaas: vi.fn(async () => ({ ok: true })),
}));

vi.mock('../crm/CommercialCrmService.js', () => ({
  CommercialCrmService: {
    getSnapshot: vi.fn(async () => ({ profile: { masterTenantId: 'tn_1' } })),
  },
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
      return { tenantId: 'tn_1' };
    }
  },
}));

import { pool } from '../../db/index.js';
import { MasterPlatformService } from '../../services/master/masterPlatformService.js';
import { OperationalCompanyDiscoveryService } from './OperationalCompanyDiscoveryService.js';

describe('OperationalCompanyDiscoveryService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lista empresas operacionais e marca não inicializadas', async () => {
    vi.mocked(pool.queryMaster).mockResolvedValueOnce({
      rows: [
        {
          operational_company_id: 'co-test-1',
          razao_social: 'Empresa Teste LTDA',
          nome_fantasia: 'Empresa Teste',
          cnpj: '00.000.000/0001-00',
          email: 'admin@teste.local',
          telefone: null,
          master_tenant_id: null,
          plan: null,
          status: null,
          expires_at: null,
          commercial_situation: null,
          origin: 'operational',
        },
      ],
      rowCount: 1,
    } as never);

    const directory = await OperationalCompanyDiscoveryService.listDirectory();
    expect(directory.count).toBe(1);
    expect(directory.uninitializedCount).toBe(1);
    expect(directory.companies[0].initStatus).toBe('not_initialized');
    expect(directory.companies[0].razaoSocial).toBe('Empresa Teste LTDA');
  });

  it('inicializa domínio comercial sem criar nova company e reutiliza vínculo existente', async () => {
    const create = vi.fn();
    const update = vi.fn();
    const get = vi.fn(async () => ({
      id: 'tn_existing',
      operationalCompanyId: 'co-test-1',
      plan: 'TRIAL',
      status: 'trial',
      mode: 'SAAS',
      gateway: 'none',
      installationType: 'SAAS_WEB',
      license: {},
      company: { name: 'Empresa Teste LTDA', document: null, tradeName: null },
      admin: { name: 'Admin', email: 'admin@teste.local' },
      domain: 'empresa.operational.local',
      storage: { driver: 'local' },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }));
    const applyAction = vi.fn();

    vi.mocked(MasterPlatformService.getTenantsService).mockReturnValue({
      create,
      update,
      get,
      applyAction,
    } as never);

    const createSubscription = vi.fn(async () => ({
      id: 'sub_1',
      toProps: () => ({ id: 'sub_1', tenantId: 'tn_existing', plan: 'TRIAL' }),
    }));
    vi.mocked(MasterPlatformService.getLifecycle).mockReturnValue({
      findCurrentByTenant: vi.fn(async () => null),
      createSubscription,
    } as never);

    const licenseCreate = vi.fn(async () => ({
      id: 'lic_1',
      status: 'Trial',
      tenantId: 'tn_existing',
    }));
    vi.mocked(MasterPlatformService.getLicenseManager).mockReturnValue({
      getByTenantId: vi.fn(async () => null),
      create: licenseCreate,
    } as never);

    vi.mocked(pool.queryMaster)
      // loadOperationalCompany
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'co-test-1',
            nome: 'Empresa Teste LTDA',
            name: 'Empresa Teste',
            cnpj: '00.000.000/0001-00',
            telefone: null,
            phone: null,
            responsavel_nome: 'Admin',
            responsavel_email: 'admin@teste.local',
          },
        ],
      } as never)
      // findTenantByOperationalCompanyId
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'tn_existing',
            operational_company_id: 'co-test-1',
            company_name: 'Empresa Teste LTDA',
            plan: 'TRIAL',
            status: 'trial',
            license_expires_at: null,
          },
        ],
      } as never)
      // onboarding upsert + updates + prefs
      .mockResolvedValue({ rows: [], rowCount: 0 } as never);

    const result = await OperationalCompanyDiscoveryService.initializeCommercial('co-test-1', {
      userId: 'mu_1',
    });

    expect(result.ok).toBe(true);
    expect(result.reused).toBe(true);
    expect(result.operationalCompanyId).toBe('co-test-1');
    expect(result.masterTenantId).toBe('tn_existing');
    expect(create).not.toHaveBeenCalled();
    expect(createSubscription).toHaveBeenCalled();
    expect(licenseCreate).toHaveBeenCalled();

    // Garante que nenhum INSERT em companies foi emitido.
    const sqlCalls = vi.mocked(pool.queryMaster).mock.calls.map((c) => String(c[0]));
    expect(sqlCalls.some((sql) => /insert\s+into\s+public\.companies/i.test(sql))).toBe(false);
    expect(
      sqlCalls.some((sql) =>
        /insert\s+into\s+public\.master_commercial_onboardings[\s\S]*on\s+conflict\s+\(operational_company_id\)/i.test(
          sql,
        ),
      ),
    ).toBe(true);
  });

  it('reporta órfãos comerciais quando company operacional sumiu', async () => {
    vi.mocked(pool.queryMaster).mockResolvedValueOnce({
      rows: [
        {
          operational_company_id: 'co-missing',
          razao_social: 'Fantasma',
          nome_fantasia: null,
          cnpj: null,
          email: null,
          telefone: null,
          master_tenant_id: 'tn_orphan',
          plan: 'TRIAL',
          status: 'trial',
          expires_at: null,
          commercial_situation: null,
          origin: 'orphan',
        },
      ],
    } as never);

    const orphans = await OperationalCompanyDiscoveryService.listOrphans();
    expect(orphans).toHaveLength(1);
    expect(orphans[0].reason).toBe('operational_company_missing');
    expect(orphans[0].masterTenantId).toBe('tn_orphan');
  });

  it('reaproveita tenant por domínio quando create retorna domain already in use', async () => {
    const create = vi.fn(async () => {
      throw new Error('domain already in use: fl-locadora-ltda.operational.local');
    });
    const update = vi.fn(async (_id: string, patch: { operationalCompanyId?: string }) => ({
      id: 'tn_domain_reused',
      operationalCompanyId: patch.operationalCompanyId || null,
      plan: 'TRIAL',
      status: 'trial',
      mode: 'SAAS',
      gateway: 'none',
      installationType: 'SAAS_WEB',
      license: {},
      company: { name: 'FL LOCADORA LTDA', document: '15048950000163', tradeName: null },
      admin: { name: 'admin', email: 'admin@pontowebdesk.com' },
      domain: 'fl-locadora-ltda-a145b0cd76f4.operational.local',
      storage: { driver: 'local' },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }));
    const getByDomain = vi.fn(async () => ({
      id: 'tn_domain_reused',
      operationalCompanyId: null,
      plan: 'TRIAL',
      status: 'trial',
      mode: 'SAAS',
      gateway: 'none',
      installationType: 'SAAS_WEB',
      license: {},
      company: { name: 'FL LOCADORA LTDA', document: '15048950000163', tradeName: null },
      admin: { name: 'admin', email: 'admin@pontowebdesk.com' },
      domain: 'fl-locadora-ltda-a145b0cd76f4.operational.local',
      storage: { driver: 'local' },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }));

    vi.mocked(MasterPlatformService.getTenantsService).mockReturnValue({
      create,
      update,
      getManager: vi.fn(() => ({ getByDomain })),
      get: vi.fn(),
      applyAction: vi.fn(),
    } as never);
    vi.mocked(MasterPlatformService.getLifecycle).mockReturnValue({
      findCurrentByTenant: vi.fn(async () => ({ id: 'sub_1', toProps: () => ({ id: 'sub_1' }) })),
      createSubscription: vi.fn(),
    } as never);
    vi.mocked(MasterPlatformService.getLicenseManager).mockReturnValue({
      getByTenantId: vi.fn(async () => ({ id: 'lic_1', status: 'Trial' })),
      create: vi.fn(),
    } as never);

    vi.mocked(pool.queryMaster)
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'co-fl-1',
            nome: 'FL LOCADORA LTDA',
            name: 'FL LOCADORA LTDA',
            cnpj: '15048950000163',
            telefone: null,
            phone: null,
            responsavel_nome: 'admin',
            responsavel_email: 'admin@pontowebdesk.com',
          },
        ],
      } as never)
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as never)
      .mockResolvedValue({ rows: [], rowCount: 0 } as never);

    const result = await OperationalCompanyDiscoveryService.initializeCommercial('co-fl-1');

    expect(result.ok).toBe(true);
    expect(result.reused).toBe(true);
    expect(create).toHaveBeenCalledTimes(1);
    expect(getByDomain).toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith('tn_domain_reused', { operationalCompanyId: 'co-fl-1' });
  });

  it('busca empresa operacional por documento usando fallback legado cpf_cnpj', async () => {
    vi.mocked(pool.queryMaster).mockResolvedValueOnce({
      rows: [
        {
          id: 'co-legacy-1',
          cnpj: '15048950000163',
          nome: 'FL LOCADORA LTDA',
          name: 'FL LOCADORA LTDA',
        },
      ],
      rowCount: 1,
    } as never);

    const found = await OperationalCompanyDiscoveryService.findOperationalCompanyByDocument(
      '15.048.950/0001-63',
    );

    expect(found?.id).toBe('co-legacy-1');
    const [sql, params] = vi.mocked(pool.queryMaster).mock.calls[0] ?? [];
    expect(String(sql)).toContain("to_jsonb(c)->>'cpf_cnpj'");
    expect(params).toEqual(['15048950000163']);
  });
});
