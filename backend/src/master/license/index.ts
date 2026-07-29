/** Fase 10 — decisões de feature por assinatura. */
export { LicenseService, type LicenseServiceContext } from './license.service.js';
export { featuresForPlan } from './license.catalog.js';
export {
  LICENSE_FEATURES,
  type LicenseFeature,
  type LicenseFeatureSnapshot,
} from './license.types.js';

/** Fase 6.1 — modelo de licença: status de tenants/companies. */
export {
  COMPANY_LICENSE_STATUSES,
  COMPANY_PRE_LICENSE_STATUS,
  COMPANY_TENANT_STATUSES,
  COMPANY_BLOCKING_STATUSES,
  type CompanyLicenseStatus,
  type CompanyPreLicenseStatus,
  type CompanyTenantStatus,
  type CompanyTenantStatusWire,
  isCompanyLicenseStatus,
  isCompanyTenantStatus,
  normalizeCompanyStatusWire,
  toCompanyStatusCanonical,
  toCompanyStatusWire,
  isCompanyStatusBlocking,
  isCompanyLicenseCycleStatus,
  companyStatusLabel,
} from './companyLicenseStatus.js';
