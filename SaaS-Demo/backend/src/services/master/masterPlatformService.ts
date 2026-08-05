/**
 * Fachada da API Master — reutiliza backend/src/master/ via MasterRepositoryRegistry.
 * Persistência: memory (default) | postgres (MASTER_PERSISTENCE=postgres).
 * Sem alterar APIs operacionais.
 */
import {
  createMasterComposition,
  resetMasterRepositoryRegistry,
  type MasterComposition,
} from '../../master/registry/index.js';
import { syncManagedTenantToLegacy } from '../../master/registry/syncManagedTenantToLegacy.js';
import type { MasterDashboardService } from '../../master/dashboard/MasterDashboardService.js';
import type { MasterTenantsService } from '../../master/tenants/MasterTenantsService.js';
import type { TenantManager } from '../../master/tenantManager/TenantManager.js';
import type { HybridSyncServices } from '../../master/hybridSync/createHybridSync.js';
import type { LocalLicenseManager } from '../../master/localLicense/LocalLicenseManager.js';
import type { MasterAuthService } from '../../master/auth/MasterAuthService.js';
import type { DecoupledBillingEngine } from '../../master/billingEngine/index.js';
import type { LicenseManagerService } from '../../master/licenseManager/index.js';
import type { TenantDeploymentManager } from '../../master/deploymentManager/index.js';
import { assertPlatformLayerReady } from '../../platform/assertReady.js';
import { DeploymentManager } from '../../platform/deploymentManager.js';
import { PlatformService } from '../../platform/PlatformService.js';
import {
  SubscriptionFinanceService,
  startSubscriptionFinanceAutomation,
} from '../../master/subscriptionFinance/index.js';

export type MasterApiContext = {
  composition: MasterComposition;
  dashboard: MasterDashboardService;
  /** Service canônico de empresas Master (adapters). */
  tenantsService: MasterTenantsService;
  hybridSync: HybridSyncServices;
  localLicense: LocalLicenseManager;
  auth: MasterAuthService;
  /** Billing Engine oficial — DecoupledBillingEngine. */
  billingEngine: DecoupledBillingEngine;
  /** License Manager comercial por empresa (PG quando MASTER_PERSISTENCE=postgres). */
  licenseManager: LicenseManagerService;
  /** Deployment Manager por tenant (PG quando MASTER_PERSISTENCE=postgres). */
  tenantDeployments: TenantDeploymentManager;
};

let ctx: MasterApiContext | null = null;

export function getMasterApiContext(): MasterApiContext {
  if (!ctx) {
    const composition = createMasterComposition();
    ctx = {
      composition,
      dashboard: composition.dashboard,
      tenantsService: composition.tenantsService,
      hybridSync: composition.hybridSync,
      localLicense: composition.localLicense,
      auth: composition.auth,
      billingEngine: composition.billingEngine,
      licenseManager: composition.licenseManager,
      tenantDeployments: composition.tenantDeployments,
    };
    void composition.auth.ensureBootstrapOwner();
    void (async () => {
      await composition.registry.hydrate();
      const persistence = composition.registry.persistence;
      // Restaura cobranças legadas (chg_*) a partir das invoices PG após hydrate.
      if (persistence === 'postgres') {
        const { restoreLegacyChargesFromStore } = await import(
          '../../master/registry/bindLegacyBillingCharges.js'
        );
        restoreLegacyChargesFromStore(
          composition.billingEngineLegacy,
          composition.registry.billingStore,
        );
      }
      // Espelha tenants oficiais → legado em memória (dashboard customers/tenants após restart).
      if (persistence === 'postgres') {
        try {
          const tenants = await composition.tenantsService.list();
          for (const tenant of tenants) {
            await syncManagedTenantToLegacy(composition.registry.legacyRepos, tenant);
          }
        } catch {
          /* best-effort mirror */
        }
        const snap = composition.registry.snapshot();
        const memoryBackends = Object.entries(snap.backends)
          .filter(([, v]) => v === 'memory')
          .map(([k]) => k);
        if (memoryBackends.length > 0) {
          console.warn(
            `[master] MASTER_PERSISTENCE=postgres com backends ainda em memória: ${memoryBackends.join(', ')}`,
          );
        } else {
          console.info(
            `[master] Control Plane backends: ${JSON.stringify(snap.backends)}`,
          );
        }
      }
      // Seeds demo: memory only + flags explícitas. Nunca no funcionamento normal.
      if (persistence === 'memory') {
        if (String(process.env.MASTER_BILLING_DEMO_SEED || '').toLowerCase() === 'true') {
          await seedBillingDemo(composition.billingEngine);
        }
        if (String(process.env.MASTER_LICENSE_DEMO_SEED || '').toLowerCase() === 'true') {
          await composition.licenseManager.ensureSeed({ force: true });
        }
        if (String(process.env.MASTER_DEPLOYMENT_DEMO_SEED || '').toLowerCase() === 'true') {
          await composition.tenantDeployments.ensureSeed({ force: true });
        }
      } else if (
        String(process.env.MASTER_FINANCE_AUTOMATION_ENABLED || 'true').toLowerCase() !== 'false'
      ) {
        startSubscriptionFinanceAutomation({
          finance: new SubscriptionFinanceService(),
          tenants: composition.tenantsService,
          audit: composition.registry.audit,
        });
      }
    })();
  }
  return ctx;
}

