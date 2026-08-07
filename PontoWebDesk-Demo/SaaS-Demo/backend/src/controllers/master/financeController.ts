import type { Request, Response } from 'express';
import { MasterPlatformService } from '../../services/master/masterPlatformService.js';
import { composeCommercialReports } from '../../master/reports/composeCommercialReports.js';
import { SubscriptionFinanceService } from '../../master/subscriptionFinance/SubscriptionFinanceService.js';
import { loadSubscriptionMrrCents } from '../../master/dashboard/dashboardRevenueSignals.js';

/** KPIs do Painel Financeiro — SoT: master_subscription_finance_entries + subscriptions. */
export type MasterFinanceMetrics = {
  receitaMensalCents: number;
  mrrCents: number;
  arrCents: number;
  clientes: number;
  inadimplenciaCents: number;
  inadimplenciaRate: number;
  ticketMedioCents: number;
  planos: number;
  receitaPorPlano: Array<{ plan: string; cents: number }>;
  receitaLocalCents: number;
  receitaSaasCents: number;
  prompt: string;
};

export type MasterFinanceMockSeries = {
  receitaMensal: Array<{ month: string; cents: number }>;
  mrrTrend: Array<{ month: string; mrr: number }>;
  receitaPorPlano: Array<{ plan: string; cents: number; fill: string }>;
  mixLocalSaas: Array<{ name: string; value: number; fill: string }>;
};

const EMPTY_SERIES: MasterFinanceMockSeries = {
  receitaMensal: [],
  mrrTrend: [],
  receitaPorPlano: [],
  mixLocalSaas: [],
};

/** GET /api/master/finance — Central de Relatórios + KPIs (ledger único). */
export async function getMasterFinanceController(req: Request, res: Response): Promise<void> {
  try {
    const from = typeof req.query.from === 'string' ? req.query.from : null;
    const to = typeof req.query.to === 'string' ? req.query.to : null;

    const finance = new SubscriptionFinanceService();
    const [payments, reports, mrrCents, plansCount] = await Promise.all([
      finance.listAllPayments(5000),
      composeCommercialReports({ from, to }).catch(() => null),
      loadSubscriptionMrrCents().catch(() => null),
      Promise.resolve(MasterPlatformService.getDashboard().plans.count()),
    ]);

    const resolvedMrr = Math.max(0, Math.floor(mrrCents ?? 0));

    const now = Date.now();
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const monthStartMs = monthStart.getTime();

    const paid = payments.filter((p) => p.status === 'PAID');
    const overdue = payments.filter((p) => p.status === 'OVERDUE');
    const pending = payments.filter((p) => p.status === 'PENDING' || p.status === 'OVERDUE');

    const paidThisMonth = paid.filter((p) => {
      const t = Date.parse(p.paidAt || p.eventAt);
      return Number.isFinite(t) && t >= monthStartMs;
    });
    const receitaMensalCents =
      reports?.kpis.revenueMonthCents ??
      paidThisMonth.reduce((s, p) => s + Math.max(0, p.amountCents || 0), 0);
    const paidCents = paid.reduce((s, p) => s + Math.max(0, p.amountCents || 0), 0);
    const overdueCents = overdue.reduce((s, p) => s + Math.max(0, p.amountCents || 0), 0);
    const openCents = pending.reduce((s, p) => s + Math.max(0, p.amountCents || 0), 0);
    const exposure = paidCents + openCents;

    let clientes = 0;
    if (reports) {
      clientes =
        reports.kpis.clientsActive +
        reports.kpis.clientsBlocked +
        reports.kpis.clientsTrial;
    }

    const metrics: MasterFinanceMetrics = {
      receitaMensalCents,
      mrrCents: resolvedMrr,
      arrCents: resolvedMrr * 12,
      clientes,
      inadimplenciaCents: overdueCents,
      inadimplenciaRate: exposure > 0 ? overdueCents / exposure : 0,
      ticketMedioCents: paid.length > 0 ? Math.round(paidCents / paid.length) : 0,
      planos: plansCount,
      receitaPorPlano: [],
      receitaLocalCents: 0,
      receitaSaasCents: paidCents,
      prompt: 'Painel financeiro — ledger subscription_finance',
    };

    res.json({
      ok: true,
      currency: 'BRL',
      gatewayIntegrated: false,
      chargingEnabled: false,
      persistence: MasterPlatformService.getPersistence() === 'postgres' ? 'postgres' : 'in_memory',
      billing: {
        invoices: payments.length,
        paidCents,
        openCents,
        overdueCents,
        chargingEnabled: false,
      },
      metrics,
      mock: EMPTY_SERIES,
      sources: {
        billing: 'subscription_finance',
        mrrArr: 'master_subscriptions',
        generatedAt: new Date(now).toISOString(),
      },
      reports,
      note: 'SoT: master_subscription_finance_entries + master_subscriptions (MRR)',
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: 'master_finance_failed',
      message: error instanceof Error ? error.message : String(error),
    });
  }
}
