import { invalid, notFound } from '../errors.js';
import type {
  CustomerRepository,
  SubscriptionRepository,
  TenantRepository,
} from '../ports/repositories.js';
import type { MasterId, MasterSubscription, MasterSubscriptionStatus } from '../types.js';
import { newMasterId, nowIso } from '../utils.js';

export type CreateSubscriptionInput = {
  tenantId: MasterId;
  planCode: string;
  status?: MasterSubscriptionStatus;
  seats?: number | null;
  startsAt?: string;
  endsAt?: string | null;
  meta?: Record<string, unknown>;
};

/**
 * SubscriptionService (legado Fase 8) — @deprecated wrapper.
 *
 * Serviço oficial de ciclo de vida: subscriptions/subscription.service.ts
 * (renew / suspend / cancel / reactivate / block).
 * Este arquivo mantém o contrato MasterSubscription para createMasterServices.
 */
export class SubscriptionService {
  constructor(
    private readonly subscriptions: SubscriptionRepository,
    private readonly tenants: TenantRepository,
    private readonly customers: CustomerRepository,
  ) {}

  async create(input: CreateSubscriptionInput): Promise<MasterSubscription> {
    const tenant = await this.tenants.findById(input.tenantId);
    if (!tenant) throw notFound('tenant', input.tenantId);
    const customer = await this.customers.findById(tenant.customerId);
    if (!customer) throw notFound('customer', tenant.customerId);
    const planCode = String(input.planCode || '').trim();
    if (!planCode) throw invalid('planCode is required');
    const now = nowIso();
    const row: MasterSubscription = {
      id: newMasterId(),
      tenantId: tenant.id,
      customerId: customer.id,
      planCode,
      status: input.status ?? 'trialing',
      seats: input.seats ?? null,
      startsAt: input.startsAt ?? now,
      endsAt: input.endsAt ?? null,
      createdAt: now,
      updatedAt: now,
      meta: input.meta,
    };
    return this.subscriptions.save(row);
  }

  async get(id: MasterId): Promise<MasterSubscription> {
    const row = await this.subscriptions.findById(id);
    if (!row) throw notFound('subscription', id);
    return row;
  }

  async setStatus(id: MasterId, status: MasterSubscriptionStatus): Promise<MasterSubscription> {
    const current = await this.get(id);
    current.status = status;
    current.updatedAt = nowIso();
    return this.subscriptions.save(current);
  }

  async cancel(id: MasterId): Promise<MasterSubscription> {
    return this.setStatus(id, 'cancelled');
  }

  async listByTenant(tenantId: MasterId): Promise<MasterSubscription[]> {
    return this.subscriptions.listByTenant(tenantId);
  }

  async list(): Promise<MasterSubscription[]> {
    return this.subscriptions.list();
  }
}
