import type { MasterActivationRecord, MasterId } from '../../types.js';
import type { ActivationRepository } from '../../ports/repositories.js';

export class InMemoryActivationRepository implements ActivationRepository {
  private readonly byId = new Map<MasterId, MasterActivationRecord>();

  async save(record: MasterActivationRecord): Promise<MasterActivationRecord> {
    this.byId.set(record.id, { ...record });
    return { ...record };
  }

  async listByTenant(tenantId: MasterId): Promise<MasterActivationRecord[]> {
    return [...this.byId.values()].filter((r) => r.tenantId === tenantId).map((r) => ({ ...r }));
  }

  async list(): Promise<MasterActivationRecord[]> {
    return [...this.byId.values()].map((r) => ({ ...r }));
  }
}
