import type { Request, Response } from 'express';
import { MasterError } from '../../master/errors.js';
import type { BillingCharge } from '../../master/billing/billing.types.js';
import type { MasterInvoice } from '../../master/types.js';
import { MasterPlatformService } from '../../services/master/masterPlatformService.js';
import { CommercialAutomationService } from '../../master/journey/CommercialAutomationService.js';

export type ChargeHistoryEvent = {
  at: string;
  event: string;
  note?: string;
};

/** Linha unificada da tela Cobranças (BillingService + BillingEngine). */
export type MasterChargeView = {
  id: string;
  source: 'invoice' | 'engine_charge';
  empresa: string;
  customerId: string | null;
  tenantId: string | null;
  subscriptionId: string | null;
  pix: string;
  valorCents: number;
  currency: string;
  pago: boolean;
  pendente: boolean;
  vencido: boolean;
  status: string;
  dueAt: string | null;
  paidAt: string | null;
  issuedAt: string;
  historico: ChargeHistoryEvent[];
  prompt: string;
  /** Hook futuro Asaas — ainda InMemory / sem HTTP. */
  asaas: {
    ready: boolean;
    provider: 'asaas';
    externalId: string | null;
    note: string;
  };
};

function readPrompt(meta?: Readonly<Record<string, unknown>>): string {
  const raw = meta?.prompt ?? meta?.aiPrompt ?? meta?.systemPrompt;
  if (typeof raw === 'string' && raw.trim()) return raw.trim();
  return '—';
}

function readPix(meta?: Readonly<Record<string, unknown>>): string {
  if (meta?.pixCopyPaste || meta?.pixQrCode || meta?.pix) return 'PIX (meta local)';
  return 'aguardando Asaas';
}

