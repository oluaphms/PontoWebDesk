/**
 * Entidade de assinatura — regras de estado/tempo (sem I/O).
 * Sem gateway de pagamento.
 */
import type {
  LicensePlan,
  SubscriptionPeriodicity,
  SubscriptionProps,
  SubscriptionSituacao,
  SubscriptionStatus,
} from './subscription.types.js';

function parseTime(iso: string | null | undefined): number | null {
  if (iso == null || String(iso).trim() === '') return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

function normalizeProps(props: SubscriptionProps): SubscriptionProps {
  return {
    ...props,
    amountCents: Number.isFinite(props.amountCents) ? props.amountCents : 0,
    periodicity: props.periodicity || 'monthly',
    renewedAt: props.renewedAt ?? null,
    suspendedAt: props.suspendedAt ?? null,
    meta: props.meta ? { ...props.meta } : undefined,
  };
}

export class SubscriptionEntity {
  constructor(private readonly props: SubscriptionProps) {}

  static fromProps(props: SubscriptionProps): SubscriptionEntity {
    return new SubscriptionEntity(normalizeProps(props));
  }

  toProps(): SubscriptionProps {
    return normalizeProps(this.props);
  }

  get id(): string {
    return this.props.id;
  }

  get tenantId(): string {
    return this.props.tenantId;
  }

  get customerId(): string {
    return this.props.customerId;
  }

  get plan(): LicensePlan {
    return this.props.plan;
  }

  get status(): SubscriptionStatus {
    return this.props.status;
  }

  get amountCents(): number {
    return this.props.amountCents;
  }

  get periodicity(): SubscriptionPeriodicity {
    return this.props.periodicity;
  }

  get startsAt(): string {
    return this.props.startsAt;
  }

  get expiresAt(): string | null {
    return this.props.expiresAt;
  }

  get nextBilling(): string | null {
    return this.props.nextBilling;
  }

  get graceUntil(): string | null {
    return this.props.graceUntil;
  }

  get renewedAt(): string | null {
    return this.props.renewedAt;
  }

  get suspendedAt(): string | null {
    return this.props.suspendedAt;
  }

  /** Expirada se expiresAt < now (ignora grace). */
  isExpired(now = Date.now()): boolean {
    if (this.props.status === 'EXPIRED') return true;
    const exp = parseTime(this.props.expiresAt);
    if (exp == null) return false;
    return exp < now;
  }

  /** Em período de graça: expirada mas graceUntil >= now. */
  isInGracePeriod(now = Date.now()): boolean {
    if (!this.isExpired(now)) return false;
    const grace = parseTime(this.props.graceUntil);
    if (grace == null) return false;
    return grace >= now;
  }

  /**
   * Ativa operacionalmente:
   * - status ACTIVE ou TRIAL
   * - não CANCELLED / PAUSED / SUSPENDED / PENDING_PAYMENT / EXPIRED
   * - não expirada, ou ainda em grace
   */
  isActive(now = Date.now()): boolean {
    const s = this.props.status;
    if (
      s === 'CANCELLED' ||
      s === 'PAUSED' ||
      s === 'SUSPENDED' ||
      s === 'PENDING_PAYMENT' ||
      s === 'EXPIRED'
    ) {
      return false;
    }
    if (s !== 'ACTIVE' && s !== 'TRIAL') return false;
    if (!this.isExpired(now)) return true;
    return this.isInGracePeriod(now);
  }

  /**
   * Situação comercial (PT) — Trial | Ativa | Pendente | Expirada | Bloqueada | Cancelada.
   */
  resolveSituacao(now = Date.now()): SubscriptionSituacao {
    const s = this.props.status;
    if (s === 'CANCELLED') return 'Cancelada';
    if (s === 'SUSPENDED') return 'Bloqueada';
    if (s === 'EXPIRED') return 'Expirada';
    if (s === 'PENDING_PAYMENT' || s === 'PAUSED') return 'Pendente';
    if (this.isExpired(now) && !this.isInGracePeriod(now)) return 'Expirada';
    if (s === 'TRIAL') return 'Trial';
    if (s === 'ACTIVE') return 'Ativa';
    return 'Pendente';
  }

  withStatus(status: SubscriptionStatus, updatedAt: string): SubscriptionEntity {
    return SubscriptionEntity.fromProps({
      ...this.props,
      status,
      updatedAt,
      cancelledAt: status === 'CANCELLED' ? updatedAt : this.props.cancelledAt,
      pausedAt: status === 'PAUSED' ? updatedAt : this.props.pausedAt,
      suspendedAt:
        status === 'SUSPENDED'
          ? updatedAt
          : status === 'ACTIVE' || status === 'TRIAL'
            ? null
            : this.props.suspendedAt,
    });
  }

  withDates(partial: {
    expiresAt?: string | null;
    nextBilling?: string | null;
    graceUntil?: string | null;
    renewedAt?: string | null;
    suspendedAt?: string | null;
    amountCents?: number;
    periodicity?: SubscriptionPeriodicity;
    updatedAt: string;
    status?: SubscriptionStatus;
  }): SubscriptionEntity {
    return SubscriptionEntity.fromProps({
      ...this.props,
      expiresAt: partial.expiresAt !== undefined ? partial.expiresAt : this.props.expiresAt,
      nextBilling:
        partial.nextBilling !== undefined ? partial.nextBilling : this.props.nextBilling,
      graceUntil: partial.graceUntil !== undefined ? partial.graceUntil : this.props.graceUntil,
      renewedAt: partial.renewedAt !== undefined ? partial.renewedAt : this.props.renewedAt,
      suspendedAt:
        partial.suspendedAt !== undefined ? partial.suspendedAt : this.props.suspendedAt,
      amountCents:
        partial.amountCents !== undefined ? partial.amountCents : this.props.amountCents,
      periodicity:
        partial.periodicity !== undefined ? partial.periodicity : this.props.periodicity,
      status: partial.status ?? this.props.status,
      updatedAt: partial.updatedAt,
    });
  }
}
