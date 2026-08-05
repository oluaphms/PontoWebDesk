export type {
  LicenseMode,
  LicenseStatus,
  LicenseControlRules,
  LicenseRuleOverrides,
  CompanyLicense,
  CreateCompanyLicenseInput,
  UpdateCompanyLicenseInput,
  LicenseManagerAction,
} from './types.js';

export {
  LICENSE_MODES,
  LICENSE_STATUSES,
  DEFAULT_EXPIRY_WARNING_DAYS,
} from './types.js';

export type { LicenseManagerStore } from './ports/LicenseManagerStore.js';
export { InMemoryLicenseManagerStore } from './adapters/InMemoryLicenseManagerStore.js';
export {
  LicenseManagerService,
  defaultRulesForStatus,
  resolveRules,
} from './LicenseManagerService.js';

export type {
  LicenseCentralRow,
  LicenseHistoryEntry,
} from './licenseCentral.types.js';

export {
  composeLicenseCentral,
  toLicenseCentralRow,
  appendLicenseHistory,
} from './composeLicenseCentral.js';
