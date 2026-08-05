/**
 * Service frontend de Empresas Master — separado do Companies operacional.
 * Consome /api/master/tenants (adapters InMemory no backend).
 */
import {
  createMasterCompany,
  fetchMasterCompanies,
  fetchMasterCompany,
  formatCompanyDate,
  updateMasterCompany,
  deleteMasterCompany,
  runMasterCompanyAction,
  type CreateMasterCompanyInput,
  type UpdateMasterCompanyInput,
  type MasterCompanyAction,
} from '../api/companiesApi';
import type { MasterCompanyRow, ManagedTenantDto } from '../types/company';

export type MasterTenantsFilter = {
  q?: string;
  plan?: string;
  mode?: string;
  status?: string;
};

export const MasterTenantsService = {
  async list(filter?: MasterTenantsFilter): Promise<MasterCompanyRow[]> {
    return fetchMasterCompanies(filter);
  },

  async get(id: string): Promise<MasterCompanyRow> {
    return fetchMasterCompany(id);
  },

  async create(input: CreateMasterCompanyInput): Promise<ManagedTenantDto> {
    return createMasterCompany(input);
  },

  async update(id: string, input: UpdateMasterCompanyInput): Promise<ManagedTenantDto> {
    return updateMasterCompany(id, input);
  },

  async delete(id: string): Promise<{
    ok: true;
    deleted: true;
    tenantId: string;
    operationalCompanyId: string | null;
    companyName: string;
  }> {
    return deleteMasterCompany(id);
  },

  async action(
    id: string,
    action: MasterCompanyAction,
    reason?: string,
  ): Promise<ManagedTenantDto> {
    return runMasterCompanyAction(id, action, reason);
  },

  formatDate: formatCompanyDate,
};

export default MasterTenantsService;
