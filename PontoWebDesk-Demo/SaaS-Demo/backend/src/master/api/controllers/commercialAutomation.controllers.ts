import type { Response } from 'express';
import type { MasterApiRequest } from '../middlewares/requireMasterLogin.js';
import { CommercialJourneyError } from '../../journey/CommercialJourneyService.js';
import { CommercialAutomationService } from '../../journey/CommercialAutomationService.js';
import { MasterNotifications } from '../../journey/masterNotifications.js';
import { MasterApiServices } from '../services/index.js';

function sendError(res: Response, error: unknown): void {
  if (error instanceof CommercialJourneyError) {
    res.status(error.status).json({
      ok: false,
      code: error.code,
      error: error.message,
      message: error.message,
    });
    return;
  }
  const status =
    error && typeof error === 'object' && 'status' in error
      ? Number((error as { status?: number }).status) || 500
      : 500;
  const code =
    error && typeof error === 'object' && 'code' in error
      ? String((error as { code?: string }).code || 'COMMERCIAL_AUTOMATION_FAILED')
      : 'COMMERCIAL_AUTOMATION_FAILED';
  const message = error instanceof Error ? error.message : 'Falha na automação comercial.';
  res.status(status).json({ ok: false, code, error: message, message });
}

function audit(
  req: MasterApiRequest,
  input: {
    action: string;
    message: string;
    companyId: string;
    before?: Record<string, unknown> | null;
    after?: Record<string, unknown> | null;
    meta?: Record<string, unknown>;
  },
): void {
  MasterApiServices.recordAudit(req, {
    action: input.action,
    resource: 'automation',
    message: input.message,
    companyId: input.companyId,
    before: input.before ?? null,
    after: input.after ?? null,
    meta: input.meta,
  });
}

/** GET /api/master/tenants/:id/automation */
export async function getCommercialAutomation(
  req: MasterApiRequest,
  res: Response,
): Promise<void> {
  try {
    const automation = await CommercialAutomationService.get(String(req.params.id || '').trim());
    res.json({ ok: true, automation });
  } catch (error) {
    sendError(res, error);
  }
}

/**
 * POST /api/master/tenants/:id/automation/confirm-payment
 * Confirmação MANUAL de pagamento (sem gateway) + pipeline automático.
 */
export async function postCommercialAutomationConfirmPayment(
  req: MasterApiRequest,
  res: Response,
): Promise<void> {
  try {
    const tenantId = String(req.params.id || '').trim();
    const before = await CommercialAutomationService.get(tenantId).catch(() => null);
    const paymentRef = {
      type: String(req.body?.paymentRefType || 'manual'),
      id: String(req.body?.paymentRefId || `manual:${tenantId}`),
    };
    const automation = await CommercialAutomationService.onPaymentConfirmed({
      tenantId,
      paymentRef,
      actor: {
        userId: req.masterAuth?.userId,
        email: req.masterAuth?.email,
      },
      force: req.body?.force === true,
    });
    audit(req, {
      action: 'AUTOMATION_PAYMENT_CONFIRMED',
      message: `Pagamento confirmado (manual): ${tenantId}`,
      companyId: tenantId,
      before: before
        ? { status: before.state.status, lastStep: before.state.timeline?.at(-1)?.step }
        : null,
      after: {
        status: automation.state.status,
        lastStep: automation.state.timeline?.at(-1)?.step,
        paymentRef,
      },
      meta: { force: req.body?.force === true },
    });
    res.json({
      ok: true,
      automation,
      gatewayIntegrated: false,
      note: 'Pagamento confirmado manualmente — pipeline automático executado (sem gateway)',
    });
  } catch (error) {
    sendError(res, error);
  }
}

/** POST /api/master/tenants/:id/automation/retry */
export async function postCommercialAutomationRetry(
  req: MasterApiRequest,
  res: Response,
): Promise<void> {
  try {
    const tenantId = String(req.params.id || '').trim();
    const before = await CommercialAutomationService.get(tenantId).catch(() => null);
    const automation = await CommercialAutomationService.retry(tenantId, {
      userId: req.masterAuth?.userId,
      email: req.masterAuth?.email,
    });
    audit(req, {
      action: 'AUTOMATION_RETRY',
      message: `Retry automação: ${tenantId}`,
      companyId: tenantId,
      before: before ? { status: before.state.status } : null,
      after: { status: automation.state.status },
    });
    res.json({ ok: true, automation });
  } catch (error) {
    sendError(res, error);
  }
}

/** GET /api/master/notifications */
export async function getMasterNotifications(
  req: MasterApiRequest,
  res: Response,
): Promise<void> {
  try {
    const limit = Number(req.query.limit) || 50;
    const tenantId =
      typeof req.query.tenantId === 'string' ? req.query.tenantId.trim() : undefined;
    const notifications = MasterNotifications.list(limit, tenantId || null);
    res.json({
      ok: true,
      notifications,
      unreadCount: MasterNotifications.unreadCount(tenantId || null),
      count: notifications.length,
    });
  } catch (error) {
    sendError(res, error);
  }
}

/** POST /api/master/notifications/read-all */
export async function postMasterNotificationsReadAll(
  req: MasterApiRequest,
  res: Response,
): Promise<void> {
  try {
    const tenantId =
      typeof req.body?.tenantId === 'string' ? req.body.tenantId.trim() : undefined;
    const marked = MasterNotifications.markAllRead(tenantId || null);
    res.json({ ok: true, marked });
  } catch (error) {
    sendError(res, error);
  }
}

/** POST /api/master/notifications/:id/read */
export async function postMasterNotificationRead(
  req: MasterApiRequest,
  res: Response,
): Promise<void> {
  try {
    const row = MasterNotifications.markRead(String(req.params.id || '').trim());
    if (!row) {
      res.status(404).json({ ok: false, code: 'NOT_FOUND', message: 'Notificação não encontrada' });
      return;
    }
    res.json({ ok: true, notification: row });
  } catch (error) {
    sendError(res, error);
  }
}
