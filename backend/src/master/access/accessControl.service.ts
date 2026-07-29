/**
 * AccessControlService (Fase 11) — regras de acesso por status/plano.
 *
 * Não altera Auth. Somente serviço (Master). Sem telas / API pública.
 *
 * Regras:
 * - ACTIVE / TRIAL → acesso total
 * - PENDING_PAYMENT / GRACE → acesso normal
 * - SUSPENDED / CANCELLED → somente login
 * - LOCAL → ignorar cobrança
 * - HYBRID → licença local + cloud
 */
import { featuresForPlan } from '../license/license.catalog.js';
import { LicenseService } from '../license/license.service.js';
import type { LicenseFeature } from '../license/license.types.js';
import { SubscriptionEntity } from '../subscriptions/subscription.entity.js';
import type { AccessLevel, AccessResolution } from './access.types.js';

export type AccessControlContext = {
  subscription: SubscriptionEntity | null;
  /** Assinatura/licença cloud complementar (modo HYBRID). */
  cloudSubscription?: SubscriptionEntity | null;
  administrativelyBlocked?: boolean;
  now?: number;
};

function planHasFeature(subscription: SubscriptionEntity | null, feature: LicenseFeature): boolean {
  if (!subscription) return false;
  return featuresForPlan(subscription.plan).has(feature);
}

export class AccessControlService {
  private readonly cloudLicense: LicenseService | null;

  constructor(private readonly ctx: AccessControlContext) {
    this.cloudLicense = ctx.cloudSubscription
      ? LicenseService.fromSubscription(ctx.cloudSubscription, {
          administrativelyBlocked: false,
          now: ctx.now,
        })
      : null;
  }

  static fromSubscription(
    subscription: SubscriptionEntity | null,
    opts?: Omit<AccessControlContext, 'subscription'>,
  ): AccessControlService {
    return new AccessControlService({ subscription, ...opts });
  }

  private now(): number {
    return this.ctx.now ?? Date.now();
  }

  /** Resolve nível de acesso (sem side-effects). */
  resolve(): AccessResolution {
    if (this.ctx.administrativelyBlocked) {
      return {
        level: 'none',
        reason: 'admin_blocked',
        ignoreBilling: false,
        hybrid: false,
      };
    }

    const sub = this.ctx.subscription;
    if (!sub) {
      return {
        level: 'none',
        reason: 'missing_subscription',
        ignoreBilling: false,
        hybrid: false,
      };
    }

    const ignoreBilling = sub.plan === 'LOCAL';
    const hybrid = sub.plan === 'HYBRID';
    const status = sub.status;
    const now = this.now();

    // LOCAL: ignorar cobrança → PENDING_PAYMENT não degrada acesso
    if (ignoreBilling && status === 'PENDING_PAYMENT') {
      return { level: 'full', reason: 'local_ignore_billing', ignoreBilling, hybrid };
    }

    if (status === 'SUSPENDED') {
      return { level: 'login_only', reason: 'suspended', ignoreBilling, hybrid };
    }
    if (status === 'CANCELLED') {
      return { level: 'login_only', reason: 'cancelled', ignoreBilling, hybrid };
    }
    if (status === 'PAUSED') {
      return { level: 'login_only', reason: 'paused', ignoreBilling, hybrid };
    }

    if (status === 'PENDING_PAYMENT') {
      return { level: 'normal', reason: 'pending_payment', ignoreBilling, hybrid };
    }

    // GRACE: expirada mas ainda em carência
    if (sub.isInGracePeriod(now)) {
      return { level: 'normal', reason: 'grace', ignoreBilling, hybrid };
    }

    if (sub.isExpired(now) && !sub.isInGracePeriod(now)) {
      return { level: 'login_only', reason: 'expired', ignoreBilling, hybrid };
    }

    if (status === 'TRIAL' || sub.plan === 'TRIAL') {
      return { level: 'full', reason: 'trial', ignoreBilling, hybrid };
    }

    if (status === 'ACTIVE') {
      return { level: 'full', reason: 'active', ignoreBilling, hybrid };
    }

    return { level: 'login_only', reason: 'expired', ignoreBilling, hybrid };
  }

  private level(): AccessLevel {
    return this.resolve().level;
  }

  private allowsOperations(): boolean {
    const level = this.level();
    return level === 'full' || level === 'normal';
  }

  /**
   * Login permitido em ACTIVE/TRIAL/PENDING/GRACE/SUSPENDED/CANCELLED.
   * Bloqueio admin / sem assinatura → false.
   */
  canLogin(): boolean {
    const { level } = this.resolve();
    return level === 'full' || level === 'normal' || level === 'login_only';
  }

  /**
   * Módulo do catálogo Master (Fase 10).
   * login_only/none → false.
   * HYBRID: feature se plano local OU cloud liberar.
   */
  canUseModule(module: LicenseFeature): boolean {
    if (!this.allowsOperations()) return false;
    const resolution = this.resolve();
    const localOk = planHasFeature(this.ctx.subscription, module);
    if (resolution.hybrid) {
      const cloudOk = planHasFeature(this.ctx.cloudSubscription ?? null, module);
      return localOk || cloudOk;
    }
    return localOk;
  }

  /** Batida de ponto — operação + rep ou app. */
  canPunch(): boolean {
    if (!this.allowsOperations()) return false;
    return this.canUseModule('rep') || this.canUseModule('app');
  }

  /**
   * Sync:
   * - LOCAL → false (ignora cobrança; sem sync cloud)
   * - HYBRID → operação ok + (cloud presente e operacional, ou assume sync local+cloud)
   * - demais planos cloud-capable → operação ok
   */
  canSync(): boolean {
    if (!this.allowsOperations()) return false;
    const sub = this.ctx.subscription;
    if (!sub) return false;
    if (sub.plan === 'LOCAL') return false;

    if (sub.plan === 'HYBRID') {
      if (!this.ctx.cloudSubscription) return true; // híbrido sem cloud explícita: segue licença local
      const cloud = this.cloudLicense;
      if (!cloud) return true;
      // Cloud também precisa permitir operação (não suspensa/cancelada)
      const cloudAccess = AccessControlService.fromSubscription(this.ctx.cloudSubscription, {
        now: this.ctx.now,
      });
      return cloudAccess.allowsOperations();
    }

    return (
      sub.plan === 'TRIAL' ||
      sub.plan === 'FREE' ||
      sub.plan === 'STARTER' ||
      sub.plan === 'PRO' ||
      sub.plan === 'ENTERPRISE'
    );
  }

  /** API de dados — operação + feature api. */
  canAccessApi(): boolean {
    if (!this.allowsOperations()) return false;
    return this.canUseModule('api');
  }
}
