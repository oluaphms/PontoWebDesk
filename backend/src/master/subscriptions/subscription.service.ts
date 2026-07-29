/**
 * SubscriptionService — ciclo de vida da assinatura Master.
 * Arquitetura only: sem gateway de pagamento. Sem banco (InMemory).
 *
 * Regra: cada empresa (tenantId) possui no máximo uma assinatura não-cancelada.
 */
import { randomUUID } from 'node:crypto';
import { conflict, invalid, notFound } from '../errors.js';
import { SubscriptionEntity } from './subscription.entity.js';
import type { SubscriptionRepository } from './subscription.repository.js';
import { InMemorySubscriptionRepository } from './subscription.repository.js';
import type {
  CreateSubscriptionInput,
  LicensePlan,
  RenewSubscriptionInput,
  SubscriptionId,
  SubscriptionPeriodicity,
  SubscriptionStatus,
} from './subscription.types.js';
import {
  LICENSE_PLANS,
  PERIODICITY_LABEL,
  PLAN_DEFAULT_AMOUNT_CENTS,
  PLAN_DEFAULT_PERIODICITY,
} from './subscription.types.js';
import { calculateSubscriptionExpiresAt } from './subscriptionPeriodCalculator.js';

function nowIso(now = Date.now()): string {
  return new Date(now).toISOString();
}

function addDaysIso(fromIso: string, days: number): string {
  const t = Date.parse(fromIso);
  if (!Number.isFinite(t)) throw invalid(`invalid date: ${fromIso}`);
  return new Date(t + days * 86_400_000).toISOString();
}

function assertPlan(plan: LicensePlan): void {
  if (!LICENSE_PLANS.includes(plan)) {
    throw invalid(`invalid LicensePlan: ${String(plan)}`);
  }
}

function defaultStatusForPlan(plan: LicensePlan): SubscriptionStatus {
  if (plan === 'TRIAL' || plan === 'FREE') return 'TRIAL';
  return 'ACTIVE';
}

/** expires_at padrão SaaS: calendário. durationDays explícito = override admin/teste. */
function resolveSubscriptionExpiresAt(input: {
  startsAt: string;
  periodicity: SubscriptionPeriodicity;
  plan: LicensePlan;
  expiresAt?: string | null;
  durationDays?: number;
}): string | null {
  if (input.expiresAt !== undefined) return input.expiresAt;
  if (input.durationDays != null) {
    return addDaysIso(input.startsAt, Math.max(0, Math.floor(input.durationDays)));
  }
  // Trials/FREE: período curto alinhado à regra comercial de trial (não ciclo SaaS pago).
  if (input.plan === 'TRIAL' || input.plan === 'FREE') {
    return addDaysIso(input.startsAt, 14);
  }
  return calculateSubscriptionExpiresAt(input.startsAt, input.periodicity);
}

export class SubscriptionService {
  constructor(private readonly repo: SubscriptionRepository) {}

  static createInMemory(): SubscriptionService {
    return new SubscriptionService(new InMemorySubscriptionRepository());
  }

  async createSubscription(input: CreateSubscriptionInput): Promise<SubscriptionEntity> {
    assertPlan(input.plan);
    const tenantId = String(input.tenantId || '').trim();
    const customerId = String(input.customerId || '').trim();
    if (!tenantId) throw invalid('tenantId is required');
    if (!customerId) throw invalid('customerId is required');

    const existing = await this.findCurrentByTenant(tenantId);
    if (existing) {
      throw conflict(`tenant already has a subscription: ${existing.id}`);
    }

    const periodicity: SubscriptionPeriodicity =
      input.periodicity ?? PLAN_DEFAULT_PERIODICITY[input.plan];
    const amountCents =
      input.amountCents !== undefined
        ? Math.max(0, Math.floor(input.amountCents))
        : PLAN_DEFAULT_AMOUNT_CENTS[input.plan];

    const startsAt = input.startsAt ?? nowIso();
    const expiresAt = resolveSubscriptionExpiresAt({
      startsAt,
      periodicity,
      plan: input.plan,
      expiresAt: input.expiresAt,
      durationDays: input.durationDays,
    });
    const graceDays = input.graceDays ?? 0;
    const graceUntil =
      input.graceUntil !== undefined
        ? input.graceUntil
        : expiresAt && graceDays > 0
          ? addDaysIso(expiresAt, graceDays)
          : null;
    const nextBilling =
      input.nextBilling !== undefined
        ? input.nextBilling
        : periodicity === 'once' || input.plan === 'FREE' || input.plan === 'TRIAL'
          ? null
          : expiresAt;

    const status = input.status ?? defaultStatusForPlan(input.plan);
    const createdAt = nowIso();
    const entity = SubscriptionEntity.fromProps({
      id: randomUUID(),
      tenantId,
      customerId,
      plan: input.plan,
      status,
      amountCents,
      periodicity,
      startsAt,
      expiresAt,
      nextBilling,
      graceUntil,
      renewedAt: null,
      suspendedAt: null,
      createdAt,
      updatedAt: createdAt,
      cancelledAt: null,
      pausedAt: null,
      meta: {
        ...input.meta,
        paymentGateway: null,
        paymentIntegrated: false,
        periodicityLabel: PERIODICITY_LABEL[periodicity],
        note: 'architecture_only_no_payment_gateway',
      },
    });
    return this.repo.save(entity);
  }

  /** Assinatura vigente da empresa (não cancelada). */
  async findCurrentByTenant(tenantId: string): Promise<SubscriptionEntity | null> {
    const rows = await this.repo.listByTenant(tenantId);
    const active = rows.filter((s) => s.status !== 'CANCELLED');
    return active[0] ?? null;
  }

