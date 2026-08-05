/**
 * Composition root consolidado do Painel Master.
 * Monta todos os serviços a partir do MasterRepositoryRegistry (estado único).
 */
import {
  getMasterRepositoryRegistry,
  MasterRepositoryRegistry,
  resetMasterRepositoryRegistry,
} from './MasterRepositoryRegistry.js';
import { BridgingBillingRepository } from './BridgingBillingRepository.js';
import { syncManagedTenantToLegacy } from './syncManagedTenantToLegacy.js';
import {
  bindLegacyBillingChargesToStore,
  restoreLegacyChargesFromStore,
} from './bindLegacyBillingCharges.js';
import { projectCommercialStateToSaas } from '../commercial/index.js';
import { createMasterServices, type MasterServices } from '../createMasterServices.js';
import { createMasterDashboard } from '../dashboard/createMasterDashboard.js';
import type { MasterDashboardService } from '../dashboard/MasterDashboardService.js';
import { MasterTenantsService } from '../tenants/MasterTenantsService.js';
import { SubscriptionService as SubscriptionLifecycleService } from '../subscriptions/subscription.service.js';
import { BillingEngine } from '../billing/BillingEngine.js';
import { DecoupledBillingEngine } from '../billingEngine/DecoupledBillingEngine.js';
import { createUnifiedPaymentProvider } from '../payments/unifiedPaymentProvider.js';
import { WebhookService } from '../payments/WebhookService.js';
import { LicenseManagerService } from '../licenseManager/LicenseManagerService.js';
import { LocalLicenseManager } from '../localLicense/LocalLicenseManager.js';
import { TenantDeploymentManager } from '../deploymentManager/TenantDeploymentManager.js';
import { createHybridSync, type HybridSyncServices } from '../hybridSync/createHybridSync.js';
import { createDisabledHybridSync } from '../hybridSync/createDisabledHybridSync.js';
import { MasterAuthService } from '../auth/MasterAuthService.js';
import { PgMasterUserStore } from '../auth/adapters/PgMasterUserStore.js';
import { PgMasterSessionStore } from '../auth/adapters/PgMasterSessionStore.js';
import { PgMasterLoginAttemptStore } from '../auth/adapters/PgMasterLoginAttemptStore.js';
import type { ManagedTenant } from '../tenantManager/tenantManager.types.js';
import type {
  CreateManagedTenantInput,
  UpdateManagedTenantInput,
} from '../tenantManager/tenantManager.types.js';
import type { MasterTenantAction } from '../tenants/MasterTenantsService.js';
import type { MasterTenantsListFilter } from '../tenants/MasterTenantsService.js';
import type { CompanyLicense } from '../licenseManager/types.js';
import type { MasterLicenseRecord } from '../types.js';

function mapCompanyLicenseToDashboardRecord(lic: CompanyLicense): MasterLicenseRecord {
  return {
    id: lic.id,
    tenantId: lic.tenantId,
    customerId: `cust_${lic.tenantId}`,
    tier: 'standard',
    plan: lic.plan,
    payloadJson: JSON.stringify({
      mode: lic.mode,
      status: lic.status,
      rules: lic.rules,
    }),
    key: lic.id,
    generatedAt: lic.createdAt,
    expiresAt: lic.expiresAt,
    activatedAt: lic.status === 'Ativa' || lic.status === 'Trial' ? lic.startsAt : null,
    revokedAt: lic.status === 'Bloqueada' ? lic.blockedAt : null,
  };
}

/** Liga contagens/listagens do dashboard ao License Manager persistente. */
function bindDashboardLicensesToManager(
  dashboard: MasterDashboardService,
  licenseManager: LicenseManagerService,
): void {
  dashboard.licenses.list = async () => {
    const rows = await licenseManager.list();
    return rows.map(mapCompanyLicenseToDashboardRecord);
  };
  dashboard.licenses.listByTenant = async (tenantId: string) => {
    const row = await licenseManager.getByTenantId(tenantId);
    return row ? [mapCompanyLicenseToDashboardRecord(row)] : [];
  };
  dashboard.licenses.count = async () => (await licenseManager.list()).length;
}

