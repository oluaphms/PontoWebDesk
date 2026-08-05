import { logger } from '../../logger/logger.js';
import type { MasterAuditPort } from '../registry/MasterRepositoryRegistry.js';
import type { MasterTenantsService } from '../tenants/MasterTenantsService.js';
import {
  masterSql,
  type MasterSqlQuery,
} from '../adapters/postgres/masterSql.js';
import {
  processDueSubscriptionNotifications,
  SubscriptionNotificationService,
} from '../subscriptionNotifications/index.js';
import { SubscriptionFinanceService } from './SubscriptionFinanceService.js';

export type SubscriptionFinanceAutomationDeps = {
  finance: SubscriptionFinanceService;
  tenants: MasterTenantsService;
  audit: MasterAuditPort;
  notifications?: SubscriptionNotificationService;
  sql?: MasterSqlQuery;
};

export async function processSubscriptionOverdues(
  deps: SubscriptionFinanceAutomationDeps,
  now = new Date().toISOString(),
): Promise<{ scanned: number; blocked: number; skipped: number; failed: number; notified: number }> {
  const sql = deps.sql ?? masterSql;
  const notifications = deps.notifications ?? new SubscriptionNotificationService(sql);
  const candidates = await deps.finance.claimAutomaticBlockCandidates(now);
  let blocked = 0;
  let skipped = 0;
  let failed = 0;
  let notified = 0;

  for (const source of candidates) {
    const reason = `subscription_overdue:${source.id}`;
    try {
      const beforeTenant = await deps.tenants.get(source.tenantId);
      if (beforeTenant.status === 'cancelled') {
        skipped += 1;
        continue;
      }
      if (
        (beforeTenant.status === 'blocked' || beforeTenant.status === 'suspended') &&
        !String(beforeTenant.meta?.lastActionReason || '').startsWith('subscription_overdue:')
      ) {
        // Nunca sobrescreve bloqueio administrativo/manual já existente.
        skipped += 1;
        continue;
      }

      const afterTenant =
        beforeTenant.status === 'blocked'
          ? beforeTenant
          : await deps.tenants.applyAction(source.tenantId, 'block', { reason });
      const event = await deps.finance.recordAutomaticBlock(source);
      if (!event) {
        skipped += 1;
        continue;
      }

      await deps.audit.append({
        actorUserId: 'master-finance-automation',
        actorEmail: 'finance-automation@master.local',
        actorRole: 'SYSTEM',
        companyId: source.companyId,
        companyName: source.companyName,
        action: 'SUBSCRIPTION_AUTO_BLOCKED',
        resource: 'subscription_finance',
        message: `Empresa ${source.companyName} bloqueada automaticamente por inadimplência`,
        before: {
          tenantStatus: beforeTenant.status,
          financeEntry: source,
        },
        after: {
          tenantStatus: afterTenant.status,
          blockEvent: event,
        },
        meta: {
          tenantId: source.tenantId,
          subscriptionId: source.subscriptionId,
          overdueEntryId: source.id,
          automatic: true,
        },
      });
      blocked += 1;

      try {
        const admin = await sql<{ admin_email: string | null }>(
          `SELECT admin_email FROM public.master_tenants WHERE id=$1 LIMIT 1`,
          [source.tenantId],
        );
        const rows = await notifications.notifyBlocked({
          financeEntryId: source.id,
          tenantId: source.tenantId,
          companyId: source.companyId,
          companyName: source.companyName,
          adminEmail: admin.rows[0]?.admin_email ?? null,
        });
        notified += rows.length > 0 ? 1 : 0;
      } catch (notifyError) {
        logger.error({
          module: 'master.subscriptionNotifications',
          action: 'SUBSCRIPTION_BLOCK_NOTIFY_FAILED',
          message: 'Bloqueio ok; falha ao notificar empresa bloqueada',
          companyId: source.companyId,
          error: notifyError,
          meta: { tenantId: source.tenantId, entryId: source.id },
        });
      }
    } catch (error) {
      failed += 1;
      await deps.audit.append({
        actorUserId: 'master-finance-automation',
        actorEmail: 'finance-automation@master.local',
        actorRole: 'SYSTEM',
        companyId: source.companyId,
        companyName: source.companyName,
        action: 'SUBSCRIPTION_AUTO_BLOCK_FAILED',
        resource: 'subscription_finance',
        message: `Falha ao bloquear ${source.companyName} automaticamente`,
        before: source,
        meta: {
          tenantId: source.tenantId,
          subscriptionId: source.subscriptionId,
          overdueEntryId: source.id,
          error: error instanceof Error ? error.message : String(error),
        },
      });
      logger.error({
        module: 'master.subscriptionFinance',
        action: 'SUBSCRIPTION_AUTO_BLOCK_FAILED',
        message: 'Falha no bloqueio automático por inadimplência',
        companyId: source.companyId,
        error,
        meta: { tenantId: source.tenantId, entryId: source.id },
      });
    }
  }

  return { scanned: candidates.length, blocked, skipped, failed, notified };
}

/** Ciclo completo: avisos de vencimento + bloqueio automático. */
export async function processSubscriptionFinanceCycle(
  deps: SubscriptionFinanceAutomationDeps,
  now = new Date().toISOString(),
): Promise<{
  notifications: { scanned: number; sent: number; failed: number };
  overdues: { scanned: number; blocked: number; skipped: number; failed: number; notified: number };
}> {
  const notifications = await processDueSubscriptionNotifications(
    {
      notifications: deps.notifications,
      tenants: deps.tenants,
      audit: deps.audit,
      sql: deps.sql,
    },
    now,
  );
  const overdues = await processSubscriptionOverdues(deps, now);
  return { notifications, overdues };
}

let timer: NodeJS.Timeout | null = null;
let running = false;

export function startSubscriptionFinanceAutomation(
  deps: SubscriptionFinanceAutomationDeps,
): () => void {
  if (timer || process.env.NODE_ENV === 'test') return () => undefined;
  const configured = Number(process.env.MASTER_FINANCE_AUTOMATION_INTERVAL_MS || 300_000);
  const intervalMs = Number.isFinite(configured) ? Math.max(60_000, configured) : 300_000;

  const run = async () => {
    if (running) return;
    running = true;
    try {
      await processSubscriptionFinanceCycle(deps);
    } catch (error) {
      logger.error({
        module: 'master.subscriptionFinance',
        action: 'SUBSCRIPTION_FINANCE_AUTOMATION_FAILED',
        message: 'Falha no ciclo do financeiro automático',
        error,
      });
    } finally {
      running = false;
    }
  };

  timer = setInterval(() => void run(), intervalMs);
  timer.unref();
  void run();
  return () => {
    if (timer) clearInterval(timer);
    timer = null;
  };
}
