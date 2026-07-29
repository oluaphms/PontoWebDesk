/**
 * Snapshot comercial projetado Master → SaaS (somente leitura no tenant).
 */

export type CommercialMode = 'SAAS' | 'LOCAL' | 'HYBRID';

export type CommercialContractedLimits = {
  maxUsers: number | null;
  maxDevices: number | null;
  maxStorageGb: number | null;
};

export type CommercialProjectionSnapshot = {
  /** ID da empresa operacional (companies.id), normalmente = tenant Master. */
  companyId: string;
  /** Plano operacional legado (free | pro | enterprise) — compat planLimits. */
  plan: 'free' | 'pro' | 'enterprise';
  /** Plano comercial Master (PRO, TRIAL, ENTERPRISE, …). */
  commercialPlan: string;
  commercialMode: CommercialMode;
  licenseStatus: string;
  licenseExpiresAt: string | null;
  subscriptionStatus: string;
  paymentStatus: string;
  contractedLimits: CommercialContractedLimits;
  /** Bloqueio derivado exclusivamente do estado Master (licença/tenant). */
  commercialBlocked: boolean;
  commercialBlockReason: string | null;
  commercialRevision: number;
  commercialSource: 'master';
};

export type CommercialProjectionSources = {
  tenantId: string;
  tenantStatus?: string | null;
  tenantPlan?: string | null;
  tenantMode?: string | null;
  storageMaxGb?: number | null;
  licenseStatus?: string | null;
  /** Início de vigência (master_licenses.starts_at). */
  licenseStartsAt?: string | null;
  licenseExpiresAt?: string | null;
  licenseBlockedReason?: string | null;
  licenseBlockLogin?: boolean | null;
  licenseMaxUsers?: number | null;
  licenseMaxDevices?: number | null;
  subscriptionStatus?: string | null;
  paymentStatus?: string | null;
};