export type MasterComposition = {
  registry: MasterRepositoryRegistry;
  masterServices: MasterServices;
  dashboard: MasterDashboardService;
  tenantsService: MasterTenantsService;
  lifecycle: SubscriptionLifecycleService;
  /** @deprecated Wrapper — use billingEngine (DecoupledBillingEngine). */
  billingEngineLegacy: BillingEngine;
  /** Implementação oficial de Billing. */
  billingEngine: DecoupledBillingEngine;
  licenseManager: LicenseManagerService;
  localLicense: LocalLicenseManager;
  tenantDeployments: TenantDeploymentManager;
  hybridSync: HybridSyncServices;
  auth: MasterAuthService;
};

/**
 * MasterTenantsService oficial com espelhamento no repositório legado (Dashboard)
 * e projeção unidirecional Master → SaaS (campos comerciais).
 */
class SyncedMasterTenantsService extends MasterTenantsService {
  constructor(
    private readonly registry: MasterRepositoryRegistry,
    private readonly resolveLicense: (tenantId: string) => Promise<import('../licenseManager/types.js').CompanyLicense | null>,
  ) {
    super(registry.tenantManagerStore);
  }

  private async project(tenant: ManagedTenant, required = false): Promise<void> {
    try {
      const license = await this.resolveLicense(tenant.id);
      await projectCommercialStateToSaas({ tenant, license }, { required });
    } catch (error) {
      // Alterações cadastrais continuam compatíveis. Bloqueio administrativo,
      // porém, só pode confirmar após bloquear a empresa operacional.
      if (required) throw error;
    }
  }

  override async create(input: CreateManagedTenantInput): Promise<ManagedTenant> {
    const tenant = await super.create(input);
    await syncManagedTenantToLegacy(this.registry.legacyRepos, tenant);
    await this.project(tenant);
    return tenant;
  }

  override async update(
    id: string,
    input: UpdateManagedTenantInput,
  ): Promise<ManagedTenant> {
    const tenant = await super.update(id, input);
    await syncManagedTenantToLegacy(this.registry.legacyRepos, tenant);
    await this.project(tenant);
    return tenant;
  }

  override async applyAction(
    id: string,
    action: MasterTenantAction,
    meta?: { reason?: string },
  ): Promise<ManagedTenant> {
    const before = await super.get(id);
    const tenant = await super.applyAction(id, action, meta);
    await syncManagedTenantToLegacy(this.registry.legacyRepos, tenant);
    try {
      await this.project(tenant, action === 'block');
    } catch (error) {
      // A projeção required é atômica no SaaS. Se ela falhar, restaura o
      // estado Master para não exibir um bloqueio que não foi aplicado.
      const restored = await this.registry.tenantManagerStore.save(before);
      await syncManagedTenantToLegacy(this.registry.legacyRepos, restored);
      throw error;
    }
    return tenant;
  }

  override async list(filter?: MasterTenantsListFilter): Promise<ManagedTenant[]> {
    return super.list(filter);
  }
}

