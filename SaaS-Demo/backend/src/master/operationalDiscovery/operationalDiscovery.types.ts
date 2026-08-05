/**
 * Descoberta automática: companies (operacional) ↔ domínio comercial Master.
 * Nunca cria uma segunda empresa operacional — só vincula / inicializa comercial.
 */

import type { CommercialLicenseViewState } from '../license/licenseValidity.js';

export type CommercialInitStatus =
  | 'initialized'
  | 'not_initialized'
  | 'orphan_commercial';

export type OperationalCompanyDirectoryRow = {
  /** ID canônico em public.companies (fonte de verdade). */
  operationalCompanyId: string | null;
  razaoSocial: string;
  nomeFantasia: string | null;
  cnpj: string | null;
  email: string | null;
  telefone: string | null;
  /** Tenant comercial Master (tn_*), se existir. */
  masterTenantId: string | null;
  plan: string | null;
  status: string | null;
  expiresAt: string | null;
  /** Vigência comercial — calculada no backend (fonte única). Sempre presente no directory. */
  licenseValidity: CommercialLicenseViewState;
  commercialSituation: string | null;
  firstAccessStatus: 'pending' | 'sent' | 'failed' | 'accepted' | null;
  firstAccessSentAt: string | null;
  firstAccessLastError: string | null;
  /** Sempre 'operational' para linhas de companies; 'orphan' se só restou master_tenants. */
  origin: 'operational' | 'orphan';
  commercialInitialized: boolean;
  initStatus: CommercialInitStatus;
};

export type InitializeCommercialResult = {
  ok: true;
  reused: boolean;
  operationalCompanyId: string;
  masterTenantId: string;
  subscriptionId: string | null;
  licenseId: string | null;
  crmInitialized: boolean;
  financeEntryId: string | null;
  notificationsInitialized: boolean;
  message: string;
};

export type OrphanCommercialReport = {
  masterTenantId: string;
  operationalCompanyId: string;
  companyName: string;
  status: string;
  reason: 'operational_company_missing';
};
