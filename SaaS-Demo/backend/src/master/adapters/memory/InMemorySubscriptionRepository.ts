import type { MasterId, MasterSubscription } from '../../types.js';
import type { SubscriptionRepository } from '../../ports/repositories.js';

export class InMemorySubscriptionRepository implements SubscriptionRepository {
  private readonly byId = new Map<MasterId, MasterSubscription>();

  async save(sub: MasterSubscription): Promise<MasterSubscription> {
    this.byId.set(sub.id, { ...sub });
    return { ...sub };
  }

  async findById(id: MasterId): Promise<MasterSubscription | null> {
    const row = this.byId.get(id);
    return row ? { ...row } : null;
  }

  async listByTenant(tenantId: MasterId): Promise<MasterSubscription[]> {
    return [...this.byId.values()].filter((s) => s.tenantId === tenantId).map((s) => ({ ...s }));
  }

  async listByCustomer(customerId: MasterId): Promise<MasterSubscription[]> {
    return [...this.byId.values()].filter((s) => s.customerId === customerId).map((s) => ({ ...s }));
  }

  async list(): Promise<MasterSubscription[]> {
    return [...this.byId.values()].map((s) => ({ ...s }));
  }
}
