import type { CommercialLicenseViewState } from './commercialLicenseViewState.js';

export type LicenseMode = 'SAAS' | 'LOCAL' | 'HYBRID';
export type LicenseStatus = 'Trial' | 'Ativa' | 'Expirada' | 'Bloqueada';

export type LicenseControlRules = {
  blockLogin: boolean;
  blockApi: boolean;
  blockRep: boolean;
  blockMobile: boolean;
  readOnly: boolean;
  expiryWarning: boolean;
  daysRemaining: number | null;
};

export type LicenseRuleOverrides = Partial<Omit<LicenseControlRules, 'daysRemaining'>>;

export type LicenseHistoryEntry = {
  at: string;
  action: string;
  reason?: string | null;
  actorEmail?: string | null;
};

/** Licença com vigência obrigatória nas respostas HTTP Master. */
export type CompanyLicenseDto = {
  id: string;
  tenantId: string;
  empresa: string;
  mode: LicenseMode;
  status: LicenseStatus;
  plan: string;
  startsAt: string;
  expiresAt: string | null;
  rules: LicenseControlRules;
  ruleOverrides: LicenseRuleOverrides;
  blockedAt: string | null;
  blockedReason: string | null;
  createdAt: string;
  updatedAt: string;
  meta?: Readonly<Record<string, unknown>>;
  validity: CommercialLicenseViewState;
};

/** Linha da Central de Licenciamento. */
export type LicenseCentralRow = {
  id: string;
  tenantId: string;
  empresa: string;
  plan: string;
  tipo: LicenseMode;
  mode: LicenseMode;
  licenseKey: string | null;
  issuedAt: string;
  startsAt: string;
  expiresAt: string | null;
  lastPaymentAt: string | null;
  lastPaymentStatus: string | null;
  lastPaymentAmountCents: number | null;
  status: LicenseStatus;
  isBlocked: boolean;
  blockedAt: string | null;
  blockedReason: string | null;
  blockKind: 'blocked' | 'suspended' | null;
  maxEmployees: number | null;
  maxDevices: number | null;
  installedVersion: string | null;
  history: LicenseHistoryEntry[];
  rules: LicenseControlRules;
  ruleOverrides: LicenseRuleOverrides;
  createdAt: string;
  updatedAt: string;
  meta?: Readonly<Record<string, unknown>>;
  validity: CommercialLicenseViewState;
};
