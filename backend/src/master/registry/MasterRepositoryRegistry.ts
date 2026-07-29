/**
 * MasterRepositoryRegistry — store único do Painel Master.
 *
 * Default: InMemory (testes).
 * Produção: MASTER_PERSISTENCE=postgres → adapters PostgreSQL.
 * Sem alterar APIs HTTP / telas / regras.
 */
import { createInMemoryMasterRepositories } from '../adapters/memory/createInMemoryMasterRepositories.js';
import type { MasterRepositories } from '../ports/repositories.js';
import { InMemoryTenantManagerStore } from '../tenantManager/adapters/InMemoryTenantManagerStore.js';
import type { TenantManagerStore } from '../tenantManager/ports/TenantManagerStore.js';
import { InMemorySubscriptionRepository } from '../subscriptions/subscription.repository.js';
import type { SubscriptionRepository as LifecycleSubscriptionRepository } from '../subscriptions/subscription.repository.js';
import { InMemoryBillingStore } from '../billingEngine/adapters/InMemoryBillingStore.js';
import { InMemoryLicenseManagerStore } from '../licenseManager/adapters/InMemoryLicenseManagerStore.js';
import type { LicenseManagerStore } from '../licenseManager/ports/LicenseManagerStore.js';
import { InMemoryLocalLicenseStore } from '../localLicense/adapters/InMemoryLocalLicenseStore.js';
import type { LocalLicenseStore } from '../localLicense/ports/LocalLicenseStore.js';
import { InMemoryTenantDeploymentStore } from '../deploymentManager/adapters/InMemoryTenantDeploymentStore.js';
import type { TenantDeploymentStore } from '../deploymentManager/ports/TenantDeploymentStore.js';
import { DashboardLogsModule } from '../dashboard/modules/logs.module.js';
import { AuditService } from '../api/services/audit.service.js';
import type {
  MasterAuditPage,
  MasterAuditQuery,
} from '../api/services/audit.service.js';
import type { BillingProviderName } from '../billingEngine/types.js';
import {
  MasterAuditRepository,
  MasterLicensesRepository,
  MasterLogsRepository,
  MasterSubscriptionsRepository,
  MasterTenantsRepository,
  PgBillingStore,
  PgLocalLicenseStore,
  PgTenantDeploymentStore,
  resolveMasterPersistenceMode,
  type MasterPersistenceMode,
} from '../adapters/postgres/index.js';

export type MasterLogsPort = Pick<
  DashboardLogsModule,
  'append' | 'list' | 'listByModule' | 'count' | 'clear'
>;

export type MasterAuditPort = {
  append: typeof AuditService.append;
  list: typeof AuditService.list;
  count: typeof AuditService.count;
  clear: typeof AuditService.clear;
  /** Consulta escalável (PG direto em postgres; memória caso contrário). */
  query: (query?: MasterAuditQuery) => Promise<MasterAuditPage>;
};

export type MasterRepositoryRegistrySnapshot = {
  persistence: MasterPersistenceMode | 'in_memory';
  stores: {
    legacyRepos: true;
    tenants: true;
    subscriptionsLifecycle: true;
    billing: true;
    licenses: true;
    localLicenses: true;
    deployments: true;
    logs: true;
    audit: true;
  };
  /** Backend físico de cada store (memory | postgres | disabled | compat_shim). */
  backends: {
    tenants: 'memory' | 'postgres';
    subscriptionsLifecycle: 'memory' | 'postgres';
    billing: 'memory' | 'postgres';
    licenses: 'memory' | 'postgres';
    logs: 'memory' | 'postgres';
    audit: 'memory' | 'postgres';
    localLicenses: 'memory' | 'postgres';
    deployments: 'memory' | 'postgres';
    /**
     * Espelho de compatibilidade do createMasterServices.
     * Em postgres: não é fonte da verdade (compat_shim). Leituras oficiais via TenantManager/PG.
     */
    legacyRepos: 'memory' | 'compat_shim';
    /** HybridSync: memory só em testes; disabled em postgres (sem backend memory). */
    hybridSync: 'memory' | 'disabled';
  };
};

/**
 * Registry compartilhado — uma instância por processo (ou por teste via reset).
 */
export class MasterRepositoryRegistry {
  readonly persistence: MasterPersistenceMode;
  readonly legacyRepos: MasterRepositories;
  readonly tenantManagerStore: TenantManagerStore;
  readonly subscriptionLifecycleRepo: LifecycleSubscriptionRepository;
  readonly billingStore: InMemoryBillingStore;
  readonly licenseManagerStore: LicenseManagerStore;
  readonly localLicenseStore: LocalLicenseStore;
  readonly deploymentStore: TenantDeploymentStore;
  readonly logs: MasterLogsPort;
  readonly audit: MasterAuditPort;
  readonly auditRepository: MasterAuditRepository | null;

