/**
 * MasterDashboardService — fachada dos módulos do Painel Master.
 * Backend only. Sem frontend. Sem rotas Express nesta fase.
 */
import type { MasterServices } from '../createMasterServices.js';
import type { BillingEngine } from '../billing/BillingEngine.js';
import type { SubscriptionService as SubscriptionLifecycleService } from '../subscriptions/subscription.service.js';
import type { PaymentProvider } from '../payments/ports/PaymentProvider.js';
import type { WebhookService } from '../payments/WebhookService.js';
import {
  MASTER_DASHBOARD_MODULES,
  type MasterDashboardSummary,
  type MasterExecutiveSummary,
} from './dashboard.types.js';
import { CustomersModule } from './modules/customers.module.js';
import { SubscriptionsModule } from './modules/subscriptions.module.js';
import { LicensesModule } from './modules/licenses.module.js';
import { ChargesModule } from './modules/charges.module.js';
import { PaymentsModule } from './modules/payments.module.js';
import { PlansModule } from './modules/plans.module.js';
import { GatewayModule } from './modules/gateway.module.js';
import { DashboardLogsModule } from './modules/logs.module.js';

export type MasterDashboardDeps = {
  master: MasterServices;
  lifecycle: SubscriptionLifecycleService;
  billingEngine: BillingEngine;
  paymentProvider: PaymentProvider;
  webhookService: WebhookService;
  logs?: DashboardLogsModule;
};

export class MasterDashboardService {
  readonly customers: CustomersModule;
  readonly subscriptions: SubscriptionsModule;
  readonly licenses: LicensesModule;
  readonly charges: ChargesModule;
  readonly payments: PaymentsModule;
  readonly plans: PlansModule;
  readonly gateway: GatewayModule;
  readonly logs: DashboardLogsModule;

  private readonly master: MasterServices;

  constructor(deps: MasterDashboardDeps) {
    this.master = deps.master;
    this.logs = deps.logs ?? new DashboardLogsModule();
    this.customers = new CustomersModule(deps.master.customers, this.logs);
    this.subscriptions = new SubscriptionsModule(deps.lifecycle, this.logs);
    this.licenses = new LicensesModule(deps.master.licenses, deps.master.activation, this.logs);
    this.charges = new ChargesModule(deps.billingEngine, deps.master.billing, this.logs);
    this.payments = new PaymentsModule(deps.paymentProvider, deps.webhookService, this.logs);
    this.plans = new PlansModule();
    this.gateway = new GatewayModule(deps.paymentProvider);
  }

  listModules() {
    return MASTER_DASHBOARD_MODULES;
  }

  /** Acesso aos serviços Master brutos (tenants, block, etc.). */
  getMasterServices(): MasterServices {
    return this.master;
  }

  async getSummary(): Promise<MasterDashboardSummary> {
    const subscriptionIds = (await this.subscriptions.list()).map((s) => s.id);
    const [customers, tenants, subscriptions, licenses, invoices, charges, payments, logs] =
      await Promise.all([
        this.customers.count(),
        this.master.tenants.list().then((t) => t.length),
        this.subscriptions.count(),
        this.licenses.count(),
        this.charges.countInvoices(),
        this.charges.countOpenCharges(subscriptionIds),
        this.payments.count(),
        this.logs.count(),
      ]);

    return {
      modules: MASTER_DASHBOARD_MODULES,
      counts: {
        customers,
        tenants,
        subscriptions,
        licenses,
        invoices,
        charges,
        payments,
        plans: this.plans.count(),
        gateways: this.gateway.count(),
        logs,
      },
    };
  }

  /**
   * Snapshot único para GET /dashboard — evita listagens duplicadas entre
   * getSummary + getExecutive no mesmo request.
   */
  async getDashboardCore(): Promise<{
    summary: MasterDashboardSummary;
    executive: MasterExecutiveSummary;
    invoices: Awaited<ReturnType<ChargesModule['listInvoices']>>;
  }> {
    const [tenants, customers, subscriptions, licenseRows, invoices, payments, logs] =
      await Promise.all([
        this.master.tenants.list(),
        this.customers.list(),
        this.subscriptions.list(),
        this.licenses.list(),
        this.charges.listInvoices(),
        this.payments.listPayments(),
        this.logs.count(),
      ]);

    const subscriptionIds = subscriptions.map((s) => s.id);
    const openCharges = await this.charges.countOpenCharges(subscriptionIds);

    const summary: MasterDashboardSummary = {
      modules: MASTER_DASHBOARD_MODULES,
      counts: {
        customers: customers.length,
        tenants: tenants.length,
        subscriptions: subscriptions.length,
        licenses: licenseRows.length,
        invoices: invoices.length,
        charges: openCharges,
        payments: payments.length,
        plans: this.plans.count(),
        gateways: this.gateway.count(),
        logs,
      },
    };

    const executive = this.buildExecutiveFromLists({
      tenants,
      customers,
      subscriptions,
      licenseRows,
      invoices,
      payments,
    });

    return { summary, executive, invoices };
  }