/** Demo InMemory — sem gateway externo. */
async function seedBillingDemo(engine: DecoupledBillingEngine): Promise<void> {
  try {
    const inv = await engine.createInvoice({
      description: 'Mensalidade PRO — demo',
      amountCents: 19900,
      tenantId: 'tn_demo',
    });
    await engine.createPix({
      amountCents: 19900,
      description: 'PIX demo mensalidade',
      invoiceId: inv.id,
    });
    await engine.createPayment({
      amountCents: 9900,
      method: 'boleto',
      description: 'Pagamento boleto demo',
    });
  } catch {
    /* seed best-effort */
  }
}

export function getMasterAuthService(): MasterAuthService {
  return getMasterApiContext().auth;
}

/** Reset para testes — limpa registry + contexto. */
export function resetMasterApiContext(): void {
  ctx = null;
  resetMasterRepositoryRegistry();
}

export const MasterPlatformService = {
  getDashboard() {
    return getMasterApiContext().dashboard;
  },

  /** Compat: TenantManager subjacente (oficial via MasterTenantsService). */
  getTenants(): TenantManager {
    return getMasterApiContext().tenantsService.getManager();
  },

  getTenantsService(): MasterTenantsService {
    return getMasterApiContext().tenantsService;
  },

  getHybridSync() {
    return getMasterApiContext().hybridSync;
  },

  getLocalLicense() {
    return getMasterApiContext().localLicense;
  },

  getAuth() {
    return getMasterApiContext().auth;
  },

  /** Implementação oficial de Billing. */
  getBillingEngine(): DecoupledBillingEngine {
    return getMasterApiContext().billingEngine;
  },

  /**
   * @deprecated Use getBillingEngine() — BillingEngine legado (state machine).
   * Mantido para ChargesModule / compat.
   */
  getBillingEngineLegacy() {
    return getMasterApiContext().composition.billingEngineLegacy;
  },

  getLicenseManager(): LicenseManagerService {
    return getMasterApiContext().licenseManager;
  },

  getTenantDeployments(): TenantDeploymentManager {
    return getMasterApiContext().tenantDeployments;
  },

  getLifecycle() {
    return getMasterApiContext().composition.lifecycle;
  },

  getAudit() {
    return getMasterApiContext().composition.registry.audit;
  },

  getPersistence() {
    return getMasterApiContext().composition.registry.persistence;
  },

  async getSystemSnapshot() {
    let platform: ReturnType<typeof assertPlatformLayerReady> | null = null;
    try {
      platform = assertPlatformLayerReady();
    } catch {
      platform = null;
    }
    return {
      ok: true,
      platform: platform
        ? {
            mode: platform.mode,
            licensed: platform.licensed,
            multiTenant: platform.multiTenant,
          }
        : {
            mode: DeploymentManager.getMode(),
            licensed: PlatformService.isLicenseValid(),
            multiTenant: PlatformService.canUseFeature('multiTenant'),
          },
      deployment: DeploymentManager.getIdentity(),
      master: {
        modules: getMasterApiContext().dashboard.listModules(),
        summary: await getMasterApiContext().dashboard.getSummary(),
      },
      auth: {
        separateFromCompanyLogin: true,
        roles: [
          'MASTER_OWNER',
          'MASTER_ADMIN',
          'MASTER_SUPPORT',
          'MASTER_FINANCE',
          'MASTER_AUDITOR',
        ],
      },
      chargingEnabled: false,
      persistence:
        getMasterApiContext().composition.registry.persistence === 'postgres'
          ? 'postgres'
          : 'in_memory',
      registry: getMasterApiContext().composition.registry.snapshot(),
      note: 'master_api_infrastructure_only',
    };
  },
};
