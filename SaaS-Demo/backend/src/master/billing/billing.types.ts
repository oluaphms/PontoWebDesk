/**
 * Estados e transições do BillingEngine (máquina de estados).
 * Sem banco. Sem gateway.
 */

export type BillingState =
  | 'TRIAL'
  | 'ACTIVE'
  | 'PENDING_PAYMENT'
  | 'GRACE'
  | 'SUSPENDED'
  | 'CANCELLED'
  | 'PAUSED';

export type BillingTransition =
  | 'renew'
  | 'generate_next_charge'
  | 'enter_grace'
  | 'block'
  | 'reactivate'
  | 'mark_charge_pending';

/** Grafo: de → eventos permitidos → para (resultado típico). */
export const BILLING_TRANSITIONS: Readonly<
  Record<BillingState, Partial<Record<BillingTransition, BillingState>>>
> = {
  TRIAL: {
    renew: 'ACTIVE',
    generate_next_charge: 'PENDING_PAYMENT',
    enter_grace: 'GRACE',
    block: 'SUSPENDED',
  },
  ACTIVE: {
    renew: 'ACTIVE',
    generate_next_charge: 'PENDING_PAYMENT',
    enter_grace: 'GRACE',
    block: 'SUSPENDED',
  },
  PENDING_PAYMENT: {
    renew: 'ACTIVE',
    enter_grace: 'GRACE',
    block: 'SUSPENDED',
    reactivate: 'ACTIVE',
  },
  GRACE: {
    renew: 'ACTIVE',
    reactivate: 'ACTIVE',
    block: 'SUSPENDED',
    generate_next_charge: 'PENDING_PAYMENT',
  },
  SUSPENDED: {
    reactivate: 'ACTIVE',
  },
  CANCELLED: {
    reactivate: 'ACTIVE',
  },
  PAUSED: {
    reactivate: 'ACTIVE',
    block: 'SUSPENDED',
  },
};

export type BillingChargeStatus = 'open' | 'paid' | 'void';

export type BillingCharge = {
  id: string;
  subscriptionId: string;
  amountCents: number;
  currency: string;
  status: BillingChargeStatus;
  dueAt: string;
  createdAt: string;
  paidAt: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  meta?: Readonly<Record<string, unknown>>;
};

export type RenewBillingInput = {
  durationDays?: number;
  graceDays?: number;
};

export type GenerateChargeInput = {
  amountCents: number;
  currency?: string;
  dueInDays?: number;
};

export type EnterGraceInput = {
  graceDays?: number;
};

export type BillingEngineResult = {
  state: BillingState;
  previousState: BillingState;
  transition: BillingTransition;
  subscriptionId: string;
  charge?: BillingCharge | null;
};
