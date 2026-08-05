/**
 * MasterSubscriptionsRepository — persistência PostgreSQL do lifecycle.
 * Implementa SubscriptionRepository. InMemory permanece para testes.
 */
import { SubscriptionEntity } from '../../subscriptions/subscription.entity.js';
import type { SubscriptionRepository } from '../../subscriptions/subscription.repository.js';
import type {
  SubscriptionId,
  SubscriptionProps,
  SubscriptionTenantId,
} from '../../subscriptions/subscription.types.js';
import {
  asJson,
  jsonParam,
  masterSql,
  toIso,
  toIsoRequired,
  type MasterSqlQuery,
} from './masterSql.js';

type SubRow = {
  id: string;
  tenant_id: string;
  customer_id: string;
  plan: string;
  status: string;
  periodicity: string;
  amount_cents: string | number;
  starts_at: Date | string;
  expires_at: Date | string | null;
  next_billing: Date | string | null;
  grace_until: Date | string | null;
  renewed_at: Date | string | null;
  suspended_at: Date | string | null;
  cancelled_at: Date | string | null;
  paused_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
  meta: unknown;
};

function mapRow(row: SubRow): SubscriptionEntity {
  const props: SubscriptionProps = {
    id: row.id,
    tenantId: row.tenant_id,
    customerId: row.customer_id,
    plan: row.plan as SubscriptionProps['plan'],
    status: row.status as SubscriptionProps['status'],
    periodicity: row.periodicity as SubscriptionProps['periodicity'],
    amountCents: Number(row.amount_cents) || 0,
    startsAt: toIsoRequired(row.starts_at),
    expiresAt: toIso(row.expires_at),
    nextBilling: toIso(row.next_billing),
    graceUntil: toIso(row.grace_until),
    renewedAt: toIso(row.renewed_at),
    suspendedAt: toIso(row.suspended_at),
    cancelledAt: toIso(row.cancelled_at),
    pausedAt: toIso(row.paused_at),
    createdAt: toIsoRequired(row.created_at),
    updatedAt: toIsoRequired(row.updated_at),
    meta: asJson(row.meta),
  };
  return SubscriptionEntity.fromProps(props);
}

export class MasterSubscriptionsRepository implements SubscriptionRepository {
  constructor(private readonly sql: MasterSqlQuery = masterSql) {}

  async save(entity: SubscriptionEntity): Promise<SubscriptionEntity> {
    const p = entity.toProps();
    const result = await this.sql<SubRow>(
      `INSERT INTO public.master_subscriptions (
         id, tenant_id, customer_id, plan, status, periodicity, amount_cents,
         starts_at, expires_at, next_billing, grace_until,
         renewed_at, suspended_at, cancelled_at, paused_at,
         created_at, updated_at, meta
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,
         $8,$9,$10,$11,
         $12,$13,$14,$15,
         $16,$17,$18::jsonb
       )
       ON CONFLICT (id) DO UPDATE SET
         tenant_id = EXCLUDED.tenant_id,
         customer_id = EXCLUDED.customer_id,
         plan = EXCLUDED.plan,
         status = EXCLUDED.status,
         periodicity = EXCLUDED.periodicity,
         amount_cents = EXCLUDED.amount_cents,
         starts_at = EXCLUDED.starts_at,
         expires_at = EXCLUDED.expires_at,
         next_billing = EXCLUDED.next_billing,
         grace_until = EXCLUDED.grace_until,
         renewed_at = EXCLUDED.renewed_at,
         suspended_at = EXCLUDED.suspended_at,
         cancelled_at = EXCLUDED.cancelled_at,
         paused_at = EXCLUDED.paused_at,
         updated_at = EXCLUDED.updated_at,
         meta = EXCLUDED.meta
       RETURNING *`,
      [
        p.id,
        p.tenantId,
        p.customerId,
        p.plan,
        p.status,
        p.periodicity,
        p.amountCents,
        p.startsAt,
        p.expiresAt,
        p.nextBilling,
        p.graceUntil,
        p.renewedAt,
        p.suspendedAt,
        p.cancelledAt ?? null,
        p.pausedAt ?? null,
        p.createdAt,
        p.updatedAt,
        jsonParam(p.meta ?? {}),
      ],
    );
    return mapRow(result.rows[0]);
  }

  async findById(id: SubscriptionId): Promise<SubscriptionEntity | null> {
    const result = await this.sql<SubRow>(
      `SELECT * FROM public.master_subscriptions WHERE id = $1 LIMIT 1`,
      [id],
    );
    return result.rows[0] ? mapRow(result.rows[0]) : null;
  }

  async listByTenant(tenantId: SubscriptionTenantId): Promise<SubscriptionEntity[]> {
    const result = await this.sql<SubRow>(
      `SELECT * FROM public.master_subscriptions WHERE tenant_id = $1 ORDER BY created_at DESC`,
      [tenantId],
    );
    return result.rows.map(mapRow);
  }

  async list(): Promise<SubscriptionEntity[]> {
    const result = await this.sql<SubRow>(
      `SELECT * FROM public.master_subscriptions ORDER BY created_at DESC`,
    );
    return result.rows.map(mapRow);
  }

  async delete(id: SubscriptionId): Promise<boolean> {
    const result = await this.sql(`DELETE FROM public.master_subscriptions WHERE id = $1`, [id]);
    return (result.rowCount ?? 0) > 0;
  }
}
