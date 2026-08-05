/**
 * Contrato do repositório de assinaturas (Fase 9) + adapter InMemory.
 * Sem banco.
 */
import { SubscriptionEntity } from './subscription.entity.js';
import type { SubscriptionId, SubscriptionTenantId } from './subscription.types.js';

export interface SubscriptionRepository {
  save(entity: SubscriptionEntity): Promise<SubscriptionEntity>;
  findById(id: SubscriptionId): Promise<SubscriptionEntity | null>;
  listByTenant(tenantId: SubscriptionTenantId): Promise<SubscriptionEntity[]>;
  list(): Promise<SubscriptionEntity[]>;
  delete(id: SubscriptionId): Promise<boolean>;
}

export class InMemorySubscriptionRepository implements SubscriptionRepository {
  private readonly byId = new Map<SubscriptionId, SubscriptionEntity>();

  async save(entity: SubscriptionEntity): Promise<SubscriptionEntity> {
    const copy = SubscriptionEntity.fromProps(entity.toProps());
    this.byId.set(copy.id, copy);
    return SubscriptionEntity.fromProps(copy.toProps());
  }

  async findById(id: SubscriptionId): Promise<SubscriptionEntity | null> {
    const row = this.byId.get(id);
    return row ? SubscriptionEntity.fromProps(row.toProps()) : null;
  }

  async listByTenant(tenantId: SubscriptionTenantId): Promise<SubscriptionEntity[]> {
    return [...this.byId.values()]
      .filter((e) => e.tenantId === tenantId)
      .map((e) => SubscriptionEntity.fromProps(e.toProps()));
  }

  async list(): Promise<SubscriptionEntity[]> {
    return [...this.byId.values()].map((e) => SubscriptionEntity.fromProps(e.toProps()));
  }

  async delete(id: SubscriptionId): Promise<boolean> {
    return this.byId.delete(id);
  }
}
