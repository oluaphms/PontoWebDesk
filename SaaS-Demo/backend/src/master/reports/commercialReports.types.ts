/**
 * Central de Relatórios Comerciais — tipos e agregações puras (FASE 29).
 */
export type CommercialReportPeriod = {
  from: string | null;
  to: string | null;
};

export type NamedCount = {
  name: string;
  count: number;
};

export type CommercialReportsKpis = {
  companiesByCity: NamedCount[];
  companiesByPlan: NamedCount[];
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

export type CommercialReportRow = {
  id: string;
  label: string;
  secondary?: string | null;
  value?: string | number | null;
  meta?: string | null;
};

export type CommercialReportsTables = {
  byCity: CommercialReportRow[];
  byPlan: CommercialReportRow[];
  licensesExpiring: CommercialReportRow[];
  withoutLogin: CommercialReportRow[];
  withoutUpdate: CommercialReportRow[];
  updatesCompleted: CommercialReportRow[];
  updatesFailed: CommercialReportRow[];
  implantationsCompleted: CommercialReportRow[];
};

export type CommercialReportsSnapshot = {
  period: CommercialReportPeriod;
  generatedAt: string;
  kpis: CommercialReportsKpis;
  tables: CommercialReportsTables;
  sources: {
    tenants: 'master_tenants' | 'unavailable';
    crm: 'master_crm' | 'unavailable';
    billing: 'billing' | 'payments+finance' | 'subscription_finance' | 'unavailable';
    licenses: 'license_manager' | 'unavailable';
    updates: 'update_control_plane' | 'unavailable';
    journey: 'commercial_onboardings' | 'unavailable';
  };
  note: string;
};

export function inPeriod(
  iso: string | null | undefined,
  fromMs: number | null,
  toMs: number | null,
): boolean {
  if (!iso) return false;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return false;
  if (fromMs != null && t < fromMs) return false;
  if (toMs != null && t > toMs) return false;
  return true;
}

export function parsePeriod(from?: string | null, to?: string | null): {
  from: string | null;
  to: string | null;
  fromMs: number | null;
  toMs: number | null;
} {
  const fromTrim = from?.trim() || null;
  const toTrim = to?.trim() || null;
  let fromMs: number | null = null;
  let toMs: number | null = null;
  if (fromTrim) {
    const t = Date.parse(fromTrim.includes('T') ? fromTrim : `${fromTrim}T00:00:00.000Z`);
    fromMs = Number.isFinite(t) ? t : null;
  }
  if (toTrim) {
    const t = Date.parse(toTrim.includes('T') ? toTrim : `${toTrim}T23:59:59.999Z`);
    toMs = Number.isFinite(t) ? t : null;
  }
  return { from: fromTrim, to: toTrim, fromMs, toMs };
}

export function groupCounts(values: Array<string | null | undefined>): NamedCount[] {
  const map = new Map<string, number>();
  for (const raw of values) {
    const name = String(raw || '').trim() || 'Sem informação';
    map.set(name, (map.get(name) ?? 0) + 1);
  }
  return [...map.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'pt-BR'));
}

export function emptyTables(): CommercialReportsTables {
  return {
    byCity: [],
    byPlan: [],
    licensesExpiring: [],
    withoutLogin: [],
    withoutUpdate: [],
    updatesCompleted: [],
    updatesFailed: [],
    implantationsCompleted: [],
  };
}

export function buildCommercialReportsSnapshot(input: {
  period: CommercialReportPeriod;
  kpis: CommercialReportsKpis;
  tables: CommercialReportsTables;
  sources: CommercialReportsSnapshot['sources'];
}): CommercialReportsSnapshot {
  return {
    period: input.period,
    generatedAt: new Date().toISOString(),
    kpis: input.kpis,
    tables: input.tables,
    sources: input.sources,
    note:
      'Central de Relatórios Comerciais — composição Master (tenants, CRM, billing, licenças, updates, jornada)',
  };
}