  private buildExecutiveFromLists(input: {
    tenants: Array<{
      deploymentMode?: string;
      status?: string;
    }>;
    customers: unknown[];
    subscriptions: Array<{ nextBilling?: string | null; expiresAt?: string | null }>;
    licenseRows: Array<{ revokedAt?: string | null; expiresAt?: string | null }>;
    invoices: Array<{
      id: string;
      status: string;
      amountCents: number;
      paidAt?: string | null;
      issuedAt: string;
    }>;
    payments: Array<{
      id: string;
      description?: string | null;
      amountCents: number;
      status: string;
      method: string;
      paidAt?: string | null;
      createdAt: string;
    }>;
  }): MasterExecutiveSummary {
    const { tenants, customers, subscriptions, licenseRows, invoices, payments } = input;

    let modeLocal = 0;
    let modeSaas = 0;
    let modeHybrid = 0;
    let companiesActive = 0;
    let companiesBlocked = 0;
    for (const t of tenants) {
      if (t.deploymentMode === 'LOCAL') modeLocal += 1;
      else if (t.deploymentMode === 'HYBRID') modeHybrid += 1;
      else modeSaas += 1;
      if (t.status === 'active') companiesActive += 1;
      if (t.status === 'blocked' || t.status === 'suspended') companiesBlocked += 1;
    }

    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    const in30d = now + 30 * dayMs;
    const monthAgo = now - 30 * dayMs;
    const yearAgo = now - 365 * dayMs;

    const activeLicenses = licenseRows.filter((l) => !l.revokedAt);
    const licensesExpiring = activeLicenses.filter((l) => {
      if (!l.expiresAt) return false;
      const exp = Date.parse(l.expiresAt);
      return Number.isFinite(exp) && exp >= now && exp <= in30d;
    }).length;

    const renewalsDue = 0; // Calculado em enrichExecutiveSummary (cobranças + licenças reais).

    const paidInvoices = invoices.filter((inv) => inv.status === 'paid');
    const revenueCents = paidInvoices.reduce((sum, inv) => sum + (inv.amountCents || 0), 0);
    const monthlyRevenueCents = paidInvoices
      .filter((inv) => {
        const at = Date.parse(inv.paidAt || inv.issuedAt);
        return Number.isFinite(at) && at >= monthAgo;
      })
      .reduce((sum, inv) => sum + (inv.amountCents || 0), 0);
    const annualRevenueCents = paidInvoices
      .filter((inv) => {
        const at = Date.parse(inv.paidAt || inv.issuedAt);
        return Number.isFinite(at) && at >= yearAgo;
      })
      .reduce((sum, inv) => sum + (inv.amountCents || 0), 0);

    const pixPending = payments.filter((p) => p.status === 'pending' && p.method === 'pix').length;

    const recentFromPayments = payments.slice(0, 8).map((p) => ({
      id: p.id,
      label: p.description || `PIX ${p.id.slice(0, 8)}`,
      amountCents: p.amountCents,
      status: p.status,
      method: p.method,
      at: p.paidAt || p.createdAt,
    }));
    const recentPayments = recentFromPayments
      .slice()
      .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
      .slice(0, 8);

    const activeGateway = this.gateway.getActive();

    return {
      companies: tenants.length,
      companiesActive,
      companiesBlocked,
      companiesTrial: 0,
      users: customers.length,
      subscriptions: subscriptions.length,
      licenses: activeLicenses.length,
      licensesActive: activeLicenses.length,
      licensesExpired: licenseRows.filter((l) => {
        if (!l.expiresAt) return false;
        const exp = Date.parse(l.expiresAt);
        return Number.isFinite(exp) && exp < now;
      }).length,
      licensesTrial: 0,
      licensesScheduled: 0,
      licensesExpiring7d: 0,
      licensesExpiring30d: licensesExpiring,
      revenueCents,
      monthlyRevenueCents,
      annualRevenueCents,
      pixPending,
      renewalsDue,
      licensesExpiring,
      currency: 'BRL',
      gateway: this.gateway.count(),
      gatewayActive: activeGateway?.name ?? null,
      modeSaas,
      modeLocal,
      modeHybrid,
      recentPayments,
      updates: {
        current: 0,
        outdated: 0,
        unknown: 0,
        failedRequests: 0,
        available: false,
      },
      revenue: {
        contractedMrrCents: null,
        predictedMrrCents: null,
        overdueClients: null,
        monthReceiptsCents: null,
        overdueCents: null,
        available: false,
      },
      support: {
        awaitingFirstLogin: null,
        outdatedInstallations: null,
        syncConflicts: null,
        syncPending: null,
        offlinePending: null,
      },
      charts: {
        companiesByStatus: [],
        modeMix: [
          { name: 'SaaS', value: modeSaas },
          { name: 'Local', value: modeLocal },
          { name: 'Híbrido', value: modeHybrid },
        ].filter((row) => row.value > 0),
        updatesByStatus: [],
        licensesByStatus: [],
      },
      licenseValidities: [],
      source: 'in_memory',
    };
  }

  /** Métricas do Dashboard Comercial / Executivo. */
  async getExecutive(): Promise<MasterExecutiveSummary> {
    const [tenants, customers, subscriptions, licenseRows, invoices, payments] = await Promise.all([
      this.master.tenants.list(),
      this.customers.list(),
      this.subscriptions.list(),
      this.licenses.list(),
      this.charges.listInvoices(),
      this.payments.listPayments(),
    ]);
    return this.buildExecutiveFromLists({
      tenants,
      customers,
      subscriptions,
      licenseRows,
      invoices,
      payments,
    });
  }
}
