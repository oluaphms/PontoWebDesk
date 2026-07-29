import type {
  CompanyLicense,
  CreateCompanyLicenseInput,
  UpdateCompanyLicenseInput,
} from '../types.js';

export interface LicenseManagerStore {
  /** Backend físico — default memory. */
  readonly persistence?: 'memory' | 'postgres';
  list(): Promise<CompanyLicense[]>;
  get(id: string): Promise<CompanyLicense | null>;
  getByTenantId(tenantId: string): Promise<CompanyLicense | null>;
  save(row: CompanyLicense): Promise<CompanyLicense>;
  delete(id: string): Promise<boolean>;
  clear(): Promise<void>;
}

export type { CompanyLicense, CreateCompanyLicenseInput, UpdateCompanyLicenseInput };
