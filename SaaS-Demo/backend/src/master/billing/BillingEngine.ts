/**
 * BillingEngine — @deprecated compat (máquina de estados de assinatura/cobrança).
 *
 * Implementação oficial de invoices/payments/PIX: DecoupledBillingEngine.
 * Este engine permanece para ChargesModule / renew-grace-block e compartilha
 * o SubscriptionLifecycle do MasterRepositoryRegistry.
 *
 * Sem banco. Sem gateway de pagamento.
 */
import { randomUUID } from 'node:crypto';
import { conflict, invalid } from '../errors.js';
import { SubscriptionService } from '../subscriptions/subscription.service.js';
import type { SubscriptionEntity } from '../subscriptions/subscription.entity.js';
import type { SubscriptionId } from '../subscriptions/subscription.types.js';
import {
  assertTransition,
  mapBillingStateToSubscriptionStatus,
  resolveBillingState,
} from './billing.stateMachine.js';
import type {
  BillingCharge,
  BillingEngineResult,
  BillingState,
  EnterGraceInput,
  GenerateChargeInput,
  RenewBillingInput,
} from './billing.types.js';
import { calculateSubscriptionExpiresAt } from '../subscriptions/subscriptionPeriodCalculator.js';

function nowIso(now = Date.now()): string {
  return new Date(now).toISOString();
}

function addDaysIso(fromIso: string, days: number): string {
  const t = Date.parse(fromIso);
  if (!Number.isFinite(t)) throw invalid(`invalid date: ${fromIso}`);
  return new Date(t + days * 86_400_000).toISOString();
}

export class BillingEngine {
  private readonly charges = new Map<string, BillingCharge[]>();

  constructor(
    private readonly subscriptions: SubscriptionService,
    private readonly clock: () => number = () => Date.now(),
  ) {}

  static createInMemory(): BillingEngine {
    return new BillingEngine(SubscriptionService.createInMemory());
  }

  getSubscriptionService(): SubscriptionService {
    return this.subscriptions;
  }

  async getState(subscriptionId: SubscriptionId): Promise<BillingState> {
    const sub = await this.subscriptions.get(subscriptionId);
    return resolveBillingState(sub, this.clock());
  }

  /** Renovar assinatura. */
  async renew(
    subscriptionId: SubscriptionId,
    input: RenewBillingInput = {},
  ): Promise<BillingEngineResult> {
    const sub = await this.subscriptions.get(subscriptionId);
    const previousState = resolveBillingState(sub, this.clock());
    assertTransition(previousState, 'renew');

    const renewed = await this.subscriptions.renew(subscriptionId, {
      durationDays: input.durationDays,
      graceDays: input.graceDays ?? 0,
    });

    return {
      state: resolveBillingState(renewed, this.clock()),
      previousState,
      transition: 'renew',
      subscriptionId,
      charge: null,
    };
  }

  /** Gera próxima cobrança → PENDING_PAYMENT (LOCAL ignora). */
  async generateNextCharge(
    subscriptionId: SubscriptionId,
    input: GenerateChargeInput,
  ): Promise<BillingEngineResult> {
    if (!Number.isFinite(input.amountCents) || input.amountCents < 0) {
      throw invalid('amountCents must be >= 0');
    }
    const sub = await this.subscriptions.get(subscriptionId);
    if (sub.plan === 'LOCAL') {
      throw conflict('LOCAL plan ignores billing charges');
    }

    const previousState = resolveBillingState(sub, this.clock());
    assertTransition(previousState, 'generate_next_charge');

    const now = this.clock();
    const dueInDays = input.dueInDays ?? 0;
    const dueAt = addDaysIso(nowIso(now), dueInDays);

    const charge: BillingCharge = {
      id: `chg_${randomUUID().replace(/-/g, '').slice(0, 16)}`,
      subscriptionId,
      amountCents: Math.floor(input.amountCents),
      currency: (input.currency || 'BRL').toUpperCase(),
      status: 'open',
      dueAt,
      createdAt: nowIso(now),
      paidAt: null,
      periodStart: sub.expiresAt,
      periodEnd: sub.expiresAt
        ? calculateSubscriptionExpiresAt(sub.expiresAt, sub.periodicity)
        : null,
      meta: { source: 'billing_engine', gateway: null },
    };
    this.pushCharge(charge);

    const updated = sub.withDates({
      nextBilling: dueAt,
      updatedAt: nowIso(now),
      status: 'PENDING_PAYMENT',
    });
    const saved = await this.subscriptions.save(updated);

    return {
      state: resolveBillingState(saved, this.clock()),
      previousState,
      transition: 'generate_next_charge',
      subscriptionId,
      charge,
    };
  }

