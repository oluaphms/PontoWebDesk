import type { MasterCustomer, MasterId } from '../../types.js';
import type { CustomerRepository } from '../../ports/repositories.js';

export class InMemoryCustomerRepository implements CustomerRepository {
  private readonly byId = new Map<MasterId, MasterCustomer>();

  async save(customer: MasterCustomer): Promise<MasterCustomer> {
    this.byId.set(customer.id, { ...customer });
    return { ...customer };
  }

  async findById(id: MasterId): Promise<MasterCustomer | null> {
    const row = this.byId.get(id);
    return row ? { ...row } : null;
  }

  async findByEmail(email: string): Promise<MasterCustomer | null> {
    const needle = email.trim().toLowerCase();
    for (const row of this.byId.values()) {
      if (row.email.trim().toLowerCase() === needle) return { ...row };
    }
    return null;
  }

  async list(): Promise<MasterCustomer[]> {
    return [...this.byId.values()].map((r) => ({ ...r }));
  }

  async delete(id: MasterId): Promise<boolean> {
    return this.byId.delete(id);
  }
}