export function createMasterComposition(
  registry: MasterRepositoryRegistry = getMasterRepositoryRegistry(),
): MasterComposition {
  const bridgingBilling = new BridgingBillingRepository(
    registry.billingStore,
    () => registry.billingProvider,
  );

  const masterServices = createMasterServices({
    ...registry.legacyRepos,
    billing: bridgingBilling,
  });
  // MasterTenantService legado encaminha para o oficial quando ligado.
  // (bind feito após tenantsService abaixo)

  const lifecycle = new SubscriptionLifecycleService(registry.subscriptionLifecycleRepo);
  const billingEngineLegacy = new BillingEngine(lifecycle);
  bindLegacyBillingChargesToStore(
    billingEngineLegacy,
    registry.billingStore,
    lifecycle,
    () => registry.billingProvider,
  );
  // Após hydrate do billing store, restaura charges no Map do engine legado.
  if (registry.persistence === 'postgres') {
    restoreLegacyChargesFromStore(billingEngineLegacy, registry.billingStore);
  }
  const billingEngine = new DecoupledBillingEngine({
    provider: registry.billingProvider,
    store: registry.billingStore,
  });
  const unifiedPayment = createUnifiedPaymentProvider(billingEngine);

  const licenseManager = new LicenseManagerService(registry.licenseManagerStore);
  const localLicense = new LocalLicenseManager(
    registry.localLicenseStore,
    undefined,
    licenseManager,
  );
  const tenantDeployments = new TenantDeploymentManager(registry.deploymentStore);
  const tenantsService = new SyncedMasterTenantsService(registry, async (tenantId) => {
    try {
      return await licenseManager.getByTenantId(tenantId);
    } catch {
      return null;
    }
  });
  masterServices.tenants.bindOfficial(tenantsService);

  const dashboard = createMasterDashboard({
    master: masterServices,
    lifecycle,
    billingEngine: billingEngineLegacy,
    paymentProvider: unifiedPayment.asLegacy(),
    webhookService: new WebhookService(),
    logs: registry.logs,
  });
  // KPIs de licenças: fonte oficial (License Manager / PG), não o espelho legado InMemory.
  bindDashboardLicensesToManager(dashboard, licenseManager);

  // Após mutações de licença, projeta o estado comercial no SaaS.
  const originalLicenseAction = licenseManager.action.bind(licenseManager);
  licenseManager.action = async (id, action, opts) => {
    const license = await originalLicenseAction(id, action, opts);
    try {
      if (action === 'delete') {
        const { markLicenseIntentionallyDeleted } = await import(
          '../license/licenseDeletionGuard.js'
        );
        await markLicenseIntentionallyDeleted(license.tenantId, license.id);
      }
      const tenant = await tenantsService.get(license.tenantId);
      await projectCommercialStateToSaas({
        tenant,
        license: action === 'delete' ? null : license,
      });
    } catch {
      // Tenant demo / sem empresa operacional — ok.
    }
    return license;
  };
  const originalLicenseCreate = licenseManager.create.bind(licenseManager);
  licenseManager.create = async (input) => {
    const { clearLicenseIntentionallyDeleted } = await import(
      '../license/licenseDeletionGuard.js'
    );
    await clearLicenseIntentionallyDeleted(String(input.tenantId || ''));
    const license = await originalLicenseCreate(input);
    try {
      const tenant = await tenantsService.get(license.tenantId);
      await projectCommercialStateToSaas({ tenant, license });
    } catch {
      // ignore
    }
    return license;
  };
  const originalLicenseUpdate = licenseManager.update.bind(licenseManager);
  licenseManager.update = async (id, input) => {
    const license = await originalLicenseUpdate(id, input);
    try {
      const tenant = await tenantsService.get(license.tenantId);
      await projectCommercialStateToSaas({ tenant, license });
    } catch {
      // ignore
    }
    return license;
  };
  const originalLicenseSetRules = licenseManager.setRules.bind(licenseManager);
  licenseManager.setRules = async (id, overrides) => {
    const license = await originalLicenseSetRules(id, overrides);
    try {
      const tenant = await tenantsService.get(license.tenantId);
      await projectCommercialStateToSaas({ tenant, license });
    } catch {
      // ignore
    }
    return license;
  };

  // Auth Master: PostgreSQL quando MASTER_PERSISTENCE=postgres (usuários e
  // sessões sobrevivem a restart); InMemory como default (testes / sem PG).
  const auth =
    registry.persistence === 'postgres'
      ? new MasterAuthService({
          users: new PgMasterUserStore(),
          sessions: new PgMasterSessionStore(),
          loginAttempts: new PgMasterLoginAttemptStore(),
        })
      : MasterAuthService.createInMemory();
  // Postgres: HybridSync desabilitado (sem backend memory). Memory: filas de teste.
  const hybridSync =
    registry.persistence === 'postgres' ? createDisabledHybridSync() : createHybridSync();

  // Mantém provider do registry alinhado ao engine oficial.
  const originalSetProvider = billingEngine.setProvider.bind(billingEngine);
  billingEngine.setProvider = async (name) => {
    registry.billingProvider = name;
    return originalSetProvider(name);
  };

  return {
    registry,
    masterServices,
    dashboard,
    tenantsService,
    lifecycle,
    billingEngineLegacy,
    billingEngine,
    licenseManager,
    localLicense,
    tenantDeployments,
    hybridSync,
    auth,
  };
}

export { getMasterRepositoryRegistry, resetMasterRepositoryRegistry };
