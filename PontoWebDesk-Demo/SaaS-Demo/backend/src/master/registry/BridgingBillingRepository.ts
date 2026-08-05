/**
 * Bridge BillingRepository ↔ InMemoryBillingStore (DecoupledBillingEngine oficial).
 * BillingService legado lê/escreve o mesmo store do engine oficial.
 */
import type { BillingRepository } from '../ports/repositories.js';
import type { MasterId, MasterInvoice, MasterBillingStatus } from '../types.js';
import type { InMemoryBillingStore } from '../billingEngine/adapters/InMemoryBillingStore.js';
import type { Invoice, InvoiceStatus, BillingProviderName } from '../billingEngine/types.js';
import { confirmBillingPersist } from '../adapters/postgres/PgBillingStore.js';

function mapStatusToMaster(status: InvoiceStatus): MasterBillingStatus {
  if (status === 'overdue') return 'open';
  if (status === 'draft' || status === 'open' || status === 'paid' || status === 'void') {
    return status;
  }
  return 'open';
}

function mapStatusToEngine(status: MasterBillingStatus): InvoiceStatus {
  if (status === 'uncollectible') return 'void';
  return status;
}

function toMaster(inv: Invoice): MasterInvoice {
  return {
    id: inv.id,
    customerId: inv.customerId || 'cust_bridge',
    tenantId: inv.tenantId,
    subscriptionId: (inv.meta?.subscriptionId as string | undefined) ?? null,
    status: mapStatusToMaster(inv.status),
    currency: inv.currency,
    amountCents: inv.amountCents,
    issuedAt: inv.createdAt,
    dueAt: inv.dueAt,
    paidAt: inv.paidAt,
    meta: {
      ...inv.meta,
      description: inv.description,
      provider: inv.provider,
      bridgedFrom: 'DecoupledBillingEngine',
    },
  };
}

function toEngine(inv: MasterInvoice, provider: BillingProviderName = 'asaas'): Invoice {
  const now = new Date().toISOString();
  return {
    id: inv.id,
    provider,
    tenantId: inv.tenantId ?? null,
    customerId: inv.customerId,
    description:
      typeof inv.meta?.description === 'string'
        ? inv.meta.description
        : `Invoice ${inv.id}`,
    amountCents: inv.amountCents,
    currency: inv.currency,
    status: mapStatusToEngine(inv.status),
    dueAt: inv.dueAt ?? null,
    paidAt: inv.paidAt ?? null,
    createdAt: inv.issuedAt || now,
    updatedAt: now,
    meta: {
      ...inv.meta,
      subscriptionId: inv.subscriptionId ?? null,
    },
  };
}

/**
 * @deprecated Prefer DecoupledBillingEngine — este adapter mantém BillingService compatível.
 */
export class BridgingBillingRepository implements BillingRepository {
  constructor(
    private readonly store: InMemoryBillingStore,
    private readonly provider: () => BillingProviderName = () => 'asaas',
  ) {}

  async saveInvoice(invoice: MasterInvoice): Promise<MasterInvoice> {
    const engineRow = toEngine(invoice, this.provider());
    this.store.invoices.set(engineRow.id, engineRow);
    await confirmBillingPersist(this.store);
    return toMaster(engineRow);
  }

  async findInvoiceById(id: MasterId): Promise<MasterInvoice | null> {
    const row = this.store.invoices.get(id);
    return row ? toMaster(row) : null;
  }

  async listByCustomer(customerId: MasterId): Promise<MasterInvoice[]> {
    return [...this.store.invoices.values()]
      .filter((i) => i.customerId === customerId)
      .map(toMaster);
  }

  async list(): Promise<MasterInvoice[]> {
    return [...this.store.invoices.values()].map(toMaster);
  }
}
