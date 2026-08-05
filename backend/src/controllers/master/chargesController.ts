import type { Request, Response } from 'express';
import { MasterError } from '../../master/errors.js';
import { MasterPlatformService } from '../../services/master/masterPlatformService.js';
import { CommercialAutomationService } from '../../master/journey/CommercialAutomationService.js';
import { SubscriptionFinanceService } from '../../master/subscriptionFinance/SubscriptionFinanceService.js';
import type { SubscriptionFinanceEntry } from '../../master/subscriptionFinance/subscriptionFinance.types.js';

export type ChargeHistoryEvent = {
  at: string;
  event: string;
  note?: string;
};

/** Linha unificada da tela Cobranças — SoT subscription finance. */
export type MasterChargeView = {
  id: string;
  source: 'subscription_finance';
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
  asaas: {
    ready: boolean;
    provider: 'asaas';
    externalId: string | null;
    note: string;
  };
};

function buildHistory(entry: SubscriptionFinanceEntry): ChargeHistoryEvent[] {
  const events: ChargeHistoryEvent[] = [
    { at: entry.createdAt, event: 'created', note: 'Cobrança no ledger oficial' },
  ];
  if (entry.dueAt) events.push({ at: entry.dueAt, event: 'due', note: 'Vencimento' });
  if (entry.paidAt) events.push({ at: entry.paidAt, event: 'paid', note: 'Pago' });
  if (entry.status === 'CANCELLED') {
    events.push({ at: entry.updatedAt, event: 'void', note: 'Cancelada' });
  }
  return events.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

function fromFinanceEntry(entry: SubscriptionFinanceEntry, now = Date.now()): MasterChargeView {
  const pago = entry.status === 'PAID';
  const pendente = entry.status === 'PENDING' || entry.status === 'OVERDUE';
  const dueMs = entry.dueAt ? Date.parse(entry.dueAt) : NaN;
  const vencido =
    entry.status === 'OVERDUE' ||
    (entry.status === 'PENDING' && Number.isFinite(dueMs) && dueMs < now);
  return {
    id: entry.id,
    source: 'subscription_finance',
    empresa: entry.companyName || entry.companyId || '—',
    customerId: null,
    tenantId: entry.tenantId,
    subscriptionId: entry.subscriptionId,
    pix: 'aguardando gateway',
    valorCents: Math.max(0, entry.amountCents || 0),
    currency: entry.currency || 'BRL',
    pago,
    pendente,
    vencido,
    status: entry.status.toLowerCase(),
    dueAt: entry.dueAt,
    paidAt: entry.paidAt,
    issuedAt: entry.createdAt,
    historico: buildHistory(entry),
    prompt: entry.description || '—',
    asaas: {
      ready: false,
      provider: 'asaas',
      externalId: null,
      note: 'ledger_official_gateway_optional',
    },
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

/** GET /api/master/charges — ledger único (subscription finance). */
export async function getMasterChargesController(_req: Request, res: Response): Promise<void> {
  try {
    const finance = new SubscriptionFinanceService();
    const entries = await finance.listAllPayments(5000);
    const views = entries.map((e) => fromFinanceEntry(e));
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
      chargingEnabled: false,
      persistence: MasterPlatformService.getPersistence() === 'postgres' ? 'postgres' : 'in_memory',
      asaas: {
        ready: false,
        provider: 'asaas',
        note: 'SoT ledger — gateway Asaas opcional em fase futura',
      },
      note: 'SoT: master_subscription_finance_entries',
      source: 'subscription_finance',
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

    const finance = new SubscriptionFinanceService();
    const { after } = await finance.markPaid(id);
    const view = fromFinanceEntry(after);

    if (view.tenantId) {
      await CommercialAutomationService.tryFromPaymentRef({
        tenantId: view.tenantId,
        paymentRef: { type: 'subscription_finance', id: view.id },
      });
    }

    res.json({
      ok: true,
      action,
      charge: view,
      asaas: { ready: false, note: 'ledger_official' },
      automationTriggered: Boolean(view.tenantId),
      gatewayIntegrated: false,
    });
  } catch (error) {
    sendMasterError(res, error);
  }
}
