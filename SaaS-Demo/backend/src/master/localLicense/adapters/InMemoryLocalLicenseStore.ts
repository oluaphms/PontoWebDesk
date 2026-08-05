/**
 * Adapter InMemory — licença local offline (sem internet).
 */
import type { LocalLicenseRecord, MachineId } from '../localLicense.types.js';
import type { LocalLicenseStore } from '../ports/LocalLicenseStore.js';

export class InMemoryLocalLicenseStore implements LocalLicenseStore {
  private readonly byMachine = new Map<MachineId, LocalLicenseRecord>();

  async save(record: LocalLicenseRecord): Promise<LocalLicenseRecord> {
    const copy = { ...record, meta: record.meta ? { ...record.meta } : undefined };
    this.byMachine.set(copy.machineId, copy);
    return { ...copy };
  }

  async findByMachineId(machineId: MachineId): Promise<LocalLicenseRecord | null> {
    const row = this.byMachine.get(machineId);
    return row ? { ...row } : null;
  }

  async findByLicenseKey(licenseKey: string): Promise<LocalLicenseRecord | null> {
    const key = licenseKey.trim();
    for (const row of this.byMachine.values()) {
      if (row.licenseKey === key) return { ...row };
    }
    return null;
  }

  async delete(machineId: MachineId): Promise<boolean> {
    return this.byMachine.delete(machineId);
  }

  async list(): Promise<LocalLicenseRecord[]> {
    return [...this.byMachine.values()].map((r) => ({ ...r }));
  }
}
