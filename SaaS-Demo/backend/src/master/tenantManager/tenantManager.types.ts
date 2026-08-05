/**
 * TenantManager — tipos do tenant Master (backend only).
 */

import type { LicensePlan } from '../subscriptions/subscription.types.js';
import type { MasterDeploymentMode } from '../types.js';
import type { CompanyTenantStatusWire } from '../license/companyLicenseStatus.js';
import type { InstallationType } from '../commercial/installationType.js';

/**
 * Status persistido em master_tenants (lowercase).
 * Ciclo comercial (Fase 6.1): ACTIVE/TRIAL/SUSPENDED/BLOCKED/CANCELLED
 * — ver `CompanyLicenseStatus` / `toCompanyStatusCanonical`.
 */
export type TenantManagerStatus = CompanyTenantStatusWire;
export type TenantStorageDriver = 'local' | 's3' | 'supabase' | 'none';

/** Plano comercial: legado LicensePlan ou ciclo MONTHLY/ANNUAL (Fase 6.6). */
export type TenantCommercialPlan = LicensePlan | 'MONTHLY' | 'ANNUAL';

export type TenantStorageConfig = {
  driver: TenantStorageDriver;
  bucket?: string | null;
  prefix?: string | null;
  maxGb?: number | null;
  meta?: Readonly<Record<string, unknown>>;
};

export type TenantCompanyInfo = {
  name: string;
  document?: string | null;
  tradeName?: string | null;
};

export type TenantAdminInfo = {
  name: string;
  email: string;
  userId?: string | null;
};

export type TenantLicenseInfo = {
  licenseKey?: string | null;
  tier?: string | null;
  localLicenseBound?: boolean;
  expiresAt?: string | null;
};

export type ManagedTenant = {
  id: string;
  /** ID da empresa no SaaS operacional; definido pela jornada comercial Master. */
  operationalCompanyId?: string | null;
  /** Plano comercial (legado ou ciclo MONTHLY/ANNUAL). */
  plan: TenantCommercialPlan;
  status: TenantManagerStatus;
  /** Modo de implantação (legado SAAS|LOCAL|HYBRID). */
  mode: MasterDeploymentMode;
  /**
   * Gateway legado — mantido no schema apenas por compatibilidade.
   * Fase 6.6: sempre `none`; pagamentos são manuais.
   */
  gateway: 'none';
  /** Tipo de instalação comercial (Fase 6.6). */
  installationType: InstallationType;
  license: TenantLicenseInfo;
  company: TenantCompanyInfo;
  admin: TenantAdminInfo;
  /** Domínio / host do tenant. */
  domain: string;
  storage: TenantStorageConfig;
  createdAt: string;
  updatedAt: string;
  meta?: Readonly<Record<string, unknown>>;
};

export type CreateManagedTenantInput = {
  operationalCompanyId?: string | null;
  plan?: TenantCommercialPlan;
  status?: TenantManagerStatus;
  mode?: MasterDeploymentMode;
  /** Ignorado — sempre persistido como `none`. */
  gateway?: 'none';
  installationType?: InstallationType;
  license?: TenantLicenseInfo;
  company: TenantCompanyInfo;
  admin: TenantAdminInfo;
  domain: string;
  storage?: Partial<TenantStorageConfig>;
  meta?: Record<string, unknown>;
};

export type UpdateManagedTenantInput = {
  operationalCompanyId?: string | null;
  plan?: TenantCommercialPlan;
  status?: TenantManagerStatus;
  mode?: MasterDeploymentMode;
  /** Ignorado — gateway comercial removido. */
  gateway?: 'none';
  installationType?: InstallationType;
  license?: Partial<TenantLicenseInfo>;
  company?: Partial<TenantCompanyInfo>;
  admin?: Partial<TenantAdminInfo>;
  domain?: string;
  storage?: Partial<TenantStorageConfig>;
  meta?: Record<string, unknown>;
};
