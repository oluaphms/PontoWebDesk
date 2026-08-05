import type { MasterBlockRecord, MasterId } from '../../types.js';
import type { BlockRepository } from '../../ports/repositories.js';

export class InMemoryBlockRepository implements BlockRepository {
  private readonly byId = new Map<MasterId, MasterBlockRecord>();

  async save(record: MasterBlockRecord): Promise<MasterBlockRecord> {
    this.byId.set(record.id, { ...record });
    return { ...record };
  }

  async findActiveByTenant(tenantId: MasterId): Promise<MasterBlockRecord | null> {
    const rows = [...this.byId.values()]
      .filter((r) => r.tenantId === tenantId && !r.unlockedAt)
      .sort((a, b) => b.blockedAt.localeCompare(a.blockedAt));
    return rows[0] ? { ...rows[0] } : null;
  }

  async listByTenant(tenantId: MasterId): Promise<MasterBlockRecord[]> {
    return [...this.byId.values()].filter((r) => r.tenantId === tenantId).map((r) => ({ ...r }));
  }

  async list(): Promise<MasterBlockRecord[]> {
    return [...this.byId.values()].map((r) => ({ ...r }));
  }
}
