/**
 * Controllers do Billing Engine desacoplado (InMemory / mock adapters).
 */
import type { Request, Response } from 'express';
import { MasterError } from '../../errors.js';
import { MasterPlatformService } from '../../../services/master/masterPlatformService.js';
import type { BillingProviderName } from '../../billingEngine/types.js';
import type { MasterApiRequest } from '../middlewares/requireMasterLogin.js';
import { MasterApiServices } from '../services/index.js';
import { CommercialAutomationService } from '../../journey/CommercialAutomationService.js';

function sendError(res: Response, error: unknown): void {
  if (error instanceof MasterError) {
    const status =
      error.code === 'MASTER_NOT_FOUND'
        ? 404
        : error.code === 'MASTER_CONFLICT'
          ? 409
          : error.code === 'MASTER_INVALID'
            ? 400
            : 500;
    res.status(status).json({ ok: false, error: error.code, message: error.message });
    return;
  }
  res.status(500).json({
    ok: false,
    error: 'master_billing_failed',
    message: error instanceof Error ? error.message : String(error),
  });
}

function engine() {
  return MasterPlatformService.getBillingEngine();
}

function audit(
  req: MasterApiRequest,
  action: string,
  resource: string,
  message: string,
  extra?: {
    companyId?: string | null;
    companyName?: string | null;
    before?: Record<string, unknown> | null;
    after?: Record<string, unknown> | null;
    meta?: Record<string, unknown>;
  },
): void {
  MasterApiServices.recordAudit(req, {
    action,
    resource,
    message,
    companyId: extra?.companyId ?? null,
    companyName: extra?.companyName ?? null,
    before: extra?.before ?? null,
    after: extra?.after ?? null,
    meta: extra?.meta,
  });
}

async function triggerAutomationAfterManualPaid(input: {
  tenantId?: string | null;
  paymentRef: { type: string; id: string };
  actor?: { userId?: string | null; email?: string | null };
}): Promise<void> {
  await CommercialAutomationService.tryFromPaymentRef(input);
}

async function resolveTenantFromInvoiceId(invoiceId: string | null | undefined): Promise<string | null> {
  if (!invoiceId) return null;
  try {
    const invoices = await engine().listInvoices();
    return invoices.find((i) => i.id === invoiceId)?.tenantId ?? null;
  } catch {
    return null;
  }
}

/** GET /api/master/billing */
export async function getBillingSnapshot(_req: Request, res: Response): Promise<void> {
  try {
    const snapshot = await engine().snapshot();
    res.json({
      ok: true,
      ...snapshot,
      note: 'Billing Engine desacoplado — adapters mock; sem gateway HTTP',
    });
  } catch (error) {
    sendError(res, error);
  }
}

/** POST /api/master/billing/provider */
export async function postBillingProvider(req: MasterApiRequest, res: Response): Promise<void> {
  try {
    const name = String(req.body?.provider || '').trim().toLowerCase() as BillingProviderName;
    if (!['asaas', 'pagseguro', 'stripe'].includes(name)) {
      res.status(400).json({
        ok: false,
        error: 'validation_error',
        message: 'provider must be asaas | pagseguro | stripe',
      });
      return;
    }
    const snapshot = await engine().setProvider(name);
    audit(req, 'BILLING_PROVIDER_SET', 'billing', `Active provider: ${name}`);
    res.json({ ok: true, ...snapshot });
  } catch (error) {
    sendError(res, error);
  }
}

/** GET /api/master/invoices */
export async function getInvoices(_req: Request, res: Response): Promise<void> {
  try {
    const invoices = await engine().listInvoices();
    const snap = await engine().snapshot();
    res.json({
      ok: true,
      invoices,
      count: invoices.length,
      provider: snap.provider,
      externalReady: false,
      persistence: snap.persistence,
    });
  } catch (error) {
    sendError(res, error);
  }
}