  /** Provider ativo do Billing Engine oficial. */
  billingProvider: BillingProviderName = 'asaas';

  private constructor(persistence: MasterPersistenceMode) {
    this.persistence = persistence;
    this.legacyRepos = createInMemoryMasterRepositories();
    this.auditRepository = null;

    if (persistence === 'postgres') {
      this.tenantManagerStore = new MasterTenantsRepository();
      this.subscriptionLifecycleRepo = new MasterSubscriptionsRepository();
      this.licenseManagerStore = new MasterLicensesRepository();
      this.billingStore = new PgBillingStore();
      this.localLicenseStore = new PgLocalLicenseStore();
      this.deploymentStore = new PgTenantDeploymentStore();
      this.logs = new MasterLogsRepository();
      const auditRepo = new MasterAuditRepository();
      this.auditRepository = auditRepo;
      this.audit = {
        append: (input) => {
          const row = AuditService.append(input);
          // Dual-write INSERT-only (Fase 5.1 — master_audit append-only).
          void auditRepo.save(row).catch(() => undefined);
          return row;
        },
        list: (limit = 100) => auditRepo.list(limit),
        count: () => auditRepo.count(),
        // clear() só limpa o buffer InMemory (testes/restart).
        // Nunca DELETE/TRUNCATE em public.master_audit.
        clear: () => {
          AuditService.clear();
        },
        // Consulta escalável direto no PostgreSQL (sem buffer em memória).
        query: (query = {}) => auditRepo.query(query),
      };
    } else {
      this.tenantManagerStore = new InMemoryTenantManagerStore();
      this.subscriptionLifecycleRepo = new InMemorySubscriptionRepository();
      this.licenseManagerStore = new InMemoryLicenseManagerStore();
      this.billingStore = new InMemoryBillingStore();
      this.localLicenseStore = new InMemoryLocalLicenseStore();
      this.deploymentStore = new InMemoryTenantDeploymentStore();
      this.logs = new DashboardLogsModule();
      this.audit = {
        append: AuditService.append,
        list: AuditService.list,
        count: AuditService.count,
        clear: AuditService.clear,
        query: (query = {}) => Promise.resolve(AuditService.query(query)),
      };
    }
  }

  static create(
    persistence: MasterPersistenceMode = resolveMasterPersistenceMode(),
  ): MasterRepositoryRegistry {
    return new MasterRepositoryRegistry(persistence);
  }

  /** Hidrata stores PG (billing write-through + audit) após construção. */
  async hydrate(): Promise<void> {
    if (this.billingStore instanceof PgBillingStore) {
      await this.billingStore.hydrate();
    }
    if (this.auditRepository) {
      const rows = await this.auditRepository.list(2000);
      AuditService.restoreAll(rows);
    }
  }

  snapshot(): MasterRepositoryRegistrySnapshot {
    const pg = this.persistence === 'postgres';
    return {
      persistence: pg ? 'postgres' : 'in_memory',
      stores: {
        legacyRepos: true,
        tenants: true,
        subscriptionsLifecycle: true,
        billing: true,
        licenses: true,
        localLicenses: true,
        deployments: true,
        logs: true,
        audit: true,
      },
      backends: {
        tenants: pg ? 'postgres' : 'memory',
        subscriptionsLifecycle: pg ? 'postgres' : 'memory',
        billing: pg ? 'postgres' : 'memory',
        licenses: pg ? 'postgres' : 'memory',
        logs: pg ? 'postgres' : 'memory',
        audit: pg ? 'postgres' : 'memory',
        localLicenses: pg ? 'postgres' : 'memory',
        deployments: pg ? 'postgres' : 'memory',
        legacyRepos: pg ? 'compat_shim' : 'memory',
        hybridSync: pg ? 'disabled' : 'memory',
      },
    };
  }
}

let processRegistry: MasterRepositoryRegistry | null = null;

/** Obtém o registry do processo (singleton). */
export function getMasterRepositoryRegistry(): MasterRepositoryRegistry {
  if (!processRegistry) {
    processRegistry = MasterRepositoryRegistry.create();
  }
  return processRegistry;
}

/** Reset para testes — elimina estados paralelos entre suítes. */
export function resetMasterRepositoryRegistry(): void {
  processRegistry = null;
  AuditService.clear?.();
}
