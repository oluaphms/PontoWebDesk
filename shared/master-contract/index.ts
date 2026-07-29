/**
 * @pontowebdesk/master-contract
 * Fonte única de tipos do contrato Master (FE + BE).
 */
export {
  COMMERCIAL_VALIDITY_KEYS,
  type CommercialLicenseViewState,
  type CompanyLicenseDisplayStatus,
  type LicenseValidityPhase,
} from './commercialLicenseViewState.js';

export {
  type CompanyLicenseDto,
  type LicenseCentralRow,
  type LicenseControlRules,
  type LicenseHistoryEntry,
  type LicenseMode,
  type LicenseRuleOverrides,
  type LicenseStatus,
} from './license.js';

export { type ManagedTenantDto } from './tenant.js';

export {
  type ExecutiveChartSlice,
  type MasterExecutiveCharts,
  type MasterExecutiveRevenueBlock,
  type MasterExecutiveSummary,
  type MasterExecutiveSupportBlock,
  type MasterExecutiveUpdatesBlock,
  type MasterRecentPayment,
} from './dashboard.js';
