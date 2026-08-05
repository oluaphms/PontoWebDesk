/**
 * Regras de vigência da licença a partir do ciclo da assinatura SaaS.
 *
 * Fonte oficial do período contratado: master_subscriptions.expires_at
 * (não existe current_period_end no schema).
 *
 * - Plano pago: license.expires_at = subscription.expires_at
 * - TRIAL/FREE: 14 dias (regra atual)
 * - Admin sem assinatura: expiresAt explícito ou durationDays
 */

import { invalid } from '../errors.js';

export const TRIAL_LICENSE_DURATION_DAYS = 14;

/** Fallback apenas para criação administrativa sem assinatura e sem expiresAt. */
export const ADMIN_LICENSE_DEFAULT_DURATION_DAYS = 365;

export function isTrialOrFreePlan(plan: string | null | undefined): boolean {
  const p = String(plan || '').trim().toUpperCase();
  return p === 'TRIAL' || p === 'FREE';
}

export type LicenseExpirySource =
  | 'trial_14'
  | 'subscription_expires_at'
  | 'explicit'
  | 'duration_days'
  | 'admin_default';

export type ResolveLicenseExpiryInput = {
  plan?: string | null;
  /** master_subscriptions.expires_at — obrigatório para planos pagos na jornada. */
  subscriptionExpiresAt?: string | null;
  /** Override administrativo. */
  expiresAt?: string | null;
  durationDays?: number;
  /** Se true, planos pagos sem subscriptionExpiresAt falham. */
  requireSubscriptionForPaid?: boolean;
  nowMs?: number;
};

export type ResolveLicenseExpiryResult = {
  expiresAt: string | null;
  source: LicenseExpirySource;
};

/**
 * Resolve expiresAt da licença sem persistir.
 * Preferência: expiresAt explícito → TRIAL/FREE 14d → subscription.expires_at → durationDays → admin 365.
 */
export function resolveLicenseExpiry(
  input: ResolveLicenseExpiryInput,
): ResolveLicenseExpiryResult {
  const nowMs = input.nowMs ?? Date.now();

  if (input.expiresAt !== undefined) {
    return { expiresAt: input.expiresAt, source: 'explicit' };
  }

  if (isTrialOrFreePlan(input.plan)) {
    return {
      expiresAt: new Date(nowMs + TRIAL_LICENSE_DURATION_DAYS * 86_400_000).toISOString(),
      source: 'trial_14',
    };
  }

  const subExp = String(input.subscriptionExpiresAt || '').trim();
  if (subExp) {
    const t = Date.parse(subExp);
    if (!Number.isFinite(t)) throw invalid('subscription.expires_at is invalid');
    return { expiresAt: subExp, source: 'subscription_expires_at' };
  }

  if (input.requireSubscriptionForPaid) {
    throw invalid(
      'subscription.expires_at is required to create a paid license (source: master_subscriptions.expires_at)',
    );
  }

  if (input.durationDays != null) {
    const days = Math.max(0, Math.floor(Number(input.durationDays)));
    if (!Number.isFinite(days)) throw invalid('durationDays is invalid');
    return {
      expiresAt: new Date(nowMs + days * 86_400_000).toISOString(),
      source: 'duration_days',
    };
  }

  return {
    expiresAt: new Date(nowMs + ADMIN_LICENSE_DEFAULT_DURATION_DAYS * 86_400_000).toISOString(),
    source: 'admin_default',
  };
}

/**
 * Payload para LicenseManagerService.create na jornada comercial.
 * Pagos: expiresAt da assinatura. TRIAL/FREE: durationDays 14.
 */
export function buildJourneyLicenseExpiryInput(input: {
  plan: string;
  subscriptionExpiresAt: string | null | undefined;
}): { durationDays?: number; expiresAt?: string } {
  if (isTrialOrFreePlan(input.plan)) {
    return { durationDays: TRIAL_LICENSE_DURATION_DAYS };
  }
  const resolved = resolveLicenseExpiry({
    plan: input.plan,
    subscriptionExpiresAt: input.subscriptionExpiresAt,
    requireSubscriptionForPaid: true,
  });
  return { expiresAt: resolved.expiresAt ?? undefined };
}
