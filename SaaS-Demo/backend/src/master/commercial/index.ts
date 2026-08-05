export {
  COMMERCIAL_COMPANY_FIELDS,
  COMMERCIAL_FIELDS_MASTER_ONLY_CODE,
  COMMERCIAL_FIELDS_MASTER_ONLY_MESSAGE,
  findCommercialFieldsInPayload,
  isCommercialCompanyField,
  type CommercialCompanyField,
} from './commercialFields.js';

export {
  deriveCommercialProjection,
} from './deriveCommercialProjection.js';

/** Função central de vigência comercial (calendário America/Sao_Paulo). */
export {
  evaluateCommercialLicense,
  evaluateLicenseValidity,
  toBrazilDateOnly,
  LICENSE_VALIDITY_TIMEZONE,
  buildCommercialLicenseViewState,
  resolveCompanyLicenseDisplayStatus,
  type CommercialLicenseEvaluation,
  type CommercialLicenseViewState,
  type CompanyLicenseDisplayStatus,
} from '../license/licenseValidity.js';

export {
  projectCommercialStateToSaas,
  ensureCommercialValidityForOperationalCompany,
  type CommercialProjectionInput,
} from './CommercialProjectionService.js';

export {
  bumpCompanySessionVersionOnBlock,
  readCompanySessionGate,
  readPreviousCommercialBlocked,
  type CompanySessionGate,
} from './companySessionRevocation.js';

export type {
  CommercialContractedLimits,
  CommercialMode,
  CommercialProjectionSnapshot,
  CommercialProjectionSources,
} from './commercialProjection.types.js';

export {
  INSTALLATION_TYPES,
  SAAS_WEB_URL,
  assertInstallationPlanCycle,
  installationTypeFromMode,
  installationTypeLabel,
  isInstallationType,
  modeFromInstallationType,
  parseInstallationType,
  planCycleFromInstallationType,
  requiredPlanCycleForInstallation,
  type InstallationType,
} from './installationType.js';

