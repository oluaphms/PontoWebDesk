import { logger } from '../../logger/logger.js';
import type { MasterAuditPort } from '../registry/MasterRepositoryRegistry.js';
import type { MasterTenantsService } from '../tenants/MasterTenantsService.js';
import {
  masterSql,
  type MasterSqlQuery,
} from '../adapters/postgres/masterSql.js';
import { SubscriptionNotificationService } from './SubscriptionNotificationService.js';

export type SubscriptionNotificationAutomationDeps = {
  notifications?: SubscriptionNotificationService;
  tenants?: MasterTenantsService;
  audit?: MasterAuditPort;
  sql?: MasterSqlQuery;
};

export async function processDueSubscriptionNotifications(
  deps: SubscriptionNotificationAutomationDeps = {},
  now = new Date().toISOString(),
): Promise<{ scanned: number; sent: number; failed: number }> {
  const sql = deps.sql ?? masterSql;
  const notifications = deps.notifications ?? new SubscriptionNotificationService(sql);
  const candidates = await notifications.claimDueCandidates(now);
  let sent = 0;
  let failed = 0;

  for (const candidate of candidates) {
    try {
      const rows = await notifications.notify(candidate, {
        trigger: 'due_scan',
        dueAt: candidate.dueAt,
      });
      if (rows.some((r) => r.status === 'FAILED')) failed += 1;
      else sent += 1;

      if (deps.audit) {
        await deps.audit.append({
          actorUserId: 'master-finance-automation',
          actorEmail: 'finance-automation@master.local',
          actorRole: 'SYSTEM',
          companyId: candidate.companyId,
          companyName: candidate.companyName,
          action: 'SUBSCRIPTION_NOTIFICATION_SENT',
          resource: 'subscription_notifications',
          message: `Notificação ${candidate.kind} enviada para ${candidate.companyName}`,
          after: {
            kind: candidate.kind,
            financeEntryId: candidate.financeEntryId,
            channels: rows.map((r) => ({ channel: r.channel, status: r.status })),
          },
          meta: {
            tenantId: candidate.tenantId,
            subscriptionId: candidate.subscriptionId,
            kind: candidate.kind,
            automatic: true,
          },
        });
      }
    } catch (error) {
      failed += 1;
      logger.error({
        module: 'master.subscriptionNotifications',
        action: 'SUBSCRIPTION_NOTIFICATION_FAILED',
        message: 'Falha ao enviar notificação de vencimento',
        companyId: candidate.companyId,
        error,
        meta: { tenantId: candidate.tenantId, kind: candidate.kind, entryId: candidate.financeEntryId },
      });
      if (deps.audit) {
        await deps.audit.append({
          actorUserId: 'master-finance-automation',
          actorEmail: 'finance-automation@master.local',
          actorRole: 'SYSTEM',
          companyId: candidate.companyId,
          companyName: candidate.companyName,
          action: 'SUBSCRIPTION_NOTIFICATION_FAILED',
          resource: 'subscription_notifications',
          message: `Falha na notificação ${candidate.kind} de ${candidate.companyName}`,
          meta: {
            tenantId: candidate.tenantId,
            kind: candidate.kind,
            financeEntryId: candidate.financeEntryId,
            error: error instanceof Error ? error.message : String(error),
          },
        });
      }
    }
  }

  return { scanned: candidates.length, sent, failed };
}
