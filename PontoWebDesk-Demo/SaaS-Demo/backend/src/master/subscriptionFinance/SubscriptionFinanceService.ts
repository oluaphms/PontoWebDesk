import { randomUUID } from 'node:crypto';
import { asJson, jsonParam, masterSql, toIso, toIsoRequired, type MasterSqlQuery } from '../adapters/postgres/masterSql.js';
import { invalid, notFound } from '../errors.js';
import { calculateSubscriptionExpiresAt } from '../subscriptions/subscriptionPeriodCalculator.js';
import type { SaasPlanCycle } from '../plans/saasPlans.types.js';
import {
  SUBSCRIPTION_FINANCE_STATUSES,
  type CreateSubscriptionPaymentInput,
  type SubscriptionFinanceEntry,
  type SubscriptionFinanceStatus,
  type UpdateSubscriptionPaymentInput,
} from './subscriptionFinance.types.js';

type FinanceRow = {
  id: string;
  subscription_id: string;
  tenant_id: string;
  company_id: string;
  company_name: string;
  kind: string;
  status: string;
  amount_cents: string | number | null;
  currency: string;
  due_at: Date | string | null;
  block_at: Date | string | null;
  paid_at: Date | string | null;
  event_at: Date | string;
  description: string | null;
  source_entry_id: string | null;
  automatic: boolean;
  created_by_master_user_id: string | null;
  created_at: Date | string;
  updated_at: Date | string;
  meta: unknown;
};

type CurrentSubscriptionRow = {
  id: string;
  tenant_id: string;
  company_id: string | null;
  amount_cents: string | number;
  cycle: string;
  company_name: string;
};

function mapEntry(row: FinanceRow): SubscriptionFinanceEntry {
  return {
    id: row.id,
    subscriptionId: row.subscription_id,
    tenantId: row.tenant_id,
    companyId: row.company_id,
    companyName: row.company_name,
    kind: row.kind as SubscriptionFinanceEntry['kind'],
    status: row.status as SubscriptionFinanceStatus,
    amountCents: row.amount_cents == null ? null : Number(row.amount_cents),
    currency: row.currency,
    dueAt: toIso(row.due_at),
    blockAt: toIso(row.block_at),
    paidAt: toIso(row.paid_at),
    eventAt: toIsoRequired(row.event_at),
    description: row.description,
    sourceEntryId: row.source_entry_id,
    automatic: row.automatic === true,
    createdByMasterUserId: row.created_by_master_user_id,
    createdAt: toIsoRequired(row.created_at),
    updatedAt: toIsoRequired(row.updated_at),
    meta: asJson(row.meta) ?? {},
  };
}

function normalizeDate(value: string | null | undefined, field: string): string | null {
  if (value == null || String(value).trim() === '') return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw invalid(`${field} is invalid`);
  return date.toISOString();
}

function positiveAmount(value: unknown, field = 'amountCents'): number {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) throw invalid(`${field} must be > 0`);
  return Math.floor(amount);
}

function assertPaymentStatus(value: unknown): SubscriptionFinanceStatus {
  const status = String(value || '').trim().toUpperCase() as SubscriptionFinanceStatus;
  if (!SUBSCRIPTION_FINANCE_STATUSES.includes(status) || status === 'BLOCKED') {
    throw invalid('invalid payment status');
  }
  return status;
}

function addDays(iso: string, days: number): string {
  return new Date(Date.parse(iso) + days * 86_400_000).toISOString();
}

const FINANCE_SELECT = `
  SELECT e.*, t.company_name
    FROM public.master_subscription_finance_entries e
    JOIN public.master_tenants t ON t.id = e.tenant_id
`;

export class SubscriptionFinanceService {
  constructor(private readonly sql: MasterSqlQuery = masterSql) {}

  private async resolveCurrentSubscription(companyId: string): Promise<CurrentSubscriptionRow> {
    const id = String(companyId || '').trim();
    if (!id) throw invalid('companyId is required');
    const result = await this.sql<CurrentSubscriptionRow>(
      `SELECT s.id, s.tenant_id, s.company_id, s.amount_cents, s.cycle, t.company_name
         FROM public.master_subscriptions s
         JOIN public.master_tenants t ON t.id = s.tenant_id
        WHERE (t.id = $1 OR t.operational_company_id = $1 OR s.company_id = $1)
          AND s.status IN ('TRIAL', 'ACTIVE', 'PAST_DUE', 'SUSPENDED')
        ORDER BY s.created_at DESC
        LIMIT 1`,
      [id],
    );
    if (!result.rows[0]) throw notFound('company subscription', id);
    return result.rows[0];
  }