/** POST /api/master/invoices */
export async function postInvoice(req: MasterApiRequest, res: Response): Promise<void> {
  try {
    const description = String(req.body?.description || '').trim();
    const amountCents = Number(req.body?.amountCents);
    if (!description || !Number.isFinite(amountCents) || amountCents <= 0) {
      res.status(400).json({
        ok: false,
        error: 'validation_error',
        message: 'description and amountCents (>0) are required',
      });
      return;
    }
    const invoice = await engine().createInvoice({
      description,
      amountCents,
      tenantId: req.body?.tenantId ?? null,
      customerId: req.body?.customerId ?? null,
      currency: req.body?.currency,
      dueAt: req.body?.dueAt ?? null,
    });
    audit(req, 'INVOICE_CREATED', 'invoices', invoice.id, {
      companyId: invoice.tenantId ?? null,
      before: null,
      after: {
        id: invoice.id,
        status: invoice.status,
        amountCents: invoice.amountCents,
        tenantId: invoice.tenantId ?? null,
      },
    });
    res.status(201).json({ ok: true, invoice });
  } catch (error) {
    sendError(res, error);
  }
}

/** POST /api/master/invoices/:id/actions/:action */
export async function postInvoiceAction(req: MasterApiRequest, res: Response): Promise<void> {
  try {
    const id = String(req.params.id || '');
    const action = String(req.params.action || '').toLowerCase();
    const before =
      (await engine().listInvoices()).find((row) => row.id === id) ?? null;
    let invoice;
    if (action === 'mark_paid' || action === 'pay') {
      invoice = await engine().markInvoicePaid(id);
      await triggerAutomationAfterManualPaid({
        tenantId: invoice.tenantId,
        paymentRef: { type: 'invoice', id },
        actor: { userId: req.masterAuth?.userId, email: req.masterAuth?.email },
      });
    } else if (action === 'void') {
      invoice = await engine().voidInvoice(id);
    } else if (action === 'delete') {
      invoice = await engine().deleteInvoice(id);
    } else {
      res.status(400).json({ ok: false, error: 'unknown_action', message: `action=${action}` });
      return;
    }
    audit(req, `INVOICE_${action.toUpperCase()}`, 'invoices', id, {
      companyId: invoice.tenantId ?? before?.tenantId ?? null,
      before: before
        ? { id: before.id, status: before.status, amountCents: before.amountCents }
        : null,
      after: { id: invoice.id, status: invoice.status, amountCents: invoice.amountCents },
    });
    res.json({ ok: true, invoice });
  } catch (error) {
    sendError(res, error);
  }
}

/** GET /api/master/payments — Billing Engine (substitui listagem legada no shell novo). */
export async function getBillingPayments(_req: Request, res: Response): Promise<void> {
  try {
    const [payments, refunds, snap] = await Promise.all([
      engine().listPayments(),
      engine().listRefunds(),
      engine().snapshot(),
    ]);
    res.json({
      ok: true,
      payments,
      refunds,
      count: payments.length,
      provider: snap.provider,
      adapters: snap.adapters,
      externalReady: false,
      persistence: snap.persistence,
      note: 'DecoupledBillingEngine — Asaas/PagSeguro/Stripe mock',
    });
  } catch (error) {
    sendError(res, error);
  }
}

/** POST /api/master/payments */
export async function postBillingPayment(req: MasterApiRequest, res: Response): Promise<void> {
  try {
    const amountCents = Number(req.body?.amountCents);
    if (!Number.isFinite(amountCents) || amountCents <= 0) {
      res.status(400).json({
        ok: false,
        error: 'validation_error',
        message: 'amountCents (>0) is required',
      });
      return;
    }
    const payment = await engine().createPayment({
      amountCents,
      method: req.body?.method,
      invoiceId: req.body?.invoiceId ?? null,
      currency: req.body?.currency,
      description: req.body?.description ?? null,
    });
    audit(req, 'PAYMENT_CREATED', 'payments', payment.id);
    res.status(201).json({ ok: true, payment });
  } catch (error) {
    sendError(res, error);
  }
}

