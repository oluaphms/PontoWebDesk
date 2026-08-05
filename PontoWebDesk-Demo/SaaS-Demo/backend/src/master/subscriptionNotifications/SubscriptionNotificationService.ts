import { randomUUID } from 'node:crypto';
import {
  asJson,
  jsonParam,
  masterSql,
  toIso,
  toIsoRequired,
  type MasterSqlQuery,
} from '../adapters/postgres/masterSql.js';
import { notFound } from '../errors.js';
import { deliverSubscriptionNotification } from './deliverNotification.js';
import { masterInboxMessage, templateForKind } from './notificationTemplates.js';
import type {
  SubscriptionNotification,
  SubscriptionNotificationCandidate,
  SubscriptionNotificationChannel,
  SubscriptionNotificationKind,
  SubscriptionNotificationPreferences,
  SubscriptionNotificationStatus,
  UpdateSubscriptionNotificationPreferences,
} from './subscriptionNotification.types.js';

type NotificationRow = {
  id: string;
  finance_entry_id: string;
  tenant_id: string;
  company_id: string;
  kind: string;
  channel: string;
  recipient: string | null;
  title: string;
  message: string;
  status: string;
  sent_at: Date | string | null;
  error: string | null;
  created_at: Date | string;
  meta: unknown;
};

type CandidateRow = {
  finance_entry_id: string;
  subscription_id: string;
  tenant_id: string;
  company_id: string;
  company_name: string;
  admin_email: string | null;
  due_at: Date | string | null;
  kind: string;
};

type PreferenceRow = {
  tenant_id: string;
  company_id: string;
  receive_email: boolean;
  notify_due_in_7: boolean;
  notify_due_in_3: boolean;
  notify_due_today: boolean;
  notify_after_block: boolean;
  updated_at: Date | string | null;
};

function mapPreferences(row: PreferenceRow): SubscriptionNotificationPreferences {
  return {
    tenantId: row.tenant_id,
    companyId: row.company_id,
    receiveEmail: row.receive_email,
    notifyDueIn7: row.notify_due_in_7,
    notifyDueIn3: row.notify_due_in_3,
    notifyDueToday: row.notify_due_today,
    notifyAfterBlock: row.notify_after_block,
    updatedAt: toIso(row.updated_at),
  };
}

function isCompanyNoticeEnabled(
  kind: SubscriptionNotificationKind,
  preferences: SubscriptionNotificationPreferences,
): boolean {
  if (kind === 'DUE_IN_7') return preferences.notifyDueIn7;
  if (kind === 'DUE_IN_3') return preferences.notifyDueIn3;
  if (kind === 'DUE_TODAY') return preferences.notifyDueToday;
  if (kind === 'BLOCKED') return preferences.notifyAfterBlock;
  return true;
}

function mapNotification(row: NotificationRow): SubscriptionNotification {
  return {
    id: row.id,
    financeEntryId: row.finance_entry_id,
    tenantId: row.tenant_id,
    companyId: row.company_id,
    kind: row.kind as SubscriptionNotificationKind,
    channel: row.channel as SubscriptionNotificationChannel,
    recipient: row.recipient,
    title: row.title,
    message: row.message,
    status: row.status as SubscriptionNotificationStatus,
    sentAt: toIso(row.sent_at),
    error: row.error,
    createdAt: toIsoRequired(row.created_at),
    meta: asJson(row.meta),
  };
}

function mapCandidate(row: CandidateRow): SubscriptionNotificationCandidate {
  return {
    financeEntryId: row.finance_entry_id,
    subscriptionId: row.subscription_id,
    tenantId: row.tenant_id,
    companyId: row.company_id,
    companyName: row.company_name,
    adminEmail: row.admin_email,
    dueAt: toIso(row.due_at),
    kind: row.kind as SubscriptionNotificationKind,
  };
}

const CHANNELS: SubscriptionNotificationChannel[] = ['MASTER_INBOX', 'COMPANY_ADMIN'];

export class SubscriptionNotificationService {
  constructor(private readonly sql: MasterSqlQuery = masterSql) {}

