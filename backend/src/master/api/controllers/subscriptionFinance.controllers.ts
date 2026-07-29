import type { Response } from 'express';
import { MasterError } from '../../errors.js';
import { MasterPlatformService } from '../../../services/master/masterPlatformService.js';
import type { MasterApiRequest } from '../middlewares/requireMasterLogin.js';
import { MasterApiServices } from '../services/index.js';
import {
  SubscriptionFinanceService,
  processSubscriptionFinanceCycle,
  type SubscriptionFinanceEntry,
  type SubscriptionFinanceStatus,
} from '../../subscriptionFinance/index.js';
import {
  releaseCompanyAfterSubscriptionPayment,
  SubscriptionNotificationService,
} from '../../subscriptionNotifications/index.js';
import { SubscriptionLicenseSyncService } from '../../subscriptions/SubscriptionLicenseSyncService.js';

const finance = new SubscriptionFinanceService();
const notifications = new SubscriptionNotificationService();

function sendError(res: Response, error: unknown): void {
  if (error instanceof MasterError) {
    const status = error.code === 'MASTER_NOT_FOUND'
      ? 404
      : error.code === 'MASTER_CONFLICT'
        ? 409
        : 400;
    res.status(status).json({ ok: false, error: error.code, message: error.message });
    return;
  }
  const pgCode = typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code?: unknown }).code || '')
    : '';
  if (pgCode === '42P01' || pgCode === '42703') {
    res.status(503).json({
      ok: false,
      error: 'SUBSCRIPTION_FINANCE_SCHEMA_REQUIRED',
      message: 'Aplique as migrations 032, 033 e 034.',
    });
    return;
  }
  res.status(500).json({
    ok: false,
    error: 'SUBSCRIPTION_FINANCE_FAILED',
    message: error instanceof Error ? error.message : String(error),
  });
}

function requireHumanMaster(req: MasterApiRequest, res: Response): boolean {
  if (!req.masterAuth || req.masterKeyAuth || req.masterAuth.viaApiKey) {
    res.status(403).json({
      ok: false,
      error: 'MASTER_HUMAN_ACTOR_REQUIRED',
      message: 'Alterações financeiras exigem usuário Master autenticado.',
    });
    return false;
  }
  return true;
}

function body(req: MasterApiRequest): Record<string, unknown> {
  return req.body && typeof req.body === 'object'
    ? req.body as Record<string, unknown>
    : {};
}

function readAmountCents(data: Record<string, unknown>): number | undefined {
  if (data.amountCents != null) return Number(data.amountCents);
  if (data.amount != null || data.price != null) {
    return Math.round(Number(data.amount ?? data.price) * 100);
  }
  return undefined;
}

function requiredBoolean(data: Record<string, unknown>, key: string): boolean {
  if (typeof data[key] !== 'boolean') {
    throw new MasterError('MASTER_VALIDATION', `${key} deve ser boolean`);
  }
  return data[key];
}

async function afterPaymentConfirmed(entry: SubscriptionFinanceEntry) {
  try {
    const sync = new SubscriptionLicenseSyncService({
      licenseManager: MasterPlatformService.getLicenseManager(),
      tenants: MasterPlatformService.getTenantsService(),
      audit: MasterPlatformService.getAudit(),
      lifecycle: MasterPlatformService.getLifecycle(),
    });
    return await sync.onPaymentConfirmed(entry, {
      tenants: MasterPlatformService.getTenantsService(),
      audit: MasterPlatformService.getAudit(),
      notifications,
    });
  } catch {
    // Pagamento já gravado; liberação/notificação não devem reverter o pagamento.
    try {
      return {
        subscription: null,
        license: null,
        periodExtended: false,
        release: await releaseCompanyAfterSubscriptionPayment(entry, {
          tenants: MasterPlatformService.getTenantsService(),
          audit: MasterPlatformService.getAudit(),
          notifications,
        }),
      };
    } catch {
      return null;
    }
  }
}

/** GET /api/master/tenants/:companyId/subscription/finance */
export async function getSubscriptionFinance(
  req: MasterApiRequest,
  res: Response,
): Promise<void> {
  try {
    const entries = await finance.listCompanyTimeline(String(req.params.companyId || ''));
    res.json({ ok: true, entries, count: entries.length });
  } catch (error) {
    sendError(res, error);
  }
}

/** GET /api/master/tenants/:companyId/subscription/notification-preferences */
export async function getSubscriptionNotificationPreferences(
  req: MasterApiRequest,
  res: Response,
): Promise<void> {
  try {
    const preferences = await notifications.getPreferences(String(req.params.companyId || ''));
    res.json({ ok: true, preferences });
  } catch (error) {
    sendError(res, error);
  }
}

