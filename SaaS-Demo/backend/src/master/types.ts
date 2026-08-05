/**
 * Contratos do Painel Master — isolados do restante do sistema.
 * Sem cobrança real, sem DB, sem API pública nesta fase.
 */

export type MasterId = string;

export type MasterTenantStatus =
  | 'draft'
  | 'active'
  | 'trial'
  | 'blocked'
  | 'suspended'
  | 'cancelled';

export type MasterDeploymentMode = 'SAAS' | 'LOCAL' | 'HYBRID';

export type MasterSubscriptionStatus =
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'cancelled'
  | 'expired';

export type MasterBillingStatus = 'draft' | 'open' | 'paid' | 'void' | 'uncollectible';

export type MasterLicenseTier = 'full' | 'standard' | 'trial' | 'none';

export type MasterCustomer = {
  id: MasterId;
  name: string;
  email: string;
  document?: string | null;
  createdAt: string;
  updatedAt: string;
  meta?: Readonly<Record<string, unknown>>;
};

export type MasterTenant = {
  id: MasterId;
  customerId: MasterId;
  name: string;
  slug: string;
  status: MasterTenantStatus;
  deploymentMode: MasterDeploymentMode;
  createdAt: string;
  updatedAt: string;
  blockedAt?: string | null;
  blockedReason?: string | null;
  activatedAt?: string | null;
  meta?: Readonly<Record<string, unknown>>;
};

export type MasterSubscription = {
  id: MasterId;
  tenantId: MasterId;
  customerId: MasterId;
  planCode: string;
  status: MasterSubscriptionStatus;
  seats?: number | null;
  startsAt: string;
  endsAt?: string | null;
  createdAt: string;
  updatedAt: string;
  meta?: Readonly<Record<string, unknown>>;
};

/** Fatura / documento de billing — sem gateway de pagamento. */
export type MasterInvoice = {
  id: MasterId;
  customerId: MasterId;
  tenantId?: MasterId | null;
  subscriptionId?: MasterId | null;
  status: MasterBillingStatus;
  currency: string;
  amountCents: number;
  issuedAt: string;
  dueAt?: string | null;
  paidAt?: string | null;
  meta?: Readonly<Record<string, unknown>>;
};

export type MasterLicenseRecord = {
  id: MasterId;
  tenantId: MasterId;
  customerId: MasterId;
  tier: MasterLicenseTier;
  plan: string;
  payloadJson: string;
  key: string;
  generatedAt: string;
  expiresAt?: string | null;
  activatedAt?: string | null;
  revokedAt?: string | null;
};

export type MasterActivationRecord = {
  id: MasterId;
  tenantId: MasterId;
  licenseId: MasterId;
  activatedAt: string;
  activatedBy?: string | null;
  note?: string | null;
};

export type MasterBlockRecord = {
  id: MasterId;
  tenantId: MasterId;
  reason: string;
  blockedAt: string;
  blockedBy?: string | null;
  unlockedAt?: string | null;
  unlockedBy?: string | null;
};
