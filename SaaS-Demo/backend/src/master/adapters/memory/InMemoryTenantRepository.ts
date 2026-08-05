import type { MasterId, MasterTenant } from '../../types.js';
import type { TenantRepository } from '../../ports/repositories.js';

export class InMemoryTenantRepository implements TenantRepository {
  private readonly byId = new Map<MasterId, MasterTenant>();

  async save(tenant: MasterTenant): Promise<MasterTenant> {
    this.byId.set(tenant.id, { ...tenant });
    return { ...tenant };
  }

  async findById(id: MasterId): Promise<MasterTenant | null> {
    const row = this.byId.get(id);
    return row ? { ...row } : null;
  }

  async findBySlug(slug: string): Promise<MasterTenant | null> {
    const needle = slug.trim().toLowerCase();
    for (const row of this.byId.values()) {
      if (row.slug.toLowerCase() === needle) return { ...row };
    }
    return null;
  }

  async listByCustomer(customerId: MasterId): Promise<MasterTenant[]> {
    return [...this.byId.values()].filter((t) => t.customerId === customerId).map((t) => ({ ...t }));
  }

  async list(): Promise<MasterTenant[]> {
    return [...this.byId.values()].map((t) => ({ ...t }));
  }

  async delete(id: MasterId): Promise<boolean> {
    return this.byId.delete(id);
  }
}
