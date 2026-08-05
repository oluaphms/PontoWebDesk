import { randomUUID } from 'node:crypto';
import { logger } from '../../logger/logger.js';
import type { MasterSqlQuery } from '../adapters/postgres/masterSql.js';
import { MasterNotifications } from '../journey/masterNotifications.js';
import {
  type NotificationTemplate,
} from './notificationTemplates.js';
import type { SubscriptionNotificationChannel } from './subscriptionNotification.types.js';

export type DeliveryInput = {
  channel: SubscriptionNotificationChannel;
  tenantId: string;
  companyId: string;
  companyName: string;
  recipient: string | null;
  kind: string;
  template: NotificationTemplate;
  allowExternalEmail?: boolean;
  /** Necessário para gravar no inbox SaaS (`public.notifications`). */
  sql?: MasterSqlQuery;
};

export type DeliveryResult = {
  ok: boolean;
  status: 'SENT' | 'FAILED' | 'SKIPPED';
  error?: string;
};

function saasType(level: NotificationTemplate['level']): 'info' | 'warning' | 'success' | 'error' {
  if (level === 'warn') return 'warning';
  return level;
}

function saasActionUrl(kind: string): string | null {
  if (kind === 'BLOCKED') return '/license-blocked';
  if (kind === 'PAID_RELEASED') return '/admin';
  if (kind === 'DUE_IN_7' || kind === 'DUE_IN_3' || kind === 'DUE_TODAY') return '/admin';
  return null;
}

async function resolveCompanyIds(
  sql: MasterSqlQuery,
  tenantId: string,
  companyId: string,
): Promise<string[]> {
  const ids = new Set<string>();
  const cid = String(companyId || '').trim();
  const tid = String(tenantId || '').trim();
  if (cid) ids.add(cid);
  if (tid) ids.add(tid);
  try {
    const result = await sql<{ id: string; operational_company_id: string | null }>(
      `SELECT id::text AS id, operational_company_id::text AS operational_company_id
         FROM public.master_tenants
        WHERE id = $1 OR operational_company_id::text = $1 OR id = $2 OR operational_company_id::text = $2
        LIMIT 3`,
      [tid || cid, cid || tid],
    );
    for (const row of result.rows) {
      if (row.id) ids.add(row.id);
      if (row.operational_company_id) ids.add(row.operational_company_id);
    }
  } catch {
    /* best-effort — segue com companyId/tenantId informados */
  }
  return [...ids].filter(Boolean);
}

/**
 * Inbox SaaS dos admins da empresa (mesmo destino do NotificationService do frontend).
 * Usa queryMaster (bypass RLS) — o policy "insert own" não cobre o control plane.
 *
 * Ordem de resolução:
 * 1) usuário com e-mail = admin_email do tenant;
 * 2) fallback: usuários admin/owner/rh da empresa operacional.
 */