  async getPreferences(companyId: string): Promise<SubscriptionNotificationPreferences> {
    const result = await this.sql<PreferenceRow>(
      `SELECT t.id AS tenant_id,
              coalesce(t.operational_company_id::text, t.id) AS company_id,
              coalesce(p.receive_email, true) AS receive_email,
              coalesce(p.notify_due_in_7, true) AS notify_due_in_7,
              coalesce(p.notify_due_in_3, true) AS notify_due_in_3,
              coalesce(p.notify_due_today, true) AS notify_due_today,
              coalesce(p.notify_after_block, true) AS notify_after_block,
              p.updated_at
         FROM public.master_tenants t
         LEFT JOIN public.master_subscription_notification_preferences p
           ON p.tenant_id = t.id
        WHERE t.id = $1 OR t.operational_company_id::text = $1
        LIMIT 1`,
      [companyId],
    );
    if (!result.rows[0]) {
      throw notFound('tenant', companyId);
    }
    return mapPreferences(result.rows[0]);
  }

  async updatePreferences(
    companyId: string,
    input: UpdateSubscriptionNotificationPreferences,
    actorUserId: string | null,
  ): Promise<SubscriptionNotificationPreferences> {
    const tenant = await this.sql<{ id: string; company_id: string }>(
      `SELECT id, coalesce(operational_company_id::text, id) AS company_id
         FROM public.master_tenants
        WHERE id=$1 OR operational_company_id::text=$1
        LIMIT 1`,
      [companyId],
    );
    const tenantId = tenant.rows[0]?.id;
    if (!tenantId) throw notFound('tenant', companyId);
    const operationalCompanyId = tenant.rows[0].company_id;

    const result = await this.sql<PreferenceRow>(
      `INSERT INTO public.master_subscription_notification_preferences (
         tenant_id, company_id, receive_email, notify_due_in_7, notify_due_in_3,
         notify_due_today, notify_after_block, updated_by_master_user_id
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (tenant_id) DO UPDATE SET
         company_id=excluded.company_id,
         receive_email=excluded.receive_email,
         notify_due_in_7=excluded.notify_due_in_7,
         notify_due_in_3=excluded.notify_due_in_3,
         notify_due_today=excluded.notify_due_today,
         notify_after_block=excluded.notify_after_block,
         updated_by_master_user_id=excluded.updated_by_master_user_id,
         updated_at=now()
       RETURNING *`,
      [
        tenantId,
        operationalCompanyId,
        input.receiveEmail,
        input.notifyDueIn7,
        input.notifyDueIn3,
        input.notifyDueToday,
        input.notifyAfterBlock,
        actorUserId,
      ],
    );
    return mapPreferences(result.rows[0]);
  }

  async listCompany(companyId: string, limit = 100): Promise<SubscriptionNotification[]> {
    const safe = Math.min(Math.max(Number(limit) || 100, 1), 500);
    const result = await this.sql<NotificationRow>(
      `SELECT *
         FROM public.master_subscription_notifications
        WHERE company_id=$1
        ORDER BY created_at DESC
        LIMIT $2`,
      [companyId, safe],
    );
    return result.rows.map(mapNotification);
  }

  /**
   * Candidatos de aviso pré-vencimento / no vencimento, sem notificação já gravada
   * (dedupe via índice único finance_entry_id+kind+channel).
   */
  async claimDueCandidates(now = new Date().toISOString()): Promise<SubscriptionNotificationCandidate[]> {
    const result = await this.sql<CandidateRow>(
      `WITH base AS (
         SELECT e.id AS finance_entry_id,
                e.subscription_id,
                e.tenant_id,
                e.company_id,
                t.company_name,
                t.admin_email,
                e.due_at,
                coalesce(p.notify_due_in_7, true) AS notify_due_in_7,
                coalesce(p.notify_due_in_3, true) AS notify_due_in_3,
                coalesce(p.notify_due_today, true) AS notify_due_today
           FROM public.master_subscription_finance_entries e
           JOIN public.master_tenants t ON t.id = e.tenant_id
           LEFT JOIN public.master_subscription_notification_preferences p
             ON p.tenant_id = t.id
          WHERE e.kind = 'PAYMENT'
            AND e.status IN ('PENDING', 'OVERDUE')
            AND e.due_at IS NOT NULL
       ),
       kinds AS (
         SELECT b.*, 'DUE_IN_7'::text AS kind
           FROM base b
          WHERE b.due_at > $1::timestamptz
            AND b.due_at - interval '7 days' <= $1::timestamptz
            AND b.notify_due_in_7
         UNION ALL
         SELECT b.*, 'DUE_IN_3'::text AS kind
           FROM base b
          WHERE b.due_at > $1::timestamptz
            AND b.due_at - interval '3 days' <= $1::timestamptz
            AND b.notify_due_in_3
         UNION ALL
         SELECT b.*, 'DUE_TODAY'::text AS kind
           FROM base b
          WHERE b.due_at <= $1::timestamptz
            AND b.notify_due_today
       )
       SELECT k.*
         FROM kinds k
        WHERE NOT EXISTS (
          SELECT 1
            FROM public.master_subscription_notifications n
           WHERE n.finance_entry_id = k.finance_entry_id
             AND n.kind = k.kind
             AND n.channel = 'COMPANY_ADMIN'
        )
        ORDER BY k.due_at, k.finance_entry_id, k.kind`,
      [now],
    );
    return result.rows.map(mapCandidate);
  }

