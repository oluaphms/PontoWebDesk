/**
 * License Manager — tipos comerciais por empresa (Master).
 * InMemory only. Não altera autenticação operacional.
 */

export const LICENSE_MODES = ['SAAS', 'LOCAL', 'HYBRID'] as const;
export type LicenseMode = (typeof LICENSE_MODES)[number];

export const LICENSE_STATUSES = ['Trial', 'Ativa', 'Expirada', 'Bloqueada'] as const;
export type LicenseStatus = (typeof LICENSE_STATUSES)[number];

/** Flags de controle — apenas metadata Master; sem wiring na auth das empresas. */
export type LicenseControlRules = {
  /** Bloquear Login (empresas) — flag Master only */
  blockLogin: boolean;
  /** Bloquear API */
  blockApi: boolean;
  /** Bloquear REP */
  blockRep: boolean;
  /** Bloquear Mobile / App */
  blockMobile: boolean;
  /** Modo somente leitura */
  readOnly: boolean;
  /** Aviso de vencimento (derivado ou forçado) */
  expiryWarning: boolean;
  /** Dias restantes até expiresAt (null = sem vencimento) */
  daysRemaining: number | null;
};

/** Overrides manuais das regras (exceto daysRemaining, sempre calculado). */
export type LicenseRuleOverrides = Partial<
  Pick<
    LicenseControlRules,
    'blockLogin' | 'blockApi' | 'blockRep' | 'blockMobile' | 'readOnly' | 'expiryWarning'
  >
>;

export type CompanyLicense = {
  id: string;
  tenantId: string;
  empresa: string;
  mode: LicenseMode;
  status: LicenseStatus;
  plan: string;
  startsAt: string;
  expiresAt: string | null;
  /** Regras efetivas (defaults do status + overrides). */
  rules: LicenseControlRules;
  /** Overrides manuais persistidos. */
  ruleOverrides: LicenseRuleOverrides;
  blockedAt: string | null;
  blockedReason: string | null;
  createdAt: string;
  updatedAt: string;
  meta?: Readonly<Record<string, unknown>>;
  /**
   * Vigência comercial calculada no backend (fonte única).
   * Opcional no domínio persistido; obrigatória nas respostas GET /licenses
   * (via ensureCompanyLicenseValidity / composeLicenseCentral).
   */
  validity?: import('@pontowebdesk/master-contract').CommercialLicenseViewState;
};

export type CreateCompanyLicenseInput = {
  tenantId: string;
  empresa?: string;
  mode?: LicenseMode;
  status?: LicenseStatus;
  plan?: string;
  startsAt?: string;
  /**
   * Dias de validade a partir de agora.
   * Preferir expiresAt da assinatura (master_subscriptions.expires_at) para planos pagos.
   * Default: Trial=14; admin sem assinatura/expiresAt=365.
   */
  durationDays?: number;
  /** Vigência explícita — para planos pagos use subscription.expires_at. */
  expiresAt?: string | null;
  ruleOverrides?: LicenseRuleOverrides;
};

export type UpdateCompanyLicenseInput = {
  empresa?: string;
  mode?: LicenseMode;
  plan?: string;
  startsAt?: string;
  expiresAt?: string | null;
  ruleOverrides?: LicenseRuleOverrides;
  /** Limites contratados (Central de Licenciamento → projeção comercial). */
  maxEmployees?: number | null;
  maxDevices?: number | null;
  licenseKey?: string | null;
};

export type LicenseManagerAction =
  | 'activate'
  | 'block'
  | 'unblock'
  | 'suspend'
  | 'reactivate'
  | 'expire'
  | 'renew'
  | 'delete'
  | 'set_trial'
  | 'set_mode_saas'
  | 'set_mode_local'
  | 'set_mode_hybrid';

/** Limiar padrão (dias) para aviso de vencimento. */
export const DEFAULT_EXPIRY_WARNING_DAYS = 30;