async function deliverSaasInbox(
  input: DeliveryInput,
  email: string | null,
): Promise<{ ok: boolean; userIds?: string[]; skipped?: string; error?: string }> {
  if (!input.sql) return { ok: false, skipped: 'sql_unavailable' };

  try {
    const companyIds = await resolveCompanyIds(input.sql, input.tenantId, input.companyId);
    if (companyIds.length === 0) {
      return { ok: false, skipped: 'company_id_missing' };
    }

    const recipients = new Map<string, string>();
    const normalizedEmail = String(email || '').trim().toLowerCase();

    if (normalizedEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      const byEmail = await input.sql<{ id: string }>(
        `SELECT id::text AS id
           FROM public.users
          WHERE company_id::text = ANY($1::text[])
            AND lower(trim(email)) = $2
          ORDER BY CASE WHEN lower(trim(coalesce(role::text, ''))) IN ('admin', 'owner') THEN 0 ELSE 1 END
          LIMIT 5`,
        [companyIds, normalizedEmail],
      );
      for (const row of byEmail.rows) {
        if (row.id) recipients.set(row.id, normalizedEmail);
      }
    }

    if (recipients.size === 0) {
      const byRole = await input.sql<{ id: string; email: string | null }>(
        `SELECT id::text AS id, email
           FROM public.users
          WHERE company_id::text = ANY($1::text[])
            AND lower(trim(coalesce(role::text, ''))) IN ('admin', 'owner', 'rh', 'hr')
            AND lower(trim(coalesce(status, 'active'))) = 'active'
          ORDER BY CASE
            WHEN lower(trim(coalesce(role::text, ''))) = 'admin' THEN 0
            WHEN lower(trim(coalesce(role::text, ''))) = 'owner' THEN 1
            ELSE 2
          END
          LIMIT 10`,
        [companyIds],
      );
      for (const row of byRole.rows) {
        if (row.id) recipients.set(row.id, String(row.email || normalizedEmail || '').trim().toLowerCase());
      }
    }

    if (recipients.size === 0) {
      return { ok: false, skipped: 'admin_user_not_found' };
    }

    const actionUrl = saasActionUrl(input.kind);
    const metadata = JSON.stringify({
      scope: 'company',
      kind: 'company_notice',
      source: 'subscription_notifications',
      subscriptionKind: input.kind,
      tenantId: input.tenantId,
      companyId: input.companyId,
    });

    const userIds: string[] = [];
    for (const userId of recipients.keys()) {
      const id = randomUUID();
      await input.sql(
        `INSERT INTO public.notifications (
           id, user_id, type, title, message, read, status, created_at, action_url, metadata
         ) VALUES (
           $1,$2,$3,$4,$5,false,'pending',now(),$6,$7::jsonb
         )`,
        [
          id,
          userId,
          saasType(input.template.level),
          input.template.title,
          input.template.message,
          actionUrl,
          metadata,
        ],
      );
      userIds.push(userId);
    }

    return { ok: true, userIds };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function deliverCompanyAdmin(input: DeliveryInput): Promise<DeliveryResult> {
  const email = String(input.recipient || '').trim().toLowerCase();
  const hasEmail = Boolean(email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email));

  const saas = await deliverSaasInbox(input, hasEmail ? email : null);
  const webhook = String(process.env.MASTER_NOTIFICATION_WEBHOOK_URL || '').trim();

  let webhookOk = false;
  if (input.allowExternalEmail !== false && webhook && hasEmail) {
    try {
      const res = await fetch(webhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'subscription_notification',
          to: email,
          companyId: input.companyId,
          tenantId: input.tenantId,
          kind: input.kind,
          title: input.template.title,
          message: input.template.message,
          saasInbox: saas.ok,
        }),
      });
      if (!res.ok) {
        logger.warn({
          module: 'master.subscriptionNotifications',
          action: 'COMPANY_ADMIN_WEBHOOK_FAILED',
          message: `Webhook HTTP ${res.status}`,
          companyId: input.companyId,
          meta: { kind: input.kind, tenantId: input.tenantId },
        });
      } else {
        webhookOk = true;
      }
    } catch (error) {
      logger.warn({
        module: 'master.subscriptionNotifications',
        action: 'COMPANY_ADMIN_WEBHOOK_FAILED',
        message: error instanceof Error ? error.message : String(error),
        companyId: input.companyId,
        meta: { kind: input.kind, tenantId: input.tenantId },
      });
    }
  } else if (input.allowExternalEmail !== false && hasEmail) {
    console.info(
      `[master-subscription-notify] to=${email} kind=${input.kind} company=${input.companyId} saas=${saas.ok ? 'ok' : saas.skipped || saas.error || 'n/a'} title=${input.template.title} message=${JSON.stringify(input.template.message)}`,
    );
  }

  logger.info({
    module: 'master.subscriptionNotifications',
    action: 'COMPANY_ADMIN_NOTIFY',
    message: input.template.title,
    companyId: input.companyId,
    meta: {
      tenantId: input.tenantId,
      kind: input.kind,
      recipient: hasEmail ? email : null,
      delivery: saas.ok ? 'saas_inbox' : webhookOk ? 'webhook_only' : 'none',
      externalEmailEnabled: input.allowExternalEmail !== false,
      saasInbox: saas.ok,
      saasUserIds: saas.userIds ?? null,
      saasSkip: saas.skipped ?? null,
      saasError: saas.error ?? null,
      webhookOk,
    },
  });

  // Cliente deve ser notificado no sistema (public.notifications).
  // Webhook/console são complementares — não contam como entrega in-app.
  if (saas.ok) {
    return { ok: true, status: 'SENT' };
  }

  return {
    ok: false,
    status: saas.skipped ? 'SKIPPED' : 'FAILED',
    error: saas.skipped || saas.error || 'saas_inbox_failed',
  };
}

export async function deliverSubscriptionNotification(
  input: DeliveryInput,
): Promise<DeliveryResult> {
  if (input.channel === 'MASTER_INBOX') {
    try {
      MasterNotifications.append({
        tenantId: input.tenantId,
        title: input.template.title,
        message: `${input.companyName}: ${input.template.message.replace(/\n/g, ' ')}`,
        level: input.template.level,
      });
      return { ok: true, status: 'SENT' };
    } catch (error) {
      return {
        ok: false,
        status: 'FAILED',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
  return deliverCompanyAdmin(input);
}
