/**
 * Composição da Central de Relatórios Comerciais (FASE 29).
 * Somente leitura — não altera operacional.
 */
import { pool } from '../../db/index.js';
import { MasterPlatformService } from '../../services/master/masterPlatformService.js';
import { CommercialCrmService } from '../crm/CommercialCrmService.js';
import { UpdateControlPlaneService } from '../updates/UpdateControlPlaneService.js';
import {
  buildCommercialReportsSnapshot,
  emptyTables,
  groupCounts,
  inPeriod,
  parsePeriod,
  type CommercialReportRow,
  type CommercialReportsSnapshot,
  type CommercialReportsTables,
} from './commercialReports.types.js';

function startOfMonthMs(now = Date.now()): number {
  const d = new Date(now);
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
}

function startOfYearMs(now = Date.now()): number {
  const d = new Date(now);
  return new Date(d.getFullYear(), 0, 1).getTime();
}

async function countImplantationsCompleted(
  fromMs: number | null,
  toMs: number | null,
): Promise<{ count: number; rows: CommercialReportRow[] }> {
  try {
    const result = await pool.queryMaster<{
      master_tenant_id: string;
      implantation_completed_at: string;
      admin_email: string | null;
    }>(
      `select master_tenant_id,
              implantation_completed_at::text as implantation_completed_at,
              admin_email
         from public.master_commercial_onboardings
        where implantation_completed_at is not null
        order by implantation_completed_at desc
        limit 500`,
    );
    const filtered = result.rows.filter((row) =>
      inPeriod(row.implantation_completed_at, fromMs, toMs),
    );
    return {
      count: filtered.length,
      rows: filtered.map((row) => ({
        id: row.master_tenant_id,
        label: row.master_tenant_id,
        secondary: row.admin_email,
        value: row.implantation_completed_at,
        meta: 'Implantação concluída',
      })),
    };
  } catch {
    return { count: 0, rows: [] };
  }
}

async function listWithoutLogin(): Promise<CommercialReportRow[]> {
  try {
    const result = await pool.queryMaster<{
      master_tenant_id: string;
      admin_email: string;
      state: string;
    }>(
      `select master_tenant_id, admin_email, state
         from public.master_commercial_onboardings
        where first_login_at is null
          and state in ('pending', 'provisioning', 'awaiting_first_login')
        order by updated_at desc
        limit 500`,
    );
    return result.rows.map((row) => ({
      id: row.master_tenant_id,
      label: row.master_tenant_id,
      secondary: row.admin_email,
      value: row.state,
      meta: 'Sem primeiro login',
    }));
  } catch {
    return [];
  }
}