  async listCompanyTimeline(companyId: string): Promise<SubscriptionFinanceEntry[]> {
    const id = String(companyId || '').trim();
    if (!id) throw invalid('companyId is required');
    const result = await this.sql<FinanceRow>(
      `${FINANCE_SELECT}
        WHERE e.company_id = $1 OR e.tenant_id = $1
        ORDER BY e.event_at DESC, e.created_at DESC`,
      [id],
    );
    return result.rows.map(mapEntry);
  }

  async getEntry(id: string): Promise<SubscriptionFinanceEntry> {
    const result = await this.sql<FinanceRow>(
      `${FINANCE_SELECT} WHERE e.id = $1 LIMIT 1`,
      [String(id || '').trim()],
    );
    if (!result.rows[0]) throw notFound('subscription finance entry', id);
    return mapEntry(result.rows[0]);
  }

  async createPayment(input: CreateSubscriptionPaymentInput): Promise<SubscriptionFinanceEntry> {
    const subscription = await this.resolveCurrentSubscription(input.companyId);
    const dueAt = normalizeDate(input.dueAt, 'dueAt') ?? new Date().toISOString();
    const status = assertPaymentStatus(input.status ?? 'PENDING');
    if (status === 'CANCELLED') throw invalid('new payment cannot be cancelled');
    const paidAt = status === 'PAID'
      ? normalizeDate(input.paidAt, 'paidAt') ?? new Date().toISOString()
      : null;
    const blockAt = status === 'PAID'
      ? null
      : input.blockAt === undefined
        ? addDays(dueAt, 7)
        : normalizeDate(input.blockAt, 'blockAt');
    const amountCents = input.amountCents == null
      ? positiveAmount(subscription.amount_cents)
      : positiveAmount(input.amountCents);
    const companyId = subscription.company_id || subscription.tenant_id;
    const id = `fin_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
    const result = await this.sql<FinanceRow>(
      `INSERT INTO public.master_subscription_finance_entries (
         id, subscription_id, tenant_id, company_id, kind, status,
         amount_cents, currency, due_at, block_at, paid_at, event_at,
         description, automatic, created_by_master_user_id, meta
       ) VALUES (
         $1,$2,$3,$4,'PAYMENT',$5,$6,'BRL',$7,$8,$9,$7,$10,false,$11,$12::jsonb
       )
       RETURNING *, $13::text AS company_name`,
      [
        id,
        subscription.id,
        subscription.tenant_id,
        companyId,
        status,
        amountCents,
        dueAt,
        blockAt,
        paidAt,
        input.description?.trim() || 'Mensalidade da assinatura',
        input.actorUserId ?? null,
        jsonParam({ source: 'fase_6_4' }),
        subscription.company_name,
      ],
    );
    return mapEntry(result.rows[0]);
  }

  async updatePayment(
    id: string,
    input: UpdateSubscriptionPaymentInput,
  ): Promise<{ before: SubscriptionFinanceEntry; after: SubscriptionFinanceEntry }> {
    const before = await this.getEntry(id);
    if (before.kind !== 'PAYMENT') throw invalid('automatic block entries cannot be edited');
    if (input.status === 'PAID') throw invalid('use markPaid to register payment');
    const status = input.status !== undefined ? assertPaymentStatus(input.status) : before.status;
    const amountCents = input.amountCents !== undefined
      ? positiveAmount(input.amountCents)
      : positiveAmount(before.amountCents);
    const dueAt = input.dueAt !== undefined
      ? normalizeDate(input.dueAt, 'dueAt')
      : before.dueAt;
    if (!dueAt) throw invalid('dueAt is required');
    const blockAt = input.blockAt !== undefined
      ? normalizeDate(input.blockAt, 'blockAt')
      : before.blockAt;
    const paidAt = input.paidAt !== undefined
      ? normalizeDate(input.paidAt, 'paidAt')
      : before.paidAt;
    const description = input.description !== undefined
      ? String(input.description || '').trim() || null
      : before.description;
    const result = await this.sql<FinanceRow>(
      `UPDATE public.master_subscription_finance_entries e
          SET status=$2, amount_cents=$3, due_at=$4, block_at=$5,
              paid_at=$6, event_at=$4, description=$7, updated_at=now()
         FROM public.master_tenants t
        WHERE e.id=$1 AND e.tenant_id=t.id AND e.kind='PAYMENT'
        RETURNING e.*, t.company_name`,
      [id, status, amountCents, dueAt, blockAt, paidAt, description],
    );
    if (!result.rows[0]) throw notFound('subscription finance entry', id);
    return { before, after: mapEntry(result.rows[0]) };
  }

  async markPaid(
    id: string,
    input: { paidAt?: string | null } = {},
  ): Promise<{
    before: SubscriptionFinanceEntry;
    after: SubscriptionFinanceEntry;
    next: SubscriptionFinanceEntry | null;
  }> {
    const before = await this.getEntry(id);
    if (before.kind !== 'PAYMENT') throw invalid('entry is not a payment');
    const paidAt = normalizeDate(input.paidAt, 'paidAt') ?? new Date().toISOString();
    const updated = await this.sql<FinanceRow>(
      `UPDATE public.master_subscription_finance_entries e
          SET status='PAID', paid_at=$2, block_at=null, updated_at=now()
         FROM public.master_tenants t
        WHERE e.id=$1 AND e.tenant_id=t.id
        RETURNING e.*, t.company_name`,
      [id, paidAt],
    );
    const after = mapEntry(updated.rows[0]);

    const subResult = await this.sql<{ cycle: string; amount_cents: string | number }>(
      `SELECT cycle, amount_cents
         FROM public.master_subscriptions
        WHERE id=$1 LIMIT 1`,
      [after.subscriptionId],
    );
    const cycle = String(subResult.rows[0]?.cycle || 'MONTHLY') as SaasPlanCycle;
    const baseDate = before.dueAt || before.eventAt;
    const nextDueAt = calculateSubscriptionExpiresAt(
      baseDate,
      cycle === 'ANNUAL' ? 'ANNUAL' : 'MONTHLY',
    );
    const exists = await this.sql<{ id: string }>(
      `SELECT id
         FROM public.master_subscription_finance_entries
        WHERE subscription_id=$1 AND kind='PAYMENT'
          AND status <> 'CANCELLED' AND due_at=$2::timestamptz
        LIMIT 1`,
      [after.subscriptionId, nextDueAt],
    );
    let next: SubscriptionFinanceEntry | null = null;
    if (!exists.rows[0]) {
      next = await this.createPayment({
        companyId: after.companyId,
        amountCents: Number(subResult.rows[0]?.amount_cents ?? before.amountCents),
        dueAt: nextDueAt,
        blockAt: addDays(nextDueAt, 7),
        status: 'PENDING',
        description: 'Próxima mensalidade da assinatura',
        actorUserId: after.createdByMasterUserId,
      });
    }
    return { before, after, next };
  }

  /**
   * Marca vencidos e retorna apenas os que atingiram a data editável de bloqueio.
   * O bloqueio oficial e a auditoria são executados pelo processador externo.
   */
  async claimAutomaticBlockCandidates(now = new Date().toISOString()): Promise<SubscriptionFinanceEntry[]> {
    await this.sql(
      `UPDATE public.master_subscription_finance_entries
          SET status='OVERDUE', updated_at=now()
        WHERE kind='PAYMENT' AND status='PENDING'
          AND due_at < $1::timestamptz`,
      [now],
    );
    const result = await this.sql<FinanceRow>(
      `${FINANCE_SELECT}
        WHERE e.kind='PAYMENT'
          AND e.status='OVERDUE'
          AND e.block_at IS NOT NULL
          AND e.block_at <= $1::timestamptz
          AND NOT EXISTS (
            SELECT 1
              FROM public.master_subscription_finance_entries b
             WHERE b.kind='AUTOMATIC_BLOCK' AND b.source_entry_id=e.id
          )
        ORDER BY e.block_at, e.id`,
      [now],
    );
    return result.rows.map(mapEntry);
  }

  async recordAutomaticBlock(
    source: SubscriptionFinanceEntry,
  ): Promise<SubscriptionFinanceEntry | null> {
    const id = `fin_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
    const result = await this.sql<FinanceRow>(
      `WITH subscription_updated AS (
         UPDATE public.master_subscriptions
            SET status='SUSPENDED', suspended_at=now(), updated_at=now()
          WHERE id=$1 AND status NOT IN ('CANCELLED', 'EXPIRED')
       ), inserted AS (
         INSERT INTO public.master_subscription_finance_entries (
           id, subscription_id, tenant_id, company_id, kind, status,
           amount_cents, currency, due_at, block_at, paid_at, event_at,
           description, source_entry_id, automatic, created_by_master_user_id, meta
         ) VALUES (
           $2,$1,$3,$4,'AUTOMATIC_BLOCK','BLOCKED',
           null,'BRL',null,null,null,now(),
           $5,$6,true,'master-finance-automation',$7::jsonb
         )
         ON CONFLICT (source_entry_id) WHERE kind='AUTOMATIC_BLOCK' DO NOTHING
         RETURNING *
       )
       SELECT i.*, $8::text AS company_name FROM inserted i`,
      [
        source.subscriptionId,
        id,
        source.tenantId,
        source.companyId,
        `Bloqueada automaticamente por inadimplência da cobrança ${source.id}`,
        source.id,
        jsonParam({ source: 'fase_6_4', overdueEntryId: source.id }),
        source.companyName,
      ],
    );
    return result.rows[0] ? mapEntry(result.rows[0]) : null;
  }
}

