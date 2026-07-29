/**
 * Port — armazenamento local da licença (sem rede / sem banco remoto).
 */
import type { LocalLicenseRecord, MachineId } from '../localLicense.types.js';

export interface LocalLicenseStore {
  save(record: LocalLicenseRecord): Promise<LocalLicenseRecord>;
  findByMachineId(machineId: MachineId): Promise<LocalLicenseRecord | null>;
  findByLicenseKey(licenseKey: string): Promise<LocalLicenseRecord | null>;
  delete(machineId: MachineId): Promise<boolean>;
  list(): Promise<LocalLicenseRecord[]>;
}
