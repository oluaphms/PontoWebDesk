/**
 * Local License Manager — tipos (offline, sem internet).
 */

export type MachineId = string;
export type LicenseKey = string;
export type HardwareHash = string;

export type LocalLicenseRecord = {
  machineId: MachineId;
  licenseKey: LicenseKey;
  hardwareHash: HardwareHash;
  activationDate: string;
  expirationDate: string | null;
  /** Último heartbeat local (ISO). */
  heartbeat: string;
  plan?: string | null;
  meta?: Readonly<Record<string, unknown>>;
};

export type LocalLicenseValidationStatus =
  | 'valid'
  | 'expired'
  | 'hardware_mismatch'
  | 'missing'
  | 'invalid'
  | 'heartbeat_stale';

export type LocalLicenseValidationResult = {
  ok: boolean;
  status: LocalLicenseValidationStatus;
  errors: string[];
  record: LocalLicenseRecord | null;
  remainingDays: number | null;
};

export type IssueLocalLicenseInput = {
  machineId: MachineId;
  hardwareHash: HardwareHash;
  licenseKey?: LicenseKey;
  /** Dias até expirar; omitido / null = sem expiração. */
  durationDays?: number | null;
  expirationDate?: string | null;
  plan?: string | null;
  meta?: Record<string, unknown>;
};

export type BindLocalLicenseInput = {
  machineId: MachineId;
  licenseKey: LicenseKey;
  hardwareHash: HardwareHash;
};