  async notify(
    candidate: {
      financeEntryId: string;
      tenantId: string;
      companyId: string;
      companyName: string;
      adminEmail?: string | null;
      kind: SubscriptionNotificationKind;
    },
    meta: Record<string, unknown> = {},
  ): Promise<SubscriptionNotification[]> {
    const tpl = templateForKind(candidate.kind, { companyName: candidate.companyName });
    const created: SubscriptionNotification[] = [];
    const preferences = await this.getPreferences(candidate.companyId);
    const companyNoticeEnabled = isCompanyNoticeEnabled(candidate.kind, preferences);

    for (const channel of CHANNELS) {
      if (channel === 'COMPANY_ADMIN' && !companyNoticeEnabled) continue;
      const id = `ntf_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
      const recipient =
        channel === 'COMPANY_ADMIN'
          ? (candidate.adminEmail || null)
          : 'master';
      const title = tpl.title;
      const message =
        channel === 'MASTER_INBOX'
          ? masterInboxMessage(candidate.kind, candidate.companyName)
          : tpl.message;

      const inserted = await this.sql<NotificationRow>(
        `INSERT INTO public.master_subscription_notifications (
           id, finance_entry_id, tenant_id, company_id, kind, channel,
           recipient, title, message, status, meta
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8,$9,'QUEUED',$10::jsonb
         )
         ON CONFLICT (finance_entry_id, kind, channel) DO NOTHING
         RETURNING *`,
        [
          id,
          candidate.financeEntryId,
          candidate.tenantId,
          candidate.companyId,
          candidate.kind,
          channel,
          recipient,
          title,
          message,
          jsonParam({ ...meta, fase: '6.5' }),
        ],
      );
      const row = inserted.rows[0];
      if (!row) continue;

      const delivery = await deliverSubscriptionNotification({
        channel,
        tenantId: candidate.tenantId,
        companyId: candidate.companyId,
        companyName: candidate.companyName,
        recipient,
        kind: candidate.kind,
        allowExternalEmail: preferences.receiveEmail,
        sql: this.sql,
        template: {
          title: tpl.title,
          message: channel === 'MASTER_INBOX' ? message : tpl.message,
          level: tpl.level,
        },
      });

      const updated = await this.sql<NotificationRow>(
        `UPDATE public.master_subscription_notifications
            SET status=$2,
                sent_at=CASE WHEN $2='SENT' THEN now() ELSE sent_at END,
                error=$3
          WHERE id=$1
          RETURNING *`,
        [row.id, delivery.status, delivery.error ?? null],
      );
      if (updated.rows[0]) created.push(mapNotification(updated.rows[0]));
    }

    return created;
  }

  async notifyBlocked(input: {
    financeEntryId: string;
    tenantId: string;
    companyId: string;
    companyName: string;
    adminEmail?: string | null;
  }): Promise<SubscriptionNotification[]> {
    return this.notify({ ...input, kind: 'BLOCKED' }, { trigger: 'auto_block' });
  }

  async notifyPaidReleased(input: {
    financeEntryId: string;
    tenantId: string;
    companyId: string;
    companyName: string;
    adminEmail?: string | null;
    released: boolean;
  }): Promise<SubscriptionNotification[]> {
    return this.notify(
      { ...input, kind: 'PAID_RELEASED' },
      { trigger: 'payment_confirmed', released: input.released },
    );
  }
}
