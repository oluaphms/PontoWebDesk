/**
 * Níveis de acesso do AccessControlService (Fase 11).
 */
export type AccessLevel = 'full' | 'normal' | 'login_only' | 'none';

/** Motivo resolvido (diagnóstico / futuros logs — sem Auth). */
export type AccessReason =
  | 'active'
  | 'trial'
  | 'pending_payment'
  | 'grace'
  | 'suspended'
  | 'cancelled'
  | 'paused'
  | 'local_ignore_billing'
  | 'expired'
  | 'missing_subscription'
  | 'admin_blocked';

export type AccessResolution = {
  level: AccessLevel;
  reason: AccessReason;
  /** Plano LOCAL ignora cobrança. */
  ignoreBilling: boolean;
  /** Plano HYBRID combina local + cloud. */
  hybrid: boolean;
};
