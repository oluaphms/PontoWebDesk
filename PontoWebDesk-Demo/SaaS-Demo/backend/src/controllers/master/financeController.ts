import type { Request, Response } from 'express';
import type { MasterInvoice } from '../../master/types.js';
import { MasterPlatformService } from '../../services/master/masterPlatformService.js';
import { composeCommercialReports } from '../../master/reports/composeCommercialReports.js';

/** KPIs do Painel Financeiro (legado + Central de Relatórios). */
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

const MOCK_METRICS: MasterFinanceMetrics = {
  receitaMensalCents: 128_450_00,
  mrrCents: 96_800_00,
  arrCents: 96_800_00 * 12,
  clientes: 142,
  inadimplenciaCents: 18_320_00,
  inadimplenciaRate: 0.124,
  ticketMedioCents: 68_200,
  planos: 7,
  receitaPorPlano: [
    { plan: 'STARTER', cents: 18_400_00 },
    { plan: 'PRO', cents: 42_600_00 },
    { plan: 'ENTERPRISE', cents: 31_200_00 },
    { plan: 'LOCAL', cents: 12_800_00 },
    { plan: 'HYBRID', cents: 23_450_00 },
  ],
  receitaLocalCents: 36_250_00,
  receitaSaasCents: 92_200_00,
  prompt: 'Painel financeiro — gestão do negócio',
};

const MOCK_SERIES: MasterFinanceMockSeries = {
  receitaMensal: [
    { month: 'Fev', cents: 82_100_00 },
    { month: 'Mar', cents: 91_400_00 },
    { month: 'Abr', cents: 88_750_00 },
    { month: 'Mai', cents: 104_200_00 },
    { month: 'Jun', cents: 112_900_00 },
    { month: 'Jul', cents: 128_450_00 },
  ],
  mrrTrend: [
    { month: 'Fev', mrr: 71_200_00 },
    { month: 'Mar', mrr: 76_500_00 },
    { month: 'Abr', mrr: 79_100_00 },
    { month: 'Mai', mrr: 85_400_00 },
    { month: 'Jun', mrr: 91_200_00 },
    { month: 'Jul', mrr: 96_800_00 },
  ],
  receitaPorPlano: [
    { plan: 'STARTER', cents: 18_400_00, fill: '#94a3b8' },
    { plan: 'PRO', cents: 42_600_00, fill: '#38bdf8' },
    { plan: 'ENTERPRISE', cents: 31_200_00, fill: '#a78bfa' },
    { plan: 'LOCAL', cents: 12_800_00, fill: '#64748b' },
    { plan: 'HYBRID', cents: 23_450_00, fill: '#2dd4bf' },
  ],
  mixLocalSaas: [
    { name: 'SaaS', value: 72, fill: '#38bdf8' },
    { name: 'Local', value: 28, fill: '#94a3b8' },
  ],
};

function isPaid(inv: MasterInvoice): boolean {
  return inv.status === 'paid';
}

function isOpen(inv: MasterInvoice): boolean {
  return inv.status === 'open' || inv.status === 'draft';
}

function isOverdue(inv: MasterInvoice, now = Date.now()): boolean {
  if (!isOpen(inv) || !inv.dueAt) return false;
  const due = Date.parse(inv.dueAt);
  return Number.isFinite(due) && due < now;
}

function readPlan(inv: MasterInvoice): string {
  const meta = inv.meta || {};
  if (typeof meta.plan === 'string' && meta.plan.trim()) return meta.plan.trim();
  return 'SEM_PLANO';
}

function readMode(inv: MasterInvoice): 'LOCAL' | 'SAAS' | 'OTHER' {
  const meta = inv.meta || {};
  const mode = String(meta.mode || meta.deploymentMode || '').toUpperCase();
  if (mode === 'LOCAL') return 'LOCAL';
  if (mode === 'SAAS' || mode === 'HYBRID') return 'SAAS';
  const plan = readPlan(inv).toUpperCase();
  if (plan === 'LOCAL') return 'LOCAL';
  return 'SAAS';
}

function readPrompt(invoices: MasterInvoice[]): string {
  for (const inv of invoices) {
    const raw = inv.meta?.prompt ?? inv.meta?.aiPrompt;
    if (typeof raw === 'string' && raw.trim()) return raw.trim();
  }
  return MOCK_METRICS.prompt;
}