export async function composeCommercialReports(opts?: {
  from?: string | null;
  to?: string | null;
}): Promise<CommercialReportsSnapshot> {
  const period = parsePeriod(opts?.from, opts?.to);
  const now = Date.now();
  const monthStart = startOfMonthMs(now);
  const yearStart = startOfYearMs(now);
  const revenueFromMs = period.fromMs ?? null;
  const revenueToMs = period.toMs ?? null;

  const sources: CommercialReportsSnapshot['sources'] = {
    tenants: 'unavailable',
    crm: 'unavailable',
    billing: 'unavailable',
    licenses: 'unavailable',
    updates: 'unavailable',
    journey: 'unavailable',
  };

  const tables: CommercialReportsTables = emptyTables();

  let clientsActive = 0;
  let clientsBlocked = 0;
  let clientsTrial = 0;
  let companiesByPlan: Array<{ name: string; count: number }> = [];
  let companiesByCity: Array<{ name: string; count: number }> = [];

  // Tenants
  try {
    const tenants = await MasterPlatformService.getTenantsService().list();
    sources.tenants = 'master_tenants';
    for (const t of tenants) {
      if (t.status === 'active') clientsActive += 1;
      if (t.status === 'blocked' || t.status === 'suspended') clientsBlocked += 1;
      if (t.status === 'trial' || t.plan === 'TRIAL' || t.plan === 'FREE') clientsTrial += 1;
    }
    companiesByPlan = groupCounts(tenants.map((t) => t.plan));
    tables.byPlan = companiesByPlan.map((row) => ({
      id: row.name,
      label: row.name,
      value: row.count,
      meta: 'Empresas',
    }));
  } catch {
    // keep unavailable
  }

  // CRM cities
  try {
    const directory = await CommercialCrmService.listProfiles({});
    sources.crm = 'master_crm';
    companiesByCity = groupCounts(directory.map((row) => row.city));
    tables.byCity = companiesByCity.map((row) => ({
      id: row.name,
      label: row.name,
      value: row.count,
      meta: 'Empresas (CRM)',
    }));
  } catch {
    // keep
  }

  // Receita mensal/anual = caixa real (payments + finance PAID).
  // Não usa invoices paid do Billing Engine (causava fantasma após apagar pagamentos).
  let revenueMonthCents = 0;
  let revenueYearCents = 0;
  try {
    const [enginePayments, financePaid] = await Promise.all([
      MasterPlatformService.getBillingEngine()
        .listPayments()
        .catch(() => [] as Array<{ status: string; amountCents: number; paidAt?: string | null; createdAt?: string }>),
      pool
        .queryMaster<{ amount_cents: string | number; paid_at: Date | string | null; event_at: Date | string | null; created_at: Date | string }>(
          `SELECT amount_cents, paid_at, event_at, created_at
             FROM public.master_subscription_finance_entries
            WHERE kind = 'PAYMENT' AND status = 'PAID'`,
        )
        .catch(() => ({ rows: [] as Array<{ amount_cents: string | number; paid_at: Date | string | null; event_at: Date | string | null; created_at: Date | string }> })),
    ]);
    sources.billing = 'payments+finance';

    const cashEvents: Array<{ amountCents: number; at: string }> = [];
    for (const pay of enginePayments) {
      const status = String(pay.status || '').toLowerCase();
      if (status !== 'paid' && status !== 'succeeded' && status !== 'confirmed') continue;
      const at = pay.paidAt || pay.createdAt;
      if (!at) continue;
      cashEvents.push({ amountCents: Math.max(0, Math.floor(pay.amountCents || 0)), at });
    }
    for (const row of financePaid.rows) {
      const at = row.paid_at || row.event_at || row.created_at;
      if (!at) continue;
      cashEvents.push({
        amountCents: Math.max(0, Math.floor(Number(row.amount_cents) || 0)),
        at: at instanceof Date ? at.toISOString() : String(at),
      });
    }

    for (const ev of cashEvents) {
      const t = Date.parse(ev.at);
      if (!Number.isFinite(t)) continue;
      if (revenueFromMs != null || revenueToMs != null) {
        if (!inPeriod(ev.at, revenueFromMs, revenueToMs)) continue;
        revenueMonthCents += ev.amountCents;
        revenueYearCents += ev.amountCents;
      } else {
        if (t >= monthStart) revenueMonthCents += ev.amountCents;
        if (t >= yearStart) revenueYearCents += ev.amountCents;
      }
    }
  } catch {
    // keep zeros
  }

  // Licenses expiring
  let licensesExpiring = 0;
  try {
    const licenses = await MasterPlatformService.getLicenseManager().list();
    sources.licenses = 'license_manager';
    const expiring = licenses.filter((lic) => lic.rules.expiryWarning);
    licensesExpiring = expiring.length;
    tables.licensesExpiring = expiring.map((lic) => ({
      id: lic.id,
      label: lic.empresa,
      secondary: lic.tenantId,
      value: lic.expiresAt,
      meta: `${lic.rules.daysRemaining ?? '—'}d · ${lic.status}`,
    }));
  } catch {
    // keep
  }

  // Without login
  const withoutLogin = await listWithoutLogin();
  if (withoutLogin.length > 0 || sources.tenants !== 'unavailable') {
    sources.journey = 'commercial_onboardings';
  }
  tables.withoutLogin = withoutLogin;

  // Updates
  let companiesWithoutUpdate = 0;
  let updatesCompleted = 0;
  let updatesFailed = 0;
  try {
    const [central, requests] = await Promise.all([
      UpdateControlPlaneService.getCentralSnapshot(),
      UpdateControlPlaneService.listRequests(),
    ]);
    sources.updates = 'update_control_plane';
    companiesWithoutUpdate = central.rows.filter(
      (r) =>
        r.statusCode === 'pending' ||
        r.statusCode === 'outdated' ||
        r.updateStatus === 'outdated',
    ).length;
    const outdatedRows = central.rows.filter(
      (r) =>
        r.statusCode === 'pending' ||
        r.statusCode === 'outdated' ||
        r.updateStatus === 'outdated',
    );
    tables.withoutUpdate = outdatedRows.map((r) => ({
      id: r.installationId,
      label: r.companyName,
      secondary: r.companyId,
      value: r.version,
      meta: `${r.statusLabel} · alvo ${r.latestVersion ?? '—'}`,
    }));

    const completed = requests.filter(
      (r) =>
        r.status === 'completed' &&
        inPeriod(r.completedAt || r.createdAt, period.fromMs, period.toMs),
    );
    const failed = requests.filter(
      (r) =>
        r.status === 'failed' &&
        inPeriod(r.failedAt || r.createdAt, period.fromMs, period.toMs),
    );
    // If no period, count all completed/failed
    const completedAll =
      period.fromMs == null && period.toMs == null
        ? requests.filter((r) => r.status === 'completed')
        : completed;
    const failedAll =
      period.fromMs == null && period.toMs == null
        ? requests.filter((r) => r.status === 'failed')
        : failed;

    updatesCompleted = completedAll.length;
    updatesFailed = failedAll.length;
    tables.updatesCompleted = completedAll.slice(0, 200).map((r) => ({
      id: r.id,
      label: r.companyName || r.installationId,
      secondary: r.component || null,
      value: r.completedAt || r.createdAt,
      meta: `${r.fromVersion ?? '—'} → ${r.targetVersion}`,
    }));
    tables.updatesFailed = failedAll.slice(0, 200).map((r) => ({
      id: r.id,
      label: r.companyName || r.installationId,
      secondary: r.component || null,
      value: r.failedAt || r.createdAt,
      meta: `${r.fromVersion ?? '—'} → ${r.targetVersion}`,
    }));
  } catch {
    // keep
  }

  // Implantations
  const implantations = await countImplantationsCompleted(period.fromMs, period.toMs);
  if (implantations.rows.length > 0 || sources.journey === 'commercial_onboardings') {
    sources.journey = 'commercial_onboardings';
  }
  tables.implantationsCompleted = implantations.rows;

  return buildCommercialReportsSnapshot({
    period: { from: period.from, to: period.to },
    kpis: {
      companiesByCity,
      companiesByPlan,
      clientsActive,
      clientsBlocked,
      clientsTrial,
      revenueMonthCents,
      revenueYearCents,
      licensesExpiring,
      companiesWithoutLogin: withoutLogin.length,
      companiesWithoutUpdate,
      updatesCompleted,
      updatesFailed,
      implantationsCompleted: implantations.count,
    },
    tables,
    sources,
  });
}
