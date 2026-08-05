/**
 * Módulo Assinaturas do Master Dashboard (Fase 9 lifecycle + Fase 24 ações).
 */
import type { SubscriptionService as SubscriptionLifecycleService } from '../../subscriptions/subscription.service.js';
import type { SubscriptionEntity } from '../../subscriptions/subscription.entity.js';
import type {
  CreateSubscriptionInput,
  LicensePlan,
} from '../../subscriptions/subscription.types.js';
import type { DashboardLogsModule } from './logs.module.js';

export class SubscriptionsModule {
  constructor(
    private readonly lifecycle: SubscriptionLifecycleService,
    private readonly logs: DashboardLogsModule,
  ) {}

  /** Acesso direto ao SubscriptionService (ciclo de vida). */
  getService(): SubscriptionLifecycleService {
    return this.lifecycle;
  }

  async list(): Promise<SubscriptionEntity[]> {
    return this.lifecycle.list();
  }

  async listByTenant(tenantId: string): Promise<SubscriptionEntity[]> {
    return this.lifecycle.listByTenant(tenantId);
  }

  async get(id: string): Promise<SubscriptionEntity> {
    return this.lifecycle.get(id);
  }

  async create(input: CreateSubscriptionInput): Promise<SubscriptionEntity> {
    const row = await this.lifecycle.createSubscription(input);
    await this.logs.append({
      module: 'subscriptions',
      action: 'SUBSCRIPTION_CREATED',
      message: `Assinatura ${row.plan} criada`,
      meta: { subscriptionId: row.id, plan: row.plan },
    });
    return row;
  }

  async pause(id: string): Promise<SubscriptionEntity> {
    const row = await this.lifecycle.pause(id);
    await this.logs.append({
      module: 'subscriptions',
      action: 'SUBSCRIPTION_PAUSED',
      message: 'Assinatura pausada',
      meta: { subscriptionId: id },
    });
    return row;
  }

  async cancel(id: string): Promise<SubscriptionEntity> {
    const row = await this.lifecycle.cancel(id);
    await this.logs.append({
      module: 'subscriptions',
      action: 'SUBSCRIPTION_CANCELLED',
      message: 'Assinatura cancelada',
      meta: { subscriptionId: id },
    });
    return row;
  }

  async reactivate(id: string): Promise<SubscriptionEntity> {
    const row = await this.lifecycle.reactivate(id);
    await this.logs.append({
      module: 'subscriptions',
      action: 'SUBSCRIPTION_REACTIVATED',
      message: 'Assinatura reativada',
      meta: { subscriptionId: id },
    });
    return row;
  }

  async enterGrace(id: string, graceDays?: number): Promise<SubscriptionEntity> {
    const row = await this.lifecycle.enterGrace(id, { graceDays });
    await this.logs.append({
      module: 'subscriptions',
      action: 'SUBSCRIPTION_ENTER_GRACE',
      message: `Assinatura em grace (${graceDays ?? 7}d)`,
      meta: { subscriptionId: id, graceDays: graceDays ?? 7 },
    });
    return row;
  }

  async block(id: string): Promise<SubscriptionEntity> {
    const row = await this.lifecycle.block(id);
    await this.logs.append({
      module: 'subscriptions',
      action: 'SUBSCRIPTION_BLOCKED',
      message: 'Assinatura bloqueada',
      meta: { subscriptionId: id },
    });
    return row;
  }

  async unblock(id: string): Promise<SubscriptionEntity> {
    const row = await this.lifecycle.unblock(id);
    await this.logs.append({
      module: 'subscriptions',
      action: 'SUBSCRIPTION_UNBLOCKED',
      message: 'Assinatura desbloqueada',
      meta: { subscriptionId: id },
    });
    return row;
  }

  async renew(id: string, durationDays?: number): Promise<SubscriptionEntity> {
    const row = await this.lifecycle.renew(id, { durationDays });
    await this.logs.append({
      module: 'subscriptions',
      action: 'SUBSCRIPTION_RENEWED',
      message: 'Assinatura renovada (sem pagamento)',
      meta: { subscriptionId: id, durationDays: durationDays ?? null },
    });
    return row;
  }

  async expire(id: string): Promise<SubscriptionEntity> {
    const row = await this.lifecycle.markExpired(id);
    await this.logs.append({
      module: 'subscriptions',
      action: 'SUBSCRIPTION_EXPIRED',
      message: 'Assinatura marcada como expirada',
      meta: { subscriptionId: id },
    });
    return row;
  }

  async count(): Promise<number> {
    return (await this.list()).length;
  }

  async countByPlan(plan: LicensePlan): Promise<number> {
    return (await this.list()).filter((s) => s.plan === plan).length;
  }
}
