/**
 * LicenseService (Master / Fase 10) — decide features a partir da assinatura.
 *
 * Independente de `backend/src/platform/licenseService.ts` (plataforma).
 * Não altera telas. Sem gateway. Sem banco.
 */
import { SubscriptionEntity } from '../subscriptions/subscription.entity.js';
import type { LicensePlan } from '../subscriptions/subscription.types.js';
import { featuresForPlan } from './license.catalog.js';
import type { LicenseFeature, LicenseFeatureSnapshot } from './license.types.js';
import { LICENSE_FEATURES } from './license.types.js';

export type LicenseServiceContext = {
  /** Assinatura atual do tenant (Fase 9). Null = sem assinatura. */
  subscription: SubscriptionEntity | null;
  /** Bloqueio administrativo (BlockService) — opcional. */
  administrativelyBlocked?: boolean;
  now?: number;
};

export class LicenseService {
  constructor(private readonly ctx: LicenseServiceContext) {}

  static fromSubscription(
    subscription: SubscriptionEntity | null,
    opts?: { administrativelyBlocked?: boolean; now?: number },
  ): LicenseService {
    return new LicenseService({
      subscription,
      administrativelyBlocked: opts?.administrativelyBlocked ?? false,
      now: opts?.now,
    });
  }

  private now(): number {
    return this.ctx.now ?? Date.now();
  }

  private plan(): LicensePlan | null {
    return this.ctx.subscription?.plan ?? null;
  }

  /**
   * Bloqueado se:
   * - bloqueio administrativo
   * - sem assinatura
   * - assinatura não operacionalmente ativa (cancelada/pausada/suspensa/expirada fora da graça)
   */
  isBlocked(): boolean {
    if (this.ctx.administrativelyBlocked) return true;
    const sub = this.ctx.subscription;
    if (!sub) return true;
    return !sub.isActive(this.now());
  }

  /**
   * Dias restantes de trial (ceil).
   * Só aplica a plan/status TRIAL; caso contrário 0.
   * Null expiresAt → null (ilimitado / não aplicável).
   */
  remainingTrialDays(): number | null {
    const sub = this.ctx.subscription;
    if (!sub) return 0;
    const isTrial = sub.plan === 'TRIAL' || sub.status === 'TRIAL';
    if (!isTrial) return 0;
    if (!sub.expiresAt) return null;
    const exp = Date.parse(sub.expiresAt);
    if (!Number.isFinite(exp)) return 0;
    const ms = exp - this.now();
    if (ms <= 0) return 0;
    return Math.ceil(ms / 86_400_000);
  }

  hasFeature(feature: LicenseFeature): boolean {
    if (this.isBlocked()) return false;
    const plan = this.plan();
    if (!plan) return false;
    return featuresForPlan(plan).has(feature);
  }

  /** Pode usar REP / relógios. */
  canUseRep(): boolean {
    return this.hasFeature('rep');
  }

  /** Pode usar o App (shell do produto). */
  canUseApp(): boolean {
    return this.hasFeature('app');
  }

  /** Pode usar a API interna de dados. */
  canUseApi(): boolean {
    return this.hasFeature('api');
  }

  /** Pode usar Dashboard. */
  canUseDashboard(): boolean {
    return this.hasFeature('dashboard');
  }

  /** Pode usar Banco de Horas. */
  canUseBankHours(): boolean {
    return this.hasFeature('bank_hours');
  }

  /** Pode usar Escalas. */
  canUseSchedules(): boolean {
    return this.hasFeature('schedules');
  }

  /** Pode usar Multiempresa. */
  canUseMultiCompany(): boolean {
    return this.hasFeature('multi_company');
  }

  /** Pode usar API externa / integrações. */
  canUseExternalApi(): boolean {
    return this.hasFeature('external_api');
  }

  getSnapshot(): LicenseFeatureSnapshot {
    const out = {} as LicenseFeatureSnapshot;
    for (const f of LICENSE_FEATURES) {
      out[f] = this.hasFeature(f);
    }
    return out;
  }

  getPlan(): LicensePlan | null {
    return this.plan();
  }
}