function buildHistory(input: {
  issuedAt: string;
  dueAt: string | null;
  paidAt: string | null;
  status: string;
  meta?: Readonly<Record<string, unknown>>;
}): ChargeHistoryEvent[] {
  const events: ChargeHistoryEvent[] = [
    { at: input.issuedAt, event: 'created', note: 'Cobrança criada (InMemory)' },
  ];
  if (input.dueAt) {
    events.push({ at: input.dueAt, event: 'due', note: 'Vencimento' });
  }
  if (input.paidAt) {
    events.push({ at: input.paidAt, event: 'paid', note: 'Pago (marcação local)' });
  }
  if (input.status === 'void') {
    events.push({ at: input.paidAt || input.issuedAt, event: 'void', note: 'Anulada' });
  }
  const custom = input.meta?.history;
  if (Array.isArray(custom)) {
    for (const item of custom) {
      if (item && typeof item === 'object') {
        const row = item as Record<string, unknown>;
        if (typeof row.at === 'string' && typeof row.event === 'string') {
          events.push({
            at: row.at,
            event: row.event,
            note: typeof row.note === 'string' ? row.note : undefined,
          });
        }
      }
    }
  }
  return events.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

async function resolveEmpresa(opts: {
  tenantId?: string | null;
  customerId?: string | null;
}): Promise<string> {
  if (opts.tenantId) {
    try {
      const managed = await MasterPlatformService.getTenants().get(opts.tenantId);
      return managed.company.name;
    } catch {
      /* fallthrough */
    }
  }
  if (opts.customerId) {
    return opts.customerId;
  }
  return '—';
}

function asaasStub(meta?: Readonly<Record<string, unknown>>): MasterChargeView['asaas'] {
  const externalId =
    typeof meta?.asaasPaymentId === 'string'
      ? meta.asaasPaymentId
      : typeof meta?.externalId === 'string'
        ? meta.externalId
        : null;
  return {
    ready: false,
    provider: 'asaas',
    externalId,
    note: 'asaas_integration_pending_in_memory_only',
  };
}

async function fromInvoice(inv: MasterInvoice, now = Date.now()): Promise<MasterChargeView> {
  const pago = inv.status === 'paid';
  const pendente = inv.status === 'open' || inv.status === 'draft';
  const dueMs = inv.dueAt ? Date.parse(inv.dueAt) : NaN;
  const vencido = pendente && Number.isFinite(dueMs) && dueMs < now;
  const empresa = await resolveEmpresa({
    tenantId: inv.tenantId,
    customerId: inv.customerId,
  });
  return {
    id: inv.id,
    source: 'invoice',
    empresa,
    customerId: inv.customerId,
    tenantId: inv.tenantId ?? null,
    subscriptionId: inv.subscriptionId ?? null,
    pix: readPix(inv.meta),
    valorCents: inv.amountCents,
    currency: inv.currency,
    pago,
    pendente,
    vencido,
    status: inv.status,
    dueAt: inv.dueAt ?? null,
    paidAt: inv.paidAt ?? null,
    issuedAt: inv.issuedAt,
    historico: buildHistory({
      issuedAt: inv.issuedAt,
      dueAt: inv.dueAt ?? null,
      paidAt: inv.paidAt ?? null,
      status: inv.status,
      meta: inv.meta,
    }),
    prompt: readPrompt(inv.meta),
    asaas: asaasStub(inv.meta),
  };
}

async function fromEngineCharge(
  charge: BillingCharge,
  now = Date.now(),
): Promise<MasterChargeView> {
  const pago = charge.status === 'paid';
  const pendente = charge.status === 'open';
  const dueMs = Date.parse(charge.dueAt);
  const vencido = pendente && Number.isFinite(dueMs) && dueMs < now;

  let empresa = charge.subscriptionId;
  let customerId: string | null = null;
  let tenantId: string | null = null;
  try {
    const sub = await MasterPlatformService.getDashboard().subscriptions.get(
      charge.subscriptionId,
    );
    const props = sub.toProps();
    customerId = props.customerId;
    tenantId = props.tenantId;
    empresa = await resolveEmpresa({ tenantId, customerId });
  } catch {
    /* keep subscriptionId as label */
  }

  return {
    id: charge.id,
    source: 'engine_charge',
    empresa,
    customerId,
    tenantId,
    subscriptionId: charge.subscriptionId,
    pix: readPix(charge.meta),
    valorCents: charge.amountCents,
    currency: charge.currency,
    pago,
    pendente,
    vencido,
    status: charge.status,
    dueAt: charge.dueAt,
    paidAt: charge.paidAt,
    issuedAt: charge.createdAt,
    historico: buildHistory({
      issuedAt: charge.createdAt,
      dueAt: charge.dueAt,
      paidAt: charge.paidAt,
      status: charge.status,
      meta: charge.meta,
    }),
    prompt: readPrompt(charge.meta),
    asaas: asaasStub(charge.meta),
  };
}

function sendMasterError(res: Response, error: unknown): void {
  if (error instanceof MasterError) {
    const status =
      error.code === 'MASTER_NOT_FOUND'
        ? 404
        : error.code === 'MASTER_CONFLICT'
          ? 409
          : error.code === 'MASTER_INVALID'
            ? 400
            : 500;
    res.status(status).json({
      ok: false,
      error: error.code,
      message: error.message,
    });
    return;
  }
  res.status(500).json({
    ok: false,
    error: 'master_charges_failed',
    message: error instanceof Error ? error.message : String(error),
  });
}

/** GET /api/master/charges — BillingService + BillingEngine (InMemory). */
export async function getMasterChargesController(_req: Request, res: Response): Promise<void> {
  try {
    const chargesMod = MasterPlatformService.getDashboard().charges;
    const billing = chargesMod.getBillingService();
    const [invoices, engineCharges] = await Promise.all([
      chargesMod.listInvoices(),
      chargesMod.listAllEngineCharges(),
    ]);

    const views = await Promise.all([
      ...invoices.map((inv) => fromInvoice(inv)),
      ...engineCharges.map((c) => fromEngineCharge(c)),
    ]);

    views.sort((a, b) => Date.parse(b.issuedAt) - Date.parse(a.issuedAt));

    const summary = {
      total: views.length,
      pago: views.filter((v) => v.pago).length,
      pendente: views.filter((v) => v.pendente).length,
      vencido: views.filter((v) => v.vencido).length,
      valorPagoCents: views.filter((v) => v.pago).reduce((s, v) => s + v.valorCents, 0),
      valorPendenteCents: views.filter((v) => v.pendente).reduce((s, v) => s + v.valorCents, 0),
    };

    res.json({
      ok: true,
      charges: views,
      summary,
      chargingEnabled: billing.isChargingEnabled(),
      persistence: 'in_memory',
      asaas: {
        ready: false,
        provider: 'asaas',
        note: 'Fase 26 — estrutura pronta; integração HTTP Asaas em fase futura',
      },
      note: 'BillingService InMemory — sem gateway real',
    });
  } catch (error) {
    sendMasterError(res, error);
  }
}

type ChargeAction = 'mark_paid';

/** POST /api/master/charges/:id/actions/:action */
export async function postMasterChargeActionController(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    const id = String(req.params.id || '').trim();
    const action = String(req.params.action || '').trim() as ChargeAction;
    const source = String(
      (req.body && typeof req.body === 'object'
        ? (req.body as { source?: string }).source
        : '') ||
        req.query.source ||
        '',
    ).trim() as 'invoice' | 'engine_charge' | '';

    if (!id) {
      res.status(400).json({ ok: false, error: 'invalid_id', message: 'id is required' });
      return;
    }
    if (action !== 'mark_paid') {
      res.status(400).json({
        ok: false,
        error: 'invalid_action',
        message: `Ação inválida: ${action}`,
        allowed: ['mark_paid'],
      });
      return;
    }

    const chargesMod = MasterPlatformService.getDashboard().charges;
    let view: MasterChargeView;

    if (source === 'engine_charge' || id.startsWith('chg_')) {
      const charge = await chargesMod.markEngineChargePaid(id);
      view = await fromEngineCharge(charge);
    } else {
      const invoice = await chargesMod.markInvoicePaid(id);
      view = await fromInvoice(invoice);
    }

    if (view.tenantId) {
      await CommercialAutomationService.tryFromPaymentRef({
        tenantId: view.tenantId,
        paymentRef: { type: view.source, id: view.id },
      });
    }

    res.json({
      ok: true,
      action,
      charge: view,
      asaas: { ready: false, note: 'local_only_no_asaas_capture' },
      automationTriggered: Boolean(view.tenantId),
      gatewayIntegrated: false,
    });
  } catch (error) {
    sendMasterError(res, error);
  }
}
