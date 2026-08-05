import type { MasterId, MasterLicenseRecord } from '../../types.js';
import type { LicenseRecordRepository } from '../../ports/repositories.js';

export class InMemoryLicenseRecordRepository implements LicenseRecordRepository {
  private readonly byId = new Map<MasterId, MasterLicenseRecord>();

  async save(record: MasterLicenseRecord): Promise<MasterLicenseRecord> {
    this.byId.set(record.id, { ...record });
    return { ...record };
  }

  async findById(id: MasterId): Promise<MasterLicenseRecord | null> {
    const row = this.byId.get(id);
    return row ? { ...row } : null;
  }

  async listByTenant(tenantId: MasterId): Promise<MasterLicenseRecord[]> {
    return [...this.byId.values()].filter((r) => r.tenantId === tenantId).map((r) => ({ ...r }));
  }

  async list(): Promise<MasterLicenseRecord[]> {
    return [...this.byId.values()].map((r) => ({ ...r }));
  }
}
