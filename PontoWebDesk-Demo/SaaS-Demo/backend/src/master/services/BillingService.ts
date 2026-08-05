import { invalid, notFound } from '../errors.js';
import type {
  BillingRepository,
  CustomerRepository,
  SubscriptionRepository,
  TenantRepository,
} from '../ports/repositories.js';
import type { MasterBillingStatus, MasterId, MasterInvoice } from '../types.js';
import { newMasterId, nowIso } from '../utils.js';

export type CreateInvoiceInput = {
  customerId: MasterId;
  tenantId?: MasterId | null;
  subscriptionId?: MasterId | null;
  amountCents: number;
  currency?: string;
  status?: MasterBillingStatus;
  dueAt?: string | null;
  meta?: Record<string, unknown>;
};

/**
 * BillingService — @deprecated wrapper sobre o store do DecoupledBillingEngine.
 * Use DecoupledBillingEngine (oficial) via MasterPlatformService.getBillingEngine().
 * Não integra gateway. Não processa pagamento real.
 */
export class BillingService {
  constructor(
    private readonly billing: BillingRepository,
    private readonly customers: CustomerRepository,
    private readonly tenants: TenantRepository,
    private readonly subscriptions: SubscriptionRepository,
  ) {}

  /** Cobrança real não implementada — sempre false. */
  isChargingEnabled(): boolean {
    return false;
  }

  async createInvoice(input: CreateInvoiceInput): Promise<MasterInvoice> {
    if (this.isChargingEnabled()) {
      // reservado para fase futura
    }
    const customer = await this.customers.findById(input.customerId);
    // Em postgres o espelho de customers é compat_shim; tenant oficial é SoT.
    if (!customer && !input.tenantId) {
      throw notFound('customer', input.customerId);
    }
    if (input.tenantId) {
      const tenant = await this.tenants.findById(input.tenantId);
      if (!tenant) throw notFound('tenant', input.tenantId);
    }
    if (input.subscriptionId) {
      const sub = await this.subscriptions.findById(input.subscriptionId);
      if (!sub) throw notFound('subscription', input.subscriptionId);
    }
    if (!Number.isFinite(input.amountCents) || input.amountCents < 0) {
      throw invalid('amountCents must be >= 0');
    }
    const now = nowIso();
    const row: MasterInvoice = {
      id: newMasterId(),
      customerId: input.customerId,
      tenantId: input.tenantId ?? null,
      subscriptionId: input.subscriptionId ?? null,
      status: input.status ?? 'draft',
      currency: (input.currency || 'BRL').toUpperCase(),
      amountCents: Math.floor(input.amountCents),
      issuedAt: now,
      dueAt: input.dueAt ?? null,
      paidAt: null,
      meta: {
        ...input.meta,
        chargingEnabled: false,
        note: 'architecture_only_no_payment_gateway',
      },
    };
    return this.billing.saveInvoice(row);
  }

  async getInvoice(id: MasterId): Promise<MasterInvoice> {
    const row = await this.billing.findInvoiceById(id);
    if (!row) throw notFound('invoice', id);
    return row;
  }

  async markPaid(id: MasterId): Promise<MasterInvoice> {
    // Marcação local apenas — sem captura de cartão/PIX.
    const current = await this.getInvoice(id);
    current.status = 'paid';
    current.paidAt = nowIso();
    return this.billing.saveInvoice(current);
  }

  async voidInvoice(id: MasterId): Promise<MasterInvoice> {
    const current = await this.getInvoice(id);
    current.status = 'void';
    return this.billing.saveInvoice(current);
  }

  async listByCustomer(customerId: MasterId): Promise<MasterInvoice[]> {
    return this.billing.listByCustomer(customerId);
  }

  async list(): Promise<MasterInvoice[]> {
    return this.billing.list();
  }
}
