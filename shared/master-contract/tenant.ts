import type { CommercialLicenseViewState } from './commercialLicenseViewState.js';

/** DTO de tenant Master nas respostas HTTP (com licenseValidity). */
export type ManagedTenantDto = {
  id: string;
  operationalCompanyId?: string | null;
  plan: string;
  status: string;
  mode: string;
  installationType?: string;
  gateway: string;
  license?: {
    licenseKey?: string | null;
    tier?: string | null;
    localLicenseBound?: boolean;
    expiresAt?: string | null;
  };
  /** Vigência comercial — sempre presente nas respostas enriquecidas. */
  licenseValidity: CommercialLicenseViewState;
  company?: {
    name?: string;
    document?: string | null;
    tradeName?: string | null;
  };
  admin?: {
    name?: string;
    email?: string;
    userId?: string | null;
  };
  domain?: string;
  storage?: {
    driver?: string;
    bucket?: string | null;
    prefix?: string | null;
    maxGb?: number | null;
  };
  createdAt?: string;
  updatedAt?: string;
  meta?: Record<string, unknown>;
};
