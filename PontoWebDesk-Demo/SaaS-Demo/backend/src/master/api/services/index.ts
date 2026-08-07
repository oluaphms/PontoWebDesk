/**
 * Serviços HTTP da API Master — fachadas sobre MasterPlatformService / Platform.
 * Não alteram REP / ponto / espelho / banco de horas / auth das empresas.
 */
import type { Request } from 'express';
import { DeploymentManager } from '../../../platform/deploymentManager.js';
import { MasterPlatformService } from '../../../services/master/masterPlatformService.js';
import type { MasterRole } from '../../auth/masterAuth.types.js';
import type { MasterTenantsService } from '../../tenants/MasterTenantsService.js';
import { enrichExecutiveSummary } from '../../dashboard/executiveEnrichment.js';
import {
  enrichMasterAuditInput,
  type MasterAuditQuery,
  type MasterAuditRequestInput,
} from './audit.service.js';
import type { MasterApiRequest } from '../middlewares/requireMasterLogin.js';

/** Label de persistência do control plane (memory default | postgres opt-in). */
function masterPersistenceLabel(): 'postgres' | 'in_memory' {
  return MasterPlatformService.getPersistence() === 'postgres' ? 'postgres' : 'in_memory';
}

export const MasterApiServices = {
  auth() {
    return MasterPlatformService.getAuth();
  },

  dashboard() {
    return MasterPlatformService.getDashboard();
  },

  tenants() {
    return MasterPlatformService.getTenants();
  },

  tenantsService() {
    return MasterPlatformService.getTenantsService();
  },

  localLicense() {
    return MasterPlatformService.getLocalLicense();
  },

  hybrid() {
    return MasterPlatformService.getHybridSync();
  },

  get audit() {
    return MasterPlatformService.getAudit();
  },

  /**
   * Auditoria HTTP Master (Fase 5): quem, quando, IP, navegador,
   * empresa, ação, antes e depois — via dual-write memory/postgres.
   */
  recordAudit(
    req: MasterApiRequest | Request | null | undefined,
    input: MasterAuditRequestInput,
  ) {
    return this.audit.append(enrichMasterAuditInput(req, input));
  },

  async getDashboard() {
    const dashboard = this.dashboard();
    const core = await dashboard.getDashboardCore();
    const executive = await this.composeExecutive(core.executive, {
      invoices: core.invoices,
    });
    return {
      ok: true,
      modules: dashboard.listModules(),
      summary: core.summary,
      executive,
    };
  },

  /** Resumo comercial/executivo — subset do dashboard, endpoint dedicado. */
  async getSummary() {
    const dashboard = this.dashboard();
    const [summary, executiveBase] = await Promise.all([
      dashboard.getSummary(),
      dashboard.getExecutive(),
    ]);
    const executive = await this.composeExecutive(executiveBase);
    return {
      ok: true,
      summary,
      executive,
      modules: dashboard.listModules().map((m) => m.id),
      persistence: masterPersistenceLabel(),
      note: 'Master summary only — sem dados operacionais de ponto/REP',
    };
  },

  /** Composição somente-leitura sobre fontes Master já existentes. */
  async composeExecutive(
    base: import('../../dashboard/dashboard.types.js').MasterExecutiveSummary,
    options?: {
      invoices?: Array<{
        status: string;
        amountCents: number;
        paidAt?: string | null;
        issuedAt?: string;
        dueAt?: string | null;
        tenantId?: string | null;
        customerId?: string | null;
      }>;
      payments?: Array<{
        status: string;
        amountCents: number;
        paidAt?: string | null;
        createdAt?: string;
        dueAt?: string | null;
        id?: string;
      }>;
    },
  ) {
    let hybridCounts: {
      unresolvedConflicts: number;
      syncPending: number;
      offlinePending: number;
    } | null = null;
    try {
      // Evita getHealth() → getSummary() duplicado; só contagens híbridas.
      const hybrid = this.getHybrid();
      hybridCounts = {
        unresolvedConflicts: Number(hybrid.sync.counts.unresolvedConflicts ?? 0),
        syncPending: Number(hybrid.sync.counts.sync ?? 0),
        offlinePending: Number(hybrid.sync.counts.offline ?? 0),
      };
    } catch {
      hybridCounts = null;
    }

    let invoices = options?.invoices;
    if (!invoices) {
      try {
        invoices = await this.dashboard().charges.listInvoices();
      } catch {
        invoices = [];
      }
    }

    let payments: Array<{
      status: string;
      amountCents: number;
      paidAt?: string | null;
      createdAt?: string;
      dueAt?: string | null;
      id?: string;
      invoiceId?: string | null;
    }> = options?.payments ?? [];
    if (!options?.payments) {
      try {
        const enginePayments = await MasterPlatformService.getBillingEngine().listPayments();
        payments = enginePayments.map((p) => ({
          id: p.id,
          status: p.status,
          amountCents: p.amountCents,
          paidAt: p.paidAt ?? null,
          createdAt: p.createdAt,
          dueAt: null,
          invoiceId: p.invoiceId ?? null,
        }));
      } catch {
        payments = [];
      }
    }

    let lifecycle: import('../../subscriptions/subscription.service.js').SubscriptionService | null =
      null;
    try {
      lifecycle = this.dashboard().subscriptions.getService();
    } catch {
      lifecycle = null;
    }

    let tenantsService: MasterTenantsService | null = null;
    try {
      tenantsService = this.tenantsService();
    } catch {
      tenantsService = null;
    }

    let licenseManager = null;
    try {
      licenseManager = MasterPlatformService.getLicenseManager();
    } catch {
      licenseManager = null;
    }

    return enrichExecutiveSummary({
      base,
      tenantsService,
      licenseManager,
      lifecycle,
      invoices,
      payments,
      hybridCounts,
      persistence: masterPersistenceLabel(),
    });
  },

  /** Logs do dashboard + trilha de auditoria HTTP Master (fontes distintas). */
  async getLogs(limit = 100) {
    const safeLimit = Number.isFinite(limit) ? Math.min(Math.max(1, Math.floor(limit)), 500) : 100;
    const dashboard = this.dashboard();
    const [logs, logCount, auditPage] = await Promise.all([
      dashboard.logs.list(safeLimit),
      dashboard.logs.count(),
      this.audit.query({ limit: safeLimit, order: 'desc' }),
    ]);
    const audit = auditPage.rows;
    return {
      ok: true,
      logs,
      audit,
      counts: {
        logs: logCount,
        audit: auditPage.total,
        returnedLogs: logs.length,
        returnedAudit: audit.length,
      },
      persistence: masterPersistenceLabel(),
      note: 'logs = módulos Master; audit = ações HTTP Master',
    };
  },

  /** Health exclusivo Master — não substitui /api/health operacional. */
  async getHealth() {
    const system = await this.getSystem();
    const hybrid = this.getHybrid();
    const dashboard = this.dashboard();
    const billing = MasterPlatformService.getBillingEngine();
    const [summary, logCount, billingSnapshot] = await Promise.all([
      dashboard.getSummary(),
      dashboard.logs.count(),
      billing.snapshot(),
    ]);
    const syncPending = hybrid.sync.counts.sync;
    const offlinePending = hybrid.sync.counts.offline;
    const unresolvedConflicts = hybrid.sync.counts.unresolvedConflicts;
    const gatewayActive = dashboard.gateway.getActive()?.name ?? null;

    return {
      ok: true,
      tokenType: 'master',
      separateFromOperationalHealth: true,
      health: {
        ok: true,
        platformReady: Boolean(system.platform),
        licensed: Boolean(system.platform?.licensed ?? system.deployment?.license?.licensed),
        mode: system.deployment?.mode ?? null,
        environment: system.deployment?.environment ?? null,
        chargingEnabled: false,
        gatewayActive,
        billingProvider: billingSnapshot.provider,
        billingExternalReady: Boolean(billingSnapshot.externalReady),
        syncPending,
        offlinePending,
        unresolvedConflicts,
        checkedAt: new Date().toISOString(),
      },
      monitoring: {
        masterModules: summary.counts,
        logCount,
        syncQueueSize: syncPending,
        offlineQueueSize: offlinePending,
        conflictsOpen: unresolvedConflicts,
      },
      persistence: masterPersistenceLabel(),
      note: 'Health do Painel Master — isolado de /api/health das empresas',
    };
  },

  async getTenants(filter?: {
    q?: string;
    plan?: string;
    mode?: string;
    status?: string;
  }) {
    // Fonte da verdade: MasterTenantsService / PostgreSQL (não legacyRepos).
    const managed = await this.tenantsService().list(filter);
    const { enrichTenantsWithLicenseValidity } = await import(
      '../../license/enrichWithCommercialValidity.js'
    );
    const tenants = await enrichTenantsWithLicenseValidity(managed);
    return {
      ok: true,
      tenants,
      count: tenants.length,
      persistence: masterPersistenceLabel(),
      adapter:
        masterPersistenceLabel() === 'postgres'
          ? 'MasterTenantsRepository'
          : 'InMemoryTenantManagerStore',
    };
  },

  async getTenant(id: string) {
    const tenant = await this.tenantsService().get(id);
    const { enrichTenantWithLicenseValidity } = await import(
      '../../license/enrichWithCommercialValidity.js'
    );
    const enriched = await enrichTenantWithLicenseValidity(tenant);
    return { ok: true, tenant: enriched, persistence: masterPersistenceLabel() };
  },

  async createTenant(input: Parameters<MasterTenantsService['create']>[0], actor?: {
    userId?: string | null;
    email?: string | null;
    role?: string | null;
    ip?: string | null;
    userAgent?: string | null;
  }) {
    const { MasterCompanyProvisioningService } = await import(
      '../../provisioning/MasterCompanyProvisioningService.js'
    );
    const provisioned = await MasterCompanyProvisioningService.createFullyProvisioned(
      input,
      actor,
    );
    const { enrichTenantWithLicenseValidity } = await import(
      '../../license/enrichWithCommercialValidity.js'
    );
    const tenant = await enrichTenantWithLicenseValidity(provisioned.tenant);
    return {
      ok: true,
      tenant,
      provision: {
        provisionCorrelationId: provisioned.provisionCorrelationId,
        operationalCompanyId: provisioned.operationalCompanyId,
        provisioned: provisioned.provisioned,
        journeyState: provisioned.journeyState,
        subscriptionId: provisioned.subscriptionId,
        licenseId: provisioned.licenseId,
        crmInitialized: provisioned.crmInitialized,
        notificationsInitialized: provisioned.notificationsInitialized,
        financeEntryId: provisioned.financeEntryId,
        adminProvisioned: provisioned.adminProvisioned,
        message: provisioned.message,
      },
    };
  },

  async updateTenant(id: string, input: Parameters<MasterTenantsService['update']>[1]) {
    const before = await this.tenantsService().get(id);
    const updated = await this.tenantsService().update(id, input);
    const { enrichTenantWithLicenseValidity } = await import(
      '../../license/enrichWithCommercialValidity.js'
    );
    const tenant = await enrichTenantWithLicenseValidity(updated);
    return {
      ok: true,
      tenant,
      before: {
        id: before.id,
        status: before.status,
        plan: before.plan,
        mode: before.mode,
        installationType: before.installationType,
        company: before.company,
      },
    };
  },

  async tenantAction(
    id: string,
    action: Parameters<MasterTenantsService['applyAction']>[1],
    reason?: string,
  ) {
    const before = await this.tenantsService().get(id);
    const applied = await this.tenantsService().applyAction(id, action, { reason });
    const { enrichTenantWithLicenseValidity } = await import(
      '../../license/enrichWithCommercialValidity.js'
    );
    const tenant = await enrichTenantWithLicenseValidity(applied);
    return {
      ok: true,
      tenant,
      action,
      before: {
        id: before.id,
        status: before.status,
        operationalCompanyId: before.operationalCompanyId ?? null,
        companyName: before.company.name,
      },
      after: {
        id: tenant.id,
        status: tenant.status,
        operationalCompanyId: tenant.operationalCompanyId ?? null,
        companyName: tenant.company.name,
        reason: reason || null,
      },
    };
  },

  async deleteTenant(
    id: string,
    actor?: {
      userId?: string | null;
      email?: string | null;
      role?: string | null;
      ip?: string | null;
      userAgent?: string | null;
    },
  ) {
    const before = await this.tenantsService().get(id);
    const { MasterCompanyProvisioningService } = await import(
      '../../provisioning/MasterCompanyProvisioningService.js'
    );
    const purged = await MasterCompanyProvisioningService.purgeFullyProvisioned(id, actor);
    return {
      ok: true,
      deleted: true,
      tenantId: purged.tenantId,
      operationalCompanyId: purged.operationalCompanyId,
      companyName: purged.companyName,
      before: {
        id: before.id,
        status: before.status,
        plan: before.plan,
        mode: before.mode,
        operationalCompanyId: before.operationalCompanyId ?? null,
        company: before.company,
      },
    };
  },

  async getLicenses() {
    const mgr = MasterPlatformService.getLicenseManager();
    const [rawLicenses, snapshot, cloudLicenses, localLicenses] = await Promise.all([
      mgr.list(),
      mgr.snapshot(),
      this.dashboard().licenses.list(),
      this.localLicense().list(),
    ]);
    const { ensureCompanyLicenseValidity } = await import(
      '../../license/enrichWithCommercialValidity.js'
    );
    const companyLicenses = rawLicenses.map(ensureCompanyLicenseValidity);
    return {
      ok: true,
      companyLicenses,
      licenses: companyLicenses,
      count: companyLicenses.length,
      snapshot,
      cloudLicenses,
      localLicenses,
      localCount: localLicenses.length,
      persistence: masterPersistenceLabel(),
      operationalAuthWired: false,
      note: 'License Manager — regras Master only; autenticação operacional intacta',
    };
  },

  async getSubscriptions() {
    const [rows, tenants] = await Promise.all([
      this.dashboard().subscriptions.list(),
      this.tenants().list(),
    ]);
    const { MasterSubscriptionsService } = await import(
      '../../subscriptions/MasterSubscriptionsService.js'
    );
    const helper = new MasterSubscriptionsService();
    const nameByTenant = new Map(tenants.map((t) => [t.id, t.company.name] as const));
    const subscriptions = rows.map((s) =>
      helper.toCommercialView(s, nameByTenant.get(s.tenantId) ?? s.tenantId),
    );
    return {
      ok: true,
      subscriptions,
      count: subscriptions.length,
      gatewayIntegrated: false,
      paymentIntegrated: false,
      note: 'architecture_only_no_payment',
    };
  },

  async getPayments() {
    const { SubscriptionFinanceService } = await import(
      '../../subscriptionFinance/SubscriptionFinanceService.js'
    );
    const finance = new SubscriptionFinanceService();
    const entries = await finance.listAllPayments(5000);
    const payments = entries
      .filter((e) => e.status === 'PAID')
      .map((e) => ({
        id: e.id,
        status: 'paid',
        amountCents: e.amountCents || 0,
        currency: e.currency || 'BRL',
        paidAt: e.paidAt,
        createdAt: e.createdAt,
        tenantId: e.tenantId,
        subscriptionId: e.subscriptionId,
        description: e.description,
      }));
    return {
      ok: true,
      provider: 'subscription_finance',
      payments,
      refunds: [],
      gateway: this.dashboard().gateway.list(),
      count: payments.length,
      persistence: masterPersistenceLabel(),
      note: 'SoT: master_subscription_finance_entries (PAID)',
    };
  },

  async getDeployments() {
    const identity = DeploymentManager.getIdentity();
    const mgr = MasterPlatformService.getTenantDeployments();
    const [tenants, snapshot] = await Promise.all([mgr.list(), mgr.snapshot()]);
    return {
      ok: true,
      deployment: identity,
      mode: identity.mode,
      environment: identity.environment,
      provider: identity.provider,
      sync: identity.sync,
      license: identity.license,
      tenants,
      deployments: tenants,
      count: tenants.length,
      snapshot,
      persistence: masterPersistenceLabel(),
      platformRuntimeWired: false,
      note: 'TenantDeploymentManager + Platform DeploymentManager (somente leitura do runtime)',
    };
  },

  getHybrid() {
    const hybrid = this.hybrid();
    const syncQueue = hybrid.syncQueue.list();
    const offlineQueue = hybrid.offlineQueue.list();
    const conflicts = hybrid.conflicts.list(false);
    const persistence = masterPersistenceLabel();
    return {
      ok: true,
      sync: {
        queue: syncQueue,
        offline: offlineQueue,
        conflicts,
        counts: {
          sync: syncQueue.length,
          offline: offlineQueue.length,
          conflicts: conflicts.length,
          unresolvedConflicts: conflicts.filter((c) => !c.resolved).length,
        },
      },
      persistence: persistence === 'postgres' ? 'disabled' : 'in_memory',
      note:
        persistence === 'postgres'
          ? 'HybridSync desabilitado com MASTER_PERSISTENCE=postgres (sem backend memory)'
          : 'HybridSync InMemory — apenas testes / memory mode',
    };
  },

  async getSystem() {
    return MasterPlatformService.getSystemSnapshot();
  },

  async getAudit(limit = 100) {
    const [audit, count] = await Promise.all([
      Promise.resolve(this.audit.list(limit)),
      Promise.resolve(this.audit.count()),
    ]);
    return {
      ok: true,
      audit,
      count,
      persistence: masterPersistenceLabel(),
    };
  },

  /**
   * Consulta escalável da auditoria (Fase 5.2) — filtros server-side,
   * paginação (offset/cursor) e ordenação, direto no PostgreSQL quando
   * MASTER_PERSISTENCE=postgres. Mantém `audit` + `count` por compatibilidade.
   */
  async queryAudit(query: MasterAuditQuery = {}) {
    const page = await this.audit.query(query);
    return {
      ok: true,
      audit: page.rows,
      count: page.total,
      pagination: {
        total: page.total,
        limit: page.limit,
        offset: page.offset,
        order: page.order,
        nextCursor: page.nextCursor,
        hasMore: page.hasMore,
      },
      persistence: masterPersistenceLabel(),
    };
  },

  async listUsers() {
    const users = await this.auth().listUsers();
    return {
      ok: true,
      users,
      count: users.length,
      tokenType: 'master',
      permissionModel: 'role_based',
      mfaSupported: false,
      note: 'Usuários Master — JWT separado (MASTER_JWT_SECRET)',
    };
  },

  async createUser(input: {
    email: string;
    name: string;
    password: string;
    role: MasterRole;
  }) {
    const user = await this.auth().createUser(input);
    // Auditoria HTTP completa fica no controller.
    return { ok: true, user };
  },

  async updateUser(
    id: string,
    input: { name?: string; role?: MasterRole; active?: boolean },
    actor?: { id?: string | null; isFounder?: boolean },
  ) {
    const user = await this.auth().updateUser(id, input, actor);
    return { ok: true, user };
  },

  async resetUserPassword(
    id: string,
    newPassword: string,
    actor?: { id?: string | null; isFounder?: boolean },
  ) {
    const user = await this.auth().resetUserPassword(id, newPassword, actor);
    return { ok: true, user };
  },
};