  async get(id: SubscriptionId): Promise<SubscriptionEntity> {
    const row = await this.repo.findById(id);
    if (!row) throw notFound('subscription', id);
    return row;
  }

  async cancel(id: SubscriptionId): Promise<SubscriptionEntity> {
    const current = await this.get(id);
    if (current.status === 'CANCELLED') throw conflict('subscription already cancelled');
    const updated = current.withStatus('CANCELLED', nowIso());
    return this.repo.save(updated);
  }

  async pause(id: SubscriptionId): Promise<SubscriptionEntity> {
    const current = await this.get(id);
    if (current.status === 'CANCELLED') throw conflict('cannot pause cancelled subscription');
    if (current.status === 'PAUSED') throw conflict('subscription already paused');
    const updated = current.withStatus('PAUSED', nowIso());
    return this.repo.save(updated);
  }

  async resume(id: SubscriptionId): Promise<SubscriptionEntity> {
    const current = await this.get(id);
    if (current.status === 'EXPIRED') {
      return this.renew(id);
    }
    if (current.status !== 'PAUSED' && current.status !== 'SUSPENDED') {
      throw conflict('subscription is not paused/suspended');
    }
    const nextStatus: SubscriptionStatus =
      current.plan === 'TRIAL' || current.plan === 'FREE' ? 'TRIAL' : 'ACTIVE';
    const updated = current.withStatus(nextStatus, nowIso());
    return this.repo.save(updated);
  }

  async reactivate(id: SubscriptionId): Promise<SubscriptionEntity> {
    return this.resume(id);
  }

  async enterGrace(
    id: SubscriptionId,
    input: { graceDays?: number } = {},
  ): Promise<SubscriptionEntity> {
    const current = await this.get(id);
    if (current.status === 'CANCELLED') {
      throw conflict('cannot enter grace on cancelled subscription');
    }
    const graceDays = input.graceDays ?? 7;
    if (graceDays < 1) throw invalid('graceDays must be >= 1');

    const now = Date.now();
    const expiresAt = current.isExpired(now)
      ? current.expiresAt
      : new Date(now - 1_000).toISOString();
    const graceUntil = addDaysIso(nowIso(now), graceDays);
    const updated = current.withDates({
      expiresAt,
      graceUntil,
      updatedAt: nowIso(now),
    });
    return this.repo.save(updated);
  }

  /** Bloqueio administrativo — Situação: Bloqueada. */
  async block(id: SubscriptionId): Promise<SubscriptionEntity> {
    const current = await this.get(id);
    if (current.status === 'CANCELLED') {
      throw conflict('cannot block cancelled subscription');
    }
    if (current.status === 'SUSPENDED') throw conflict('subscription already blocked');
    const updated = current.withStatus('SUSPENDED', nowIso());
    return this.repo.save(updated);
  }

  async unblock(id: SubscriptionId): Promise<SubscriptionEntity> {
    const current = await this.get(id);
    if (current.status !== 'SUSPENDED') {
      throw conflict('subscription is not blocked');
    }
    return this.resume(id);
  }

  /** Renovação do ciclo — sem pagamento. */
  async renew(id: SubscriptionId, input: RenewSubscriptionInput = {}): Promise<SubscriptionEntity> {
    const current = await this.get(id);
    if (current.status === 'CANCELLED') throw conflict('cannot renew cancelled subscription');

    const now = Date.now();
    const baseIso =
      current.expiresAt && Date.parse(current.expiresAt) > now
        ? current.expiresAt
        : nowIso(now);
    // durationDays explícito = override admin/teste; senão ciclo calendário SaaS.
    const expiresAt =
      input.durationDays != null
        ? addDaysIso(baseIso, Math.max(0, Math.floor(input.durationDays)))
        : current.plan === 'TRIAL' || current.plan === 'FREE'
          ? addDaysIso(baseIso, 14)
          : calculateSubscriptionExpiresAt(baseIso, current.periodicity);
    const graceDays = input.graceDays ?? 0;
    const graceUntil = graceDays > 0 ? addDaysIso(expiresAt, graceDays) : null;
    const nextBilling =
      input.nextBilling !== undefined
        ? input.nextBilling
        : current.periodicity === 'once'
          ? null
          : expiresAt;

    const status: SubscriptionStatus =
      current.plan === 'TRIAL' || current.plan === 'FREE' ? 'TRIAL' : 'ACTIVE';

    const updated = current.withDates({
      expiresAt,
      nextBilling,
      graceUntil,
      renewedAt: nowIso(now),
      suspendedAt: null,
      status,
      updatedAt: nowIso(now),
    });
    return this.repo.save(updated);
  }

  /** Marca como Expirada (situação). */
  async markExpired(id: SubscriptionId): Promise<SubscriptionEntity> {
    const current = await this.get(id);
    if (current.status === 'CANCELLED') throw conflict('cancelled subscription');
    const updated = current.withStatus('EXPIRED', nowIso());
    return this.repo.save(updated);
  }

  isExpired(entity: SubscriptionEntity, now = Date.now()): boolean {
    return entity.isExpired(now);
  }

  isActive(entity: SubscriptionEntity, now = Date.now()): boolean {
    return entity.isActive(now);
  }

  isInGracePeriod(entity: SubscriptionEntity, now = Date.now()): boolean {
    return entity.isInGracePeriod(now);
  }

  async listByTenant(tenantId: string): Promise<SubscriptionEntity[]> {
    return this.repo.listByTenant(tenantId);
  }

  async list(): Promise<SubscriptionEntity[]> {
    return this.repo.list();
  }

  async save(entity: SubscriptionEntity): Promise<SubscriptionEntity> {
    return this.repo.save(entity);
  }

  async remove(id: SubscriptionId): Promise<boolean> {
    await this.get(id);
    return this.repo.delete(id);
  }
}
