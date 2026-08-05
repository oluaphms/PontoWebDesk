/**
 * MasterSubscriptionsService — fachada comercial de assinaturas.
 * Adapters InMemory; preparado para store futuro. Sem pagamento.
 */
import { SubscriptionService } from './subscription.service.js';
import type { SubscriptionEntity } from './subscription.entity.js';
import type {
  CreateSubscriptionInput,
  RenewSubscriptionInput,
  SubscriptionPeriodicity,
  SubscriptionProps,
  SubscriptionSituacao,
} from './subscription.types.js';
import { PERIODICITY_LABEL } from './subscription.types.js';
import type { SubscriptionRepository } from './subscription.repository.js';
import { InMemorySubscriptionRepository } from './subscription.repository.js';

export type MasterSubscriptionView = SubscriptionProps & {
  empresa: string;
  /** Situação PT */
  situacao: SubscriptionSituacao;
  /** Labels comerciais */
  plano: string;
  valorCents: number;
  valorLabel: string;
  vencimento: string | null;
  periodicidade: SubscriptionPeriodicity;
  periodicidadeLabel: string;
  renovacao: string | null;
  suspensao: string | null;
  expiracao: string | null;
  diasRestantes: number | null;
  emGrace: boolean;
  bloqueio: boolean;
  paymentIntegrated: false;
};

function daysRemaining(expiresAt: string | null, now = Date.now()): number | null {
  if (!expiresAt) return null;
  const exp = Date.parse(expiresAt);
  if (!Number.isFinite(exp)) return null;
  return Math.ceil((exp - now) / 86_400_000);
}

function formatMoney(cents: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format((cents || 0) / 100);
}

export class MasterSubscriptionsService {
  private readonly lifecycle: SubscriptionService;

  constructor(repo?: SubscriptionRepository) {
    this.lifecycle = new SubscriptionService(repo ?? new InMemorySubscriptionRepository());
  }

  static createInMemory(): MasterSubscriptionsService {
    return new MasterSubscriptionsService(new InMemorySubscriptionRepository());
  }

  getLifecycle(): SubscriptionService {
    return this.lifecycle;
  }

  async list(): Promise<SubscriptionEntity[]> {
    return this.lifecycle.list();
  }

  async get(id: string): Promise<SubscriptionEntity> {
    return this.lifecycle.get(id);
  }

  async create(input: CreateSubscriptionInput): Promise<SubscriptionEntity> {
    return this.lifecycle.createSubscription(input);
  }

  async renew(id: string, input?: RenewSubscriptionInput): Promise<SubscriptionEntity> {
    return this.lifecycle.renew(id, input);
  }

  async suspend(id: string): Promise<SubscriptionEntity> {
    return this.lifecycle.pause(id);
  }

  async block(id: string): Promise<SubscriptionEntity> {
    return this.lifecycle.block(id);
  }

  async unblock(id: string): Promise<SubscriptionEntity> {
    return this.lifecycle.unblock(id);
  }

  async cancel(id: string): Promise<SubscriptionEntity> {
    return this.lifecycle.cancel(id);
  }

  async expire(id: string): Promise<SubscriptionEntity> {
    return this.lifecycle.markExpired(id);
  }

  toCommercialView(
    entity: SubscriptionEntity,
    empresa: string,
    now = Date.now(),
  ): MasterSubscriptionView {
    const props = entity.toProps();
    const situacao = entity.resolveSituacao(now);
    return {
      ...props,
      empresa,
      situacao,
      plano: props.plan,
      valorCents: props.amountCents,
      valorLabel: formatMoney(props.amountCents),
      vencimento: props.expiresAt,
      periodicidade: props.periodicity,
      periodicidadeLabel: PERIODICITY_LABEL[props.periodicity] || props.periodicity,
      renovacao: props.renewedAt || props.nextBilling,
      suspensao: props.suspendedAt || props.pausedAt,
      expiracao: props.expiresAt,
      diasRestantes: daysRemaining(props.expiresAt, now),
      emGrace: entity.isInGracePeriod(now),
      bloqueio: props.status === 'SUSPENDED' || situacao === 'Bloqueada',
      paymentIntegrated: false,
    };
  }
}
