import { logger } from '../../logger/logger.js';
import type { MasterAuditPort } from '../registry/MasterRepositoryRegistry.js';
import type { MasterTenantsService } from '../tenants/MasterTenantsService.js';
import {
  masterSql,
  type MasterSqlQuery,
} from '../adapters/postgres/masterSql.js';
import type { SubscriptionFinanceEntry } from '../subscriptionFinance/subscriptionFinance.types.js';
import { SubscriptionNotificationService } from './SubscriptionNotificationService.js';

export type ReleaseOnPaymentDeps = {
  tenants: MasterTenantsService;
  audit: MasterAuditPort;
  notifications?: SubscriptionNotificationService;
  sql?: MasterSqlQuery;
};

export type ReleaseOnPaymentResult = {
  released: boolean;
  tenantStatusBefore: string | null;
  tenantStatusAfter: string | null;
  subscriptionReactivated: boolean;
  notifications: number;
};

/**
 * Após pagamento confirmado: libera apenas bloqueio/suspensão por inadimplência
 * (`subscription_overdue:*`), reativa assinatura SUSPENDED e notifica PAID_RELEASED.
 * Nunca desfaz bloqueio administrativo.
 */
export async function releaseCompanyAfterSubscriptionPayment(
  entry: SubscriptionFinanceEntry,
  deps: ReleaseOnPaymentDeps,
): Promise<ReleaseOnPaymentResult> {
  const sql = deps.sql ?? masterSql;
  const notifications = deps.notifications ?? new SubscriptionNotificationService(sql);
  const tenant = await deps.tenants.get(entry.tenantId);
  const reason = String(tenant.meta?.lastActionReason || '');
  const overdueBlocked =
    (tenant.status === 'blocked' || tenant.status === 'suspended') &&
    reason.startsWith('subscription_overdue:');

  let tenantStatusAfter = tenant.status;
  let released = false;

  if (overdueBlocked) {
    const after = await deps.tenants.applyAction(entry.tenantId, 'unblock', {
      reason: `subscription_payment:${entry.id}`,
    });
    tenantStatusAfter = after.status;
    released = true;
  }

  const sub = await sql<{ id: string }>(
    `UPDATE public.master_subscriptions
        SET status='ACTIVE', suspended_at=null, updated_at=now()
      WHERE id=$1 AND status='SUSPENDED'
      RETURNING id`,
    [entry.subscriptionId],
  );
  const subscriptionReactivated = Boolean(sub.rows[0]);

  const admin = await sql<{ admin_email: string | null }>(
    `SELECT admin_email FROM public.master_tenants WHERE id=$1 LIMIT 1`,
    [entry.tenantId],
  );

  const sent = await notifications.notifyPaidReleased({
    financeEntryId: entry.id,
    tenantId: entry.tenantId,
    companyId: entry.companyId,
    companyName: entry.companyName,
    adminEmail: admin.rows[0]?.admin_email ?? null,
    released: released || subscriptionReactivated,
  });

  await deps.audit.append({
    actorUserId: 'master-finance-automation',
    actorEmail: 'finance-automation@master.local',
    actorRole: 'SYSTEM',
    companyId: entry.companyId,
    companyName: entry.companyName,
    action: released || subscriptionReactivated
      ? 'SUBSCRIPTION_AUTO_RELEASED'
      : 'SUBSCRIPTION_PAYMENT_NOTIFIED',
    resource: 'subscription_notifications',
    message: released || subscriptionReactivated
      ? `Empresa ${entry.companyName} liberada automaticamente após pagamento`
      : `Pagamento de ${entry.companyName} notificado`,
    before: { tenantStatus: tenant.status, reason },
    after: {
      tenantStatus: tenantStatusAfter,
      subscriptionReactivated,
      notifications: sent.map((n) => ({ id: n.id, channel: n.channel, status: n.status })),
    },
    meta: {
      tenantId: entry.tenantId,
      subscriptionId: entry.subscriptionId,
      financeEntryId: entry.id,
      automatic: true,
    },
  });

  if (released) {
    logger.info({
      module: 'master.subscriptionNotifications',
      action: 'SUBSCRIPTION_AUTO_RELEASED',
      message: 'Empresa liberada após pagamento da assinatura',
      companyId: entry.companyId,
      meta: { tenantId: entry.tenantId, entryId: entry.id },
    });
  }

  return {
    released,
    tenantStatusBefore: tenant.status,
    tenantStatusAfter,
    subscriptionReactivated,
    notifications: sent.length,
  };
}