  /** Entra em período de graça. */
  async enterGracePeriod(
    subscriptionId: SubscriptionId,
    input: EnterGraceInput = {},
  ): Promise<BillingEngineResult> {
    const sub = await this.subscriptions.get(subscriptionId);
    const previousState = resolveBillingState(sub, this.clock());
    assertTransition(previousState, 'enter_grace');

    const graceDays = input.graceDays ?? 7;
    if (graceDays <= 0) throw invalid('graceDays must be > 0');

    const now = this.clock();
    // Antecipa expiração para o passado imediato → isInGracePeriod() verdadeiro.
    const expiresAt =
      sub.expiresAt && Date.parse(sub.expiresAt) < now
        ? sub.expiresAt
        : new Date(now - 1_000).toISOString();
    const graceUntil = addDaysIso(nowIso(now), graceDays);

    const updated = sub.withDates({
      expiresAt,
      graceUntil,
      updatedAt: nowIso(now),
      status: mapBillingStateToSubscriptionStatus('GRACE'),
    });
    const saved = await this.subscriptions.save(updated);

    return {
      state: resolveBillingState(saved, this.clock()),
      previousState,
      transition: 'enter_grace',
      subscriptionId,
      charge: null,
    };
  }

  /** Bloqueia assinatura (SUSPENDED). */
  async blockSubscription(subscriptionId: SubscriptionId): Promise<BillingEngineResult> {
    const sub = await this.subscriptions.get(subscriptionId);
    const previousState = resolveBillingState(sub, this.clock());
    const nextState = assertTransition(previousState, 'block');
    const saved = await this.subscriptions.save(
      sub.withStatus(mapBillingStateToSubscriptionStatus(nextState), nowIso(this.clock())),
    );
    return {
      state: resolveBillingState(saved, this.clock()),
      previousState,
      transition: 'block',
      subscriptionId,
      charge: null,
    };
  }

  /** Reativa assinatura. */
  async reactivateSubscription(subscriptionId: SubscriptionId): Promise<BillingEngineResult> {
    const sub = await this.subscriptions.get(subscriptionId);
    const previousState = resolveBillingState(sub, this.clock());
    const nextState = assertTransition(previousState, 'reactivate');
    const now = this.clock();

    let entity: SubscriptionEntity;
    if (sub.isExpired(now) && !sub.isInGracePeriod(now)) {
      const nextExpires = calculateSubscriptionExpiresAt(nowIso(now), sub.periodicity);
      entity = sub.withDates({
        expiresAt: nextExpires,
        graceUntil: null,
        nextBilling: nextExpires,
        updatedAt: nowIso(now),
        status:
          sub.plan === 'TRIAL' || sub.plan === 'FREE'
            ? 'TRIAL'
            : mapBillingStateToSubscriptionStatus(nextState),
      });
    } else {
      const status =
        sub.plan === 'TRIAL' || sub.plan === 'FREE'
          ? 'TRIAL'
          : mapBillingStateToSubscriptionStatus(nextState);
      entity = sub
        .withDates({
          graceUntil: null,
          updatedAt: nowIso(now),
          status,
        })
        .withStatus(status, nowIso(now));
    }

    const saved = await this.subscriptions.save(entity);
    return {
      state: resolveBillingState(saved, this.clock()),
      previousState,
      transition: 'reactivate',
      subscriptionId,
      charge: null,
    };
  }

  async listCharges(subscriptionId: SubscriptionId): Promise<BillingCharge[]> {
    return (this.charges.get(subscriptionId) ?? []).map((c) => ({ ...c }));
  }

  /** Lista todas as cobranças do engine (InMemory / restauradas do PG). */
  async listAllCharges(): Promise<BillingCharge[]> {
    const all: BillingCharge[] = [];
    for (const list of this.charges.values()) {
      for (const c of list) all.push({ ...c });
    }
    return all.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  }

  /**
   * Restaura cobranças após hydrate do store PG (dual-write).
   * Substitui o Map em memória — usado só no boot / testes.
   */
  restoreCharges(charges: BillingCharge[]): void {
    this.charges.clear();
    for (const charge of charges) {
      this.pushCharge({ ...charge, meta: charge.meta ? { ...charge.meta } : undefined });
    }
  }

  /** Marca cobrança como paga localmente — sem captura Asaas/PIX. */
  async markChargePaid(chargeId: string): Promise<BillingCharge> {
    for (const [subscriptionId, list] of this.charges.entries()) {
      const idx = list.findIndex((c) => c.id === chargeId);
      if (idx < 0) continue;
      const current = list[idx];
      if (current.status === 'paid') throw conflict('charge already paid');
      if (current.status === 'void') throw conflict('cannot pay void charge');
      const updated: BillingCharge = {
        ...current,
        status: 'paid',
        paidAt: nowIso(this.clock()),
        meta: {
          ...current.meta,
          paidLocally: true,
          gateway: null,
          asaas: { ready: false, note: 'local_mark_paid_no_asaas' },
        },
      };
      list[idx] = updated;
      this.charges.set(subscriptionId, list);
      return { ...updated };
    }
    throw invalid(`charge not found: ${chargeId}`);
  }

  private pushCharge(charge: BillingCharge): void {
    const list = this.charges.get(charge.subscriptionId) ?? [];
    list.push(charge);
    this.charges.set(charge.subscriptionId, list);
  }
}
