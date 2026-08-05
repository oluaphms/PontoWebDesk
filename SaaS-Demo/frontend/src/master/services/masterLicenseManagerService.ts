/**
 * Service frontend — Central de Licenciamento Master.
 */
import * as api from '../api/licensesApi';

export const MasterLicenseManagerService = {
  list: api.fetchCompanyLicenses,
  listCentral: api.fetchLicenseCentral,
  history: api.fetchLicenseHistory,
  create: api.createCompanyLicense,
  action: api.runLicenseManagerAction,
  setRules: api.setLicenseRules,
  patch: api.patchCompanyLicense,
  formatDate: api.formatLicenseDate,
  formatMoney: api.formatMoneyCents,
};

export type {
  CompanyLicense,
  LicenseCentralRow,
  LicenseHistoryEntry,
  LicenseMode,
  LicenseStatus,
  LicenseControlRules,
  LicenseManagerAction,
  CreateCompanyLicenseInput,
} from '../api/licensesApi';

export default MasterLicenseManagerService;
