/**
 * Tipos da camada de assinaturas Master.
 * Arquitetura only — sem gateway de pagamento. Sem banco.
 */

export type LicensePlan =
  | 'FREE'
  | 'TRIAL'
  | 'STARTER'
  | 'PRO'
  | 'ENTERPRISE'
  | 'LOCAL'
  | 'HYBRID';

/**
 * Status interno (persistido).
 * Situação exibida na UI: Trial | Ativa | Pendente | Expirada | Bloqueada | Cancelada.
 */
export type SubscriptionStatus =
  | 'ACTIVE'
  | 'PENDING_PAYMENT'
  | 'PAUSED'
  | 'SUSPENDED'
  | 'CANCELLED'
  | 'TRIAL'
  | 'EXPIRED';

/** Periodicidade comercial (sem cobrança real nesta fase). */
export type SubscriptionPeriodicity = 'monthly' | 'yearly' | 'quarterly' | 'once';

/** Situação comercial (labels PT). */
export type SubscriptionSituacao =
  | 'Trial'
  | 'Ativa'
  | 'Pendente'
  | 'Expirada'
  | 'Bloqueada'
  | 'Cancelada';

export type SubscriptionId = string;
export type SubscriptionTenantId = string;
export type SubscriptionCustomerId = string;

/** Dados persistíveis da assinatura. */
export type SubscriptionProps = {
  id: SubscriptionId;
  /** Empresa (tenant Master) — 1 assinatura ativa por empresa. */
  tenantId: SubscriptionTenantId;
  customerId: SubscriptionCustomerId;
  /** Plano */
  plan: LicensePlan;
  status: SubscriptionStatus;
  /** Valor em centavos (sem gateway — arquitetura). */
  amountCents: number;
  /** Periodicidade */
  periodicity: SubscriptionPeriodicity;
  startsAt: string;
  /** Vencimento / expiração do ciclo */
  expiresAt: string | null;
  nextBilling: string | null;
  graceUntil: string | null;
  /** Última renovação */
  renewedAt: string | null;
  /** Data de suspensão / bloqueio */
  suspendedAt: string | null;
  createdAt: string;
  updatedAt: string;
  cancelledAt: string | null;
  pausedAt: string | null;
  meta?: Readonly<Record<string, unknown>>;
};

export type CreateSubscriptionInput = {
  tenantId: SubscriptionTenantId;
  customerId: SubscriptionCustomerId;
  plan: LicensePlan;
  status?: SubscriptionStatus;
  amountCents?: number;
  periodicity?: SubscriptionPeriodicity;
  startsAt?: string;
  /** Duração em dias a partir de startsAt (se expiresAt omitido). */
  durationDays?: number;
  expiresAt?: string | null;
  nextBilling?: string | null;
  /** Dias de carência após expiresAt (default 0). */
  graceDays?: number;
  graceUntil?: string | null;
  meta?: Record<string, unknown>;
};

export type RenewSubscriptionInput = {
  /** Dias a adicionar a partir de expiresAt (ou now se já expirado). Default conforme periodicidade. */
  durationDays?: number;
  nextBilling?: string | null;
  graceDays?: number;
};

export const LICENSE_PLANS: readonly LicensePlan[] = [
  'FREE',
  'TRIAL',
  'STARTER',
  'PRO',
  'ENTERPRISE',
  'LOCAL',
  'HYBRID',
] as const;

export const SUBSCRIPTION_STATUSES: readonly SubscriptionStatus[] = [
  'ACTIVE',
  'PENDING_PAYMENT',
  'PAUSED',
  'SUSPENDED',
  'CANCELLED',
  'TRIAL',
  'EXPIRED',
] as const;

export const SUBSCRIPTION_PERIODICITIES: readonly SubscriptionPeriodicity[] = [
  'monthly',
  'yearly',
  'quarterly',
  'once',
] as const;

export const PLAN_DEFAULT_AMOUNT_CENTS: Record<LicensePlan, number> = {
  FREE: 0,
  TRIAL: 0,
  STARTER: 9_900,
  PRO: 19_900,
  ENTERPRISE: 49_900,
  LOCAL: 0,
  HYBRID: 29_900,
};

export const PLAN_DEFAULT_PERIODICITY: Record<LicensePlan, SubscriptionPeriodicity> = {
  FREE: 'once',
  TRIAL: 'once',
  STARTER: 'monthly',
  PRO: 'monthly',
  ENTERPRISE: 'monthly',
  LOCAL: 'yearly',
  HYBRID: 'monthly',
};

export const PERIODICITY_LABEL: Record<SubscriptionPeriodicity, string> = {
  monthly: 'Mensal',
  yearly: 'Anual',
  quarterly: 'Trimestral',
  once: 'Única',
};

/**
 * @deprecated Não usar para master_subscriptions.expires_at.
 * Fonte única: `calculateSubscriptionExpiresAt` / `addMonthsUtc` / `addYearsUtc`.
 * Mantido apenas para estimativas legadas / UI aproximada.
 */
export function periodicityDurationDays(periodicity: SubscriptionPeriodicity): number {
  switch (periodicity) {
    case 'yearly':
      return 365;
    case 'quarterly':
      return 90;
    case 'once':
      return 30;
    case 'monthly':
    default:
      return 30;
  }
}