function buildFinanceSnapshot(invoices: MasterInvoice[], plansCount: number) {
  const now = Date.now();
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const monthStartMs = monthStart.getTime();

  const paid = invoices.filter(isPaid);
  const overdue = invoices.filter((i) => isOverdue(i, now));
  const open = invoices.filter(isOpen);

  const paidCents = paid.reduce((s, i) => s + i.amountCents, 0);
  const overdueCents = overdue.reduce((s, i) => s + i.amountCents, 0);
  const openCents = open.reduce((s, i) => s + i.amountCents, 0);

  const paidThisMonth = paid.filter((i) => {
    const t = Date.parse(i.paidAt || i.issuedAt);
    return Number.isFinite(t) && t >= monthStartMs;
  });
  const receitaMensalFromBilling = paidThisMonth.reduce((s, i) => s + i.amountCents, 0);

  const customers = new Set(invoices.map((i) => i.customerId).filter(Boolean));
  const ticketMedioFromBilling =
    paid.length > 0 ? Math.round(paidCents / paid.length) : 0;

  const byPlan = new Map<string, number>();
  for (const inv of paid) {
    const plan = readPlan(inv);
    byPlan.set(plan, (byPlan.get(plan) || 0) + inv.amountCents);
  }
  const receitaPorPlanoFromBilling = [...byPlan.entries()].map(([plan, cents]) => ({
    plan,
    cents,
  }));

  let receitaLocal = 0;
  let receitaSaas = 0;
  for (const inv of paid) {
    if (readMode(inv) === 'LOCAL') receitaLocal += inv.amountCents;
    else receitaSaas += inv.amountCents;
  }

  const hasBillingData = invoices.length > 0;
  const allowMock =
    String(process.env.MASTER_FINANCE_MOCK || '').toLowerCase() === 'true' &&
    String(process.env.MASTER_PERSISTENCE || '').toLowerCase() !== 'postgres' &&
    String(process.env.NODE_ENV || '').toLowerCase() !== 'production';
  const totalExposure = paidCents + openCents;
  const inadimplenciaRateFromBilling =
    totalExposure > 0 ? overdueCents / totalExposure : 0;

  // MRR: aproximação a partir de faturas abertas/recorrentes do mês (sem inventar valores).
  const mrrFromBilling = (() => {
    const openThisCycle = open.reduce((s, i) => s + i.amountCents, 0);
    if (openThisCycle > 0) return openThisCycle;
    if (receitaMensalFromBilling > 0) return receitaMensalFromBilling;
    return 0;
  })();

  const metrics: MasterFinanceMetrics = {
    receitaMensalCents: hasBillingData
      ? receitaMensalFromBilling || paidCents
      : allowMock
        ? MOCK_METRICS.receitaMensalCents
        : 0,
    mrrCents: hasBillingData || !allowMock ? mrrFromBilling : MOCK_METRICS.mrrCents,
    arrCents:
      hasBillingData || !allowMock
        ? mrrFromBilling * 12
        : MOCK_METRICS.arrCents,
    clientes: hasBillingData
      ? Math.max(customers.size, 0)
      : allowMock
        ? MOCK_METRICS.clientes
        : 0,
    inadimplenciaCents: hasBillingData
      ? overdueCents
      : allowMock
        ? MOCK_METRICS.inadimplenciaCents
        : 0,
    inadimplenciaRate: hasBillingData
      ? inadimplenciaRateFromBilling
      : allowMock
        ? MOCK_METRICS.inadimplenciaRate
        : 0,
    ticketMedioCents: hasBillingData
      ? ticketMedioFromBilling
      : allowMock
        ? MOCK_METRICS.ticketMedioCents
        : 0,
    planos: plansCount || (allowMock ? MOCK_METRICS.planos : 0),
    receitaPorPlano: hasBillingData
      ? receitaPorPlanoFromBilling
      : allowMock
        ? MOCK_METRICS.receitaPorPlano
        : [],
    receitaLocalCents: hasBillingData
      ? receitaLocal
      : allowMock
        ? MOCK_METRICS.receitaLocalCents
        : 0,
    receitaSaasCents: hasBillingData
      ? receitaSaas
      : allowMock
        ? MOCK_METRICS.receitaSaasCents
        : 0,
    prompt: hasBillingData || !allowMock ? readPrompt(invoices) : MOCK_METRICS.prompt,
  };

  return {
    metrics,
    billing: {
      invoices: invoices.length,
      paidCents,
      openCents,
      overdueCents,
      chargingEnabled: false,
    },
    usedMockFallback: !hasBillingData && allowMock,
  };
}

/** GET /api/master/finance — Central de Relatórios + KPIs financeiros. */
export async function getMasterFinanceController(req: Request, res: Response): Promise<void> {
  try {
    const from = typeof req.query.from === 'string' ? req.query.from : null;
    const to = typeof req.query.to === 'string' ? req.query.to : null;

    const dashboard = MasterPlatformService.getDashboard();
    const billing = dashboard.charges.getBillingService();
    const invoices = await billing.list();
    const plansCount = dashboard.plans.count();
    const snapshot = buildFinanceSnapshot(invoices, plansCount);

    let reports = null;
    try {
      reports = await composeCommercialReports({ from, to });
      if (reports.sources.billing === 'billing') {
        snapshot.metrics.receitaMensalCents = reports.kpis.revenueMonthCents;
      }
      if (reports.sources.tenants === 'master_tenants') {
        snapshot.metrics.clientes =
          reports.kpis.clientsActive +
          reports.kpis.clientsBlocked +
          reports.kpis.clientsTrial;
      }
    } catch {
      reports = null;
    }

    res.json({
      ok: true,
      currency: 'BRL',
      gatewayIntegrated: false,
      chargingEnabled: billing.isChargingEnabled(),
      persistence: MasterPlatformService.getPersistence() === 'postgres' ? 'postgres' : 'in_memory',
      billing: snapshot.billing,
      metrics: snapshot.metrics,
      mock: snapshot.usedMockFallback ? MOCK_SERIES : {
        receitaMensal: [],
        mrrTrend: [],
        receitaPorPlano: snapshot.metrics.receitaPorPlano.map((p, i) => ({
          ...p,
          fill: ['#94a3b8', '#38bdf8', '#a78bfa', '#64748b', '#2dd4bf'][i % 5],
        })),
        mixLocalSaas: [
          { name: 'SaaS', value: snapshot.metrics.receitaSaasCents, fill: '#38bdf8' },
          { name: 'Local', value: snapshot.metrics.receitaLocalCents, fill: '#94a3b8' },
        ],
      },
      reports,
      period: { from, to },
      usedMockFallback: snapshot.usedMockFallback,
      sources: {
        billing: 'BillingService',
        mrrArr: 'mock',
        charts: 'mock',
        reports: reports ? 'composed' : 'unavailable',
      },
      note: 'FASE 29 — Central de Relatórios Comerciais (composição Master)',
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: 'master_finance_failed',
      message: error instanceof Error ? error.message : String(error),
    });
  }
}
