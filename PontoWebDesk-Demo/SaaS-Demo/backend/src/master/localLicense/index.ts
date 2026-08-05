export type {
  MachineId,
  LicenseKey,
  HardwareHash,
  LocalLicenseRecord,
  LocalLicenseValidationStatus,
  LocalLicenseValidationResult,
  IssueLocalLicenseInput,
  BindLocalLicenseInput,
} from './localLicense.types.js';

export type { LocalLicenseStore } from './ports/LocalLicenseStore.js';
export { InMemoryLocalLicenseStore } from './adapters/InMemoryLocalLicenseStore.js';
export {
  deriveMachineId,
  deriveHardwareHash,
  generateLicenseKey,
  type HardwareFingerprintInput,
} from './localLicense.fingerprint.js';
export { validateOffline } from './localLicense.validator.js';
export { LocalLicenseManager } from './LocalLicenseManager.js';
