/**
 * Máquina de estados do BillingEngine — pura (sem I/O).
 */
import { conflict } from '../errors.js';
import type { BillingState, BillingTransition } from './billing.types.js';
import { BILLING_TRANSITIONS } from './billing.types.js';
import type { SubscriptionEntity } from '../subscriptions/subscription.entity.js';

export function resolveBillingState(sub: SubscriptionEntity, now = Date.now()): BillingState {
  const status = sub.status;
  if (status === 'SUSPENDED') return 'SUSPENDED';
  if (status === 'CANCELLED') return 'CANCELLED';
  if (status === 'PAUSED') return 'PAUSED';
  if (status === 'PENDING_PAYMENT') {
    if (sub.isInGracePeriod(now)) return 'GRACE';
    return 'PENDING_PAYMENT';
  }
  if (sub.isInGracePeriod(now)) return 'GRACE';
  if (status === 'TRIAL' || sub.plan === 'TRIAL') return 'TRIAL';
  if (status === 'ACTIVE') return 'ACTIVE';
  return 'CANCELLED';
}

export function assertTransition(
  from: BillingState,
  transition: BillingTransition,
): BillingState {
  const next = BILLING_TRANSITIONS[from]?.[transition];
  if (!next) {
    throw conflict(`billing transition not allowed: ${from} --${transition}→`);
  }
  return next;
}

export function mapBillingStateToSubscriptionStatus(
  state: BillingState,
): 'ACTIVE' | 'PENDING_PAYMENT' | 'PAUSED' | 'SUSPENDED' | 'CANCELLED' | 'TRIAL' {
  switch (state) {
    case 'GRACE':
      // Graça é temporal; mantém ACTIVE ou PENDING no registro — engine usa ACTIVE.
      return 'ACTIVE';
    case 'TRIAL':
      return 'TRIAL';
    case 'ACTIVE':
      return 'ACTIVE';
    case 'PENDING_PAYMENT':
      return 'PENDING_PAYMENT';
    case 'SUSPENDED':
      return 'SUSPENDED';
    case 'CANCELLED':
      return 'CANCELLED';
    case 'PAUSED':
      return 'PAUSED';
    default:
      return 'ACTIVE';
  }
}