/** PATCH /api/master/tenants/:companyId/subscription/notification-preferences */
export async function patchSubscriptionNotificationPreferences(
  req: MasterApiRequest,
  res: Response,
): Promise<void> {
  try {
    if (!requireHumanMaster(req, res)) return;
    const companyId = String(req.params.companyId || '');
    const data = body(req);
    const before = await notifications.getPreferences(companyId);
    const preferences = await notifications.updatePreferences(
      companyId,
      {
        receiveEmail: requiredBoolean(data, 'receiveEmail'),
        notifyDueIn7: requiredBoolean(data, 'notifyDueIn7'),
        notifyDueIn3: requiredBoolean(data, 'notifyDueIn3'),
        notifyDueToday: requiredBoolean(data, 'notifyDueToday'),
        notifyAfterBlock: requiredBoolean(data, 'notifyAfterBlock'),
      },
      req.masterAuth?.userId ?? null,
    );
    MasterApiServices.recordAudit(req, {
      action: 'SUBSCRIPTION_NOTIFICATION_PREFERENCES_UPDATED',
      resource: 'subscription_notifications',
      message: 'Preferências de notificações da assinatura atualizadas',
      companyId: preferences.companyId,
      before,
      after: preferences,
      meta: { tenantId: preferences.tenantId },
    });
    res.json({ ok: true, preferences });
  } catch (error) {
    sendError(res, error);
  }
}

/** POST /api/master/tenants/:companyId/subscription/finance */
export async function postSubscriptionFinanceEntry(
  req: MasterApiRequest,
  res: Response,
): Promise<void> {
  try {
    if (!requireHumanMaster(req, res)) return;
    const data = body(req);
    const requestedStatus = data.status
      ? String(data.status).toUpperCase() as Extract<SubscriptionFinanceStatus, 'PENDING' | 'PAID' | 'OVERDUE'>
      : 'PENDING';
    const created = await finance.createPayment({
      companyId: String(req.params.companyId || ''),
      amountCents: readAmountCents(data),
      dueAt: data.dueAt ? String(data.dueAt) : undefined,
      blockAt: data.blockAt === null ? null : data.blockAt ? String(data.blockAt) : undefined,
      status: requestedStatus === 'PAID' ? 'PENDING' : requestedStatus,
      description: data.description == null ? undefined : String(data.description),
      actorUserId: req.masterAuth?.userId ?? null,
    });
    const paidResult = requestedStatus === 'PAID'
      ? await finance.markPaid(created.id, {
          paidAt: data.paidAt === null ? null : data.paidAt ? String(data.paidAt) : undefined,
        })
      : null;
    const entry = paidResult?.after ?? created;
    MasterApiServices.recordAudit(req, {
      action: entry.status === 'PAID'
        ? 'SUBSCRIPTION_PAYMENT_RECORDED'
        : 'SUBSCRIPTION_CHARGE_CREATED',
      resource: 'subscription_finance',
      message: `Lançamento financeiro criado para ${entry.companyName}`,
      companyId: entry.companyId,
      companyName: entry.companyName,
      after: entry,
      meta: {
        tenantId: entry.tenantId,
        subscriptionId: entry.subscriptionId,
        entryId: entry.id,
        nextEntryId: paidResult?.next?.id ?? null,
      },
    });
    if (entry.status === 'PAID') {
      MasterApiServices.recordAudit(req, {
        action: 'PAYMENT_REGISTERED',
        resource: 'subscription_finance',
        message: `Pagamento manual registrado para ${entry.companyName}`,
        companyId: entry.companyId,
        companyName: entry.companyName,
        after: entry,
        meta: { entryId: entry.id, tenantId: entry.tenantId },
      });
    }
    if (paidResult?.next) {
      MasterApiServices.recordAudit(req, {
        action: 'SUBSCRIPTION_CHARGE_CREATED',
        resource: 'subscription_finance',
        message: `Próxima cobrança criada para ${paidResult.next.companyName}`,
        companyId: paidResult.next.companyId,
        companyName: paidResult.next.companyName,
        after: paidResult.next,
        meta: { subscriptionId: paidResult.next.subscriptionId, previousEntryId: entry.id },
      });
    }
    const release = paidResult ? await afterPaymentConfirmed(entry) : null;
    res.status(201).json({
      ok: true,
      entry,
      nextEntry: paidResult?.next ?? null,
      release,
    });
  } catch (error) {
    sendError(res, error);
  }
}

