/**
 * Contrato Master — vigência comercial (validity / licenseValidity).
 */
export {
  COMMERCIAL_VALIDITY_KEYS,
  commercialValidityShapeSnapshot,
  validateCommercialLicenseViewState,
  type CommercialValidityKey,
  type ContractViolation,
} from './commercialValidityShape.js';

export {
  MASTER_VALIDITY_ROUTE_COVERAGE,
  endpointTopLevelShapeSnapshot,
  validateDashboardResponse,
  validateLicenseMutationResponse,
  validateLicensesResponse,
  validateMasterEndpointResponse,
  validateOperationalCompaniesResponse,
  validateSummaryResponse,
  validateTenantResponse,
  validateTenantsResponse,
  type MasterContractEndpoint,
  type MasterContractReport,
} from './masterEndpointContracts.js';

export {
  guardMasterContractResponse,
  reportMasterContractViolations,
  type ContractGuardOptions,
} from './reportContractViolation.js';