/** POST /api/master/payments/:id/actions/:action */
export async function postBillingPaymentAction(
  req: MasterApiRequest,
  res: Response,
): Promise<void> {
  try {
    const id = String(req.params.id || '');
    const action = String(req.params.action || '').toLowerCase();
    if (action === 'mark_paid' || action === 'pay') {
      const payment = await engine().markPaymentPaid(id);
      const tenantId = await resolveTenantFromInvoiceId(payment.invoiceId);
      await triggerAutomationAfterManualPaid({
        tenantId,
        paymentRef: { type: 'payment', id },
        actor: { userId: req.masterAuth?.userId, email: req.masterAuth?.email },
      });
      audit(req, 'PAYMENT_PAID', 'payments', id);
      res.json({ ok: true, payment });
      return;
    }
    if (action === 'cancel') {
      const payment = await engine().cancelPayment(id);
      audit(req, 'PAYMENT_CANCELLED', 'payments', id);
      res.json({ ok: true, payment });
      return;
    }
    if (action === 'delete') {
      const payment = await engine().deletePayment(id);
      audit(req, 'PAYMENT_DELETED', 'payments', id);
      res.json({ ok: true, payment });
      return;
    }
    if (action === 'refund') {
      const refund = await engine().createRefund({
        paymentId: id,
        amountCents: req.body?.amountCents,
        reason: req.body?.reason ?? null,
      });
      audit(req, 'PAYMENT_REFUNDED', 'payments', id);
      res.json({ ok: true, refund });
      return;
    }
    res.status(400).json({ ok: false, error: 'unknown_action', message: `action=${action}` });
  } catch (error) {
    sendError(res, error);
  }
}

/** GET /api/master/pix */
export async function getPixCharges(_req: Request, res: Response): Promise<void> {
  try {
    const pix = await engine().listPix();
    const snap = await engine().snapshot();
    res.json({
      ok: true,
      pix,
      count: pix.length,
      provider: snap.provider,
      externalReady: false,
      persistence: snap.persistence,
    });
  } catch (error) {
    sendError(res, error);
  }
}

/** POST /api/master/pix */
export async function postPixCharge(req: MasterApiRequest, res: Response): Promise<void> {
  try {
    const amountCents = Number(req.body?.amountCents);
    if (!Number.isFinite(amountCents) || amountCents <= 0) {
      res.status(400).json({
        ok: false,
        error: 'validation_error',
        message: 'amountCents (>0) is required',
      });
      return;
    }
    const charge = await engine().createPix({
      amountCents,
      description: req.body?.description ?? null,
      invoiceId: req.body?.invoiceId ?? null,
      currency: req.body?.currency,
      expiresInSeconds: req.body?.expiresInSeconds,
    });
    audit(req, 'PIX_CREATED', 'pix', charge.id);
    res.status(201).json({ ok: true, pix: charge });
  } catch (error) {
    sendError(res, error);
  }
}

/** POST /api/master/pix/:id/actions/:action */
export async function postPixAction(req: MasterApiRequest, res: Response): Promise<void> {
  try {
    const id = String(req.params.id || '');
    const action = String(req.params.action || '').toLowerCase();
    if (action === 'mark_paid' || action === 'pay') {
      const pix = await engine().markPixPaid(id);
      const tenantId = await resolveTenantFromInvoiceId(pix.invoiceId);
      await triggerAutomationAfterManualPaid({
        tenantId,
        paymentRef: { type: 'pix', id },
        actor: { userId: req.masterAuth?.userId, email: req.masterAuth?.email },
      });
      audit(req, 'PIX_PAID', 'pix', id);
      res.json({ ok: true, pix });
      return;
    }
    if (action === 'cancel') {
      const pix = await engine().cancelPix(id);
      audit(req, 'PIX_CANCELLED', 'pix', id);
      res.json({ ok: true, pix });
      return;
    }
    res.status(400).json({ ok: false, error: 'unknown_action', message: `action=${action}` });
  } catch (error) {
    sendError(res, error);
  }
}

/** GET /api/master/billing/webhooks */
export async function getBillingWebhooks(_req: Request, res: Response): Promise<void> {
  try {
    const [webhooks, snap] = await Promise.all([
      engine().listWebhooks(),
      engine().snapshot(),
    ]);
    res.json({
      ok: true,
      webhooks,
      count: webhooks.length,
      persistence: snap.persistence,
    });
  } catch (error) {
    sendError(res, error);
  }
}
