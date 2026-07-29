import { masterApi } from './masterApi';

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

export type CommercialReportRow = {
  id: string;
  label: string;
  secondary?: string | null;
  value?: string | number | null;
  meta?: string | null;
};

export type CommercialReportsSnapshot = {
  period: { from: string | null; to: string | null };
  generatedAt: string;
  kpis: {
    companiesByCity: Array<{ name: string; count: number }>;
    companiesByPlan: Array<{ name: string; count: number }>;
    clientsActive: number;
    clientsBlocked: number;
    clientsTrial: number;
    revenueMonthCents: number;
    revenueYearCents: number;
    licensesExpiring: number;
    companiesWithoutLogin: number;
    companiesWithoutUpdate: number;
    updatesCompleted: number;
    updatesFailed: number;
    implantationsCompleted: number;
  };
  tables: {
    byCity: CommercialReportRow[];
    byPlan: CommercialReportRow[];
    licensesExpiring: CommercialReportRow[];
    withoutLogin: CommercialReportRow[];
    withoutUpdate: CommercialReportRow[];
    updatesCompleted: CommercialReportRow[];
    updatesFailed: CommercialReportRow[];
    implantationsCompleted: CommercialReportRow[];
  };
  sources: Record<string, string>;
  note: string;
};

export type MasterFinanceResponse = {
  ok: boolean;
  currency: 'BRL' | string;
  gatewayIntegrated: boolean;
  chargingEnabled: boolean;
  persistence: string;
  billing: {
    invoices: number;
    paidCents: number;
    openCents: number;
    overdueCents: number;
    chargingEnabled: boolean;
  };
  metrics: MasterFinanceMetrics;
  mock: {
    receitaMensal: Array<{ month: string; cents: number }>;
    mrrTrend: Array<{ month: string; mrr: number }>;
    receitaPorPlano: Array<{ plan: string; cents: number; fill: string }>;
    mixLocalSaas: Array<{ name: string; value: number; fill: string }>;
  };
  reports?: CommercialReportsSnapshot | null;
  period?: { from: string | null; to: string | null };
  usedMockFallback: boolean;
  sources: {
    billing: string;
    mrrArr: string;
    charts: string;
    reports?: string;
  };
  note?: string;
};

export async function fetchMasterFinance(period?: {
  from?: string;
  to?: string;
}): Promise<MasterFinanceResponse> {
  const params = new URLSearchParams();
  if (period?.from) params.set('from', period.from);
  if (period?.to) params.set('to', period.to);
  const qs = params.toString();
  return masterApi<MasterFinanceResponse>(`/finance${qs ? `?${qs}` : ''}`);
}

export function formatFinanceMoney(cents: number, currency = 'BRL'): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency,
  }).format((cents || 0) / 100);
}

export function formatPercent(rate: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'percent',
    maximumFractionDigits: 1,
  }).format(rate || 0);
}
