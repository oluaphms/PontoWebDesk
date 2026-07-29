import type { MasterId, MasterInvoice } from '../../types.js';
import type { BillingRepository } from '../../ports/repositories.js';

export class InMemoryBillingRepository implements BillingRepository {
  private readonly byId = new Map<MasterId, MasterInvoice>();

  async saveInvoice(invoice: MasterInvoice): Promise<MasterInvoice> {
    this.byId.set(invoice.id, { ...invoice });
    return { ...invoice };
  }

  async findInvoiceById(id: MasterId): Promise<MasterInvoice | null> {
    const row = this.byId.get(id);
    return row ? { ...row } : null;
  }

  async listByCustomer(customerId: MasterId): Promise<MasterInvoice[]> {
    return [...this.byId.values()].filter((i) => i.customerId === customerId).map((i) => ({ ...i }));
  }

  async list(): Promise<MasterInvoice[]> {
    return [...this.byId.values()].map((i) => ({ ...i }));
  }
}