/** PATCH /api/master/subscription-finance/:id */
export async function patchSubscriptionFinanceEntry(
  req: MasterApiRequest,
  res: Response,
): Promise<void> {
  try {
    if (!requireHumanMaster(req, res)) return;
    const data = body(req);
    const id = String(req.params.id || '');
    if (String(data.status || '').toUpperCase() === 'PAID') {
      const edited = await finance.updatePayment(id, {
        amountCents: readAmountCents(data),
        dueAt: data.dueAt == null ? undefined : String(data.dueAt),
        blockAt: data.blockAt === null ? null : data.blockAt ? String(data.blockAt) : undefined,
        paidAt: undefined,
        description: data.description == null ? undefined : String(data.description),
      });
      const result = await finance.markPaid(id, {
        paidAt: data.paidAt === null ? null : data.paidAt ? String(data.paidAt) : undefined,
      });
      MasterApiServices.recordAudit(req, {
        action: 'SUBSCRIPTION_PAYMENT_RECORDED',
        resource: 'subscription_finance',
        message: `Pagamento registrado para ${result.after.companyName}`,
        companyId: result.after.companyId,
        companyName: result.after.companyName,
        before: edited.before,
        after: result.after,
        meta: {
          tenantId: result.after.tenantId,
          subscriptionId: result.after.subscriptionId,
          entryId: result.after.id,
          nextEntryId: result.next?.id ?? null,
        },
      });
      MasterApiServices.recordAudit(req, {
        action: 'PAYMENT_REGISTERED',
        resource: 'subscription_finance',
        message: `Pagamento manual registrado para ${result.after.companyName}`,
        companyId: result.after.companyId,
        companyName: result.after.companyName,
        before: edited.before,
        after: result.after,
        meta: { entryId: result.after.id, tenantId: result.after.tenantId },
      });
      if (result.next) {
        MasterApiServices.recordAudit(req, {
          action: 'SUBSCRIPTION_CHARGE_CREATED',
          resource: 'subscription_finance',
          message: `Próxima cobrança criada para ${result.next.companyName}`,
          companyId: result.next.companyId,
          companyName: result.next.companyName,
          after: result.next,
          meta: { subscriptionId: result.next.subscriptionId, previousEntryId: result.after.id },
        });
      }
      const release = await afterPaymentConfirmed(result.after);
      res.json({ ok: true, entry: result.after, nextEntry: result.next, release });
      return;
    }

    const result = await finance.updatePayment(id, {
      amountCents: readAmountCents(data),
      dueAt: data.dueAt == null ? undefined : String(data.dueAt),
      blockAt: data.blockAt === null ? null : data.blockAt ? String(data.blockAt) : undefined,
      paidAt: data.paidAt === null ? null : data.paidAt ? String(data.paidAt) : undefined,
      status: data.status
        ? String(data.status).toUpperCase() as Extract<SubscriptionFinanceStatus, 'PENDING' | 'OVERDUE' | 'CANCELLED'>
        : undefined,
      description: data.description == null ? undefined : String(data.description),
    });
    MasterApiServices.recordAudit(req, {
      action: 'SUBSCRIPTION_CHARGE_UPDATED',
      resource: 'subscription_finance',
      message: `Lançamento financeiro atualizado para ${result.after.companyName}`,
      companyId: result.after.companyId,
      companyName: result.after.companyName,
      before: result.before,
      after: result.after,
      meta: {
        tenantId: result.after.tenantId,
        subscriptionId: result.after.subscriptionId,
        entryId: result.after.id,
      },
    });
    const cancelled =
      String(data.status || '').toUpperCase() === 'CANCELLED' ||
      (result.after.status === 'CANCELLED' && result.before.status !== 'CANCELLED');
    MasterApiServices.recordAudit(req, {
      action: cancelled ? 'PAYMENT_CANCELLED' : 'PAYMENT_UPDATED',
      resource: 'subscription_finance',
      message: cancelled
        ? `Pagamento cancelado para ${result.after.companyName}`
        : `Pagamento atualizado para ${result.after.companyName}`,
      companyId: result.after.companyId,
      companyName: result.after.companyName,
      before: result.before,
      after: result.after,
      meta: { entryId: result.after.id, tenantId: result.after.tenantId },
    });
    res.json({ ok: true, entry: result.after });
  } catch (error) {
    sendError(res, error);
  }
}

/** POST /api/master/subscription-finance/process-overdue */
export async function postProcessSubscriptionOverdues(
  req: MasterApiRequest,
  res: Response,
): Promise<void> {
  try {
    if (!requireHumanMaster(req, res)) return;
    const result = await processSubscriptionFinanceCycle({
      finance,
      tenants: MasterPlatformService.getTenantsService(),
      audit: MasterPlatformService.getAudit(),
    });
    MasterApiServices.recordAudit(req, {
      action: 'SUBSCRIPTION_OVERDUE_SCAN',
      resource: 'subscription_finance',
      message: 'Processamento manual de avisos e inadimplência concluído',
      after: result,
    });
    res.json({ ok: true, ...result });
  } catch (error) {
    sendError(res, error);
  }
}
