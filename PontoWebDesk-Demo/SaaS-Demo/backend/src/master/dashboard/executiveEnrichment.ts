/**
 * Enriquecimento do Dashboard Executivo a partir de fontes Master reais.
 * Somente composição — não altera Control Plane, Updater, licenciamento nem fluxo comercial.
 */
import { pool } from '../../db/index.js';
import { UpdateControlPlaneService } from '../updates/UpdateControlPlaneService.js';
import type { MasterTenantsService } from '../tenants/MasterTenantsService.js';
import type { LicenseManagerService } from '../licenseManager/LicenseManagerService.js';
import type { SubscriptionService as SubscriptionLifecycleService } from '../subscriptions/subscription.service.js';
import { buildCommercialLicenseViewState } from '../license/licenseValidity.js';
import type { CommercialLicenseViewState } from '../license/licenseValidity.js';
import { ensureCompanyLicenseValidity } from '../license/enrichWithCommercialValidity.js';
import type { MasterExecutiveSummary, MasterRecentPayment } from './dashboard.types.js';
import {
  deriveReceiptRollupFromPayments,
  deriveMrrCents,
  loadSubscriptionFinanceReceiptRollup,
  loadSubscriptionFinanceRevenueSignals,
  loadSubscriptionMrrCents,
  mergeRevenueSignals,
  type RevenueCashLike,
} from './dashboardRevenueSignals.js';

type InvoiceLike = RevenueCashLike;

type EnrichInput = {
  base: MasterExecutiveSummary;
  tenantsService?: MasterTenantsService | null;
  licenseManager?: LicenseManagerService | null;
  lifecycle?: SubscriptionLifecycleService | null;
  invoices?: InvoiceLike[];
  /** Pagamentos reais do Billing Engine (não o PaymentsModule in-memory vazio). */
  payments?: RevenueCashLike[];
  hybridCounts?: {
    unresolvedConflicts: number;
    syncPending: number;
    offlinePending: number;
  } | null;
  persistence: 'postgres' | 'in_memory';
};

async function countAwaitingFirstLogin(): Promise<number | null> {
  try {
    const result = await pool.queryMaster<{ n: number }>(
      `select count(*)::int as n
         from public.master_commercial_onboardings
        where first_login_at is null
          and state in ('pending', 'provisioning', 'awaiting_first_login')
          and coalesce(first_access_status, '') <> 'accepted'`,
    );
    return Number(result.rows[0]?.n ?? 0);
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === '42P01' || code === '42703') return null;
    return null;
  }
}

function emptyCharts(): MasterExecutiveSummary['charts'] {
  return {
    companiesByStatus: [],
    modeMix: [],
    updatesByStatus: [],
    licensesByStatus: [],
  };
}

/** Preenche seções novas com "indisponível" mantendo compat dos campos legados. */
export function withExecutiveDefaults(base: MasterExecutiveSummary): MasterExecutiveSummary {
  return {
    ...base,
    companiesTrial: base.companiesTrial ?? 0,
    licensesActive: base.licensesActive ?? base.licenses ?? 0,
    licensesExpired: base.licensesExpired ?? 0,
    licensesTrial: base.licensesTrial ?? 0,
    licensesScheduled: base.licensesScheduled ?? 0,
    licensesExpiring7d: base.licensesExpiring7d ?? 0,
    licensesExpiring30d: base.licensesExpiring30d ?? base.licensesExpiring ?? 0,
    licenseValidities: base.licenseValidities ?? [],
    updates: base.updates ?? {
      current: 0,
      outdated: 0,
      unknown: 0,
      failedRequests: 0,
      available: false,
    },
    revenue: base.revenue ?? {
      contractedMrrCents: null,
      predictedMrrCents: null,
      overdueClients: null,
      monthReceiptsCents: null,
      overdueCents: null,
      available: false,
    },
    support: base.support ?? {
      awaitingFirstLogin: null,
      outdatedInstallations: null,
      syncConflicts: null,
      syncPending: null,
      offlinePending: null,
    },
    charts: base.charts ?? emptyCharts(),
    source: base.source === 'composed' ? 'composed' : base.source ?? 'in_memory',
  };
}

export async function enrichExecutiveSummary(input: EnrichInput): Promise<MasterExecutiveSummary> {
  const out = withExecutiveDefaults({ ...input.base });
  const now = Date.now();

  // —— Empresas (TenantManager oficial, se disponível) ——
  if (input.tenantsService) {
    try {
      const tenants = await input.tenantsService.list();
      let companiesActive = 0;
      let companiesBlocked = 0;
      let companiesTrial = 0;
      let modeSaas = 0;
      let modeLocal = 0;
      let modeHybrid = 0;
      const byStatus = new Map<string, number>();

      for (const t of tenants) {
        byStatus.set(t.status, (byStatus.get(t.status) ?? 0) + 1);
        if (t.status === 'active') companiesActive += 1;
        if (t.status === 'blocked' || t.status === 'suspended') companiesBlocked += 1;
        if (t.status === 'trial' || t.plan === 'TRIAL' || t.plan === 'FREE') companiesTrial += 1;
        if (t.mode === 'LOCAL') modeLocal += 1;
        else if (t.mode === 'HYBRID') modeHybrid += 1;
        else modeSaas += 1;
      }

      out.companies = tenants.length;
      out.companiesActive = companiesActive;
      out.companiesBlocked = companiesBlocked;
      out.companiesTrial = companiesTrial;
      out.modeSaas = modeSaas;
      out.modeLocal = modeLocal;
      out.modeHybrid = modeHybrid;
      out.charts.companiesByStatus = [...byStatus.entries()].map(([name, value]) => ({
        name,
        value,
      }));
      out.charts.modeMix = [
        { name: 'SaaS', value: modeSaas },
        { name: 'Local', value: modeLocal },
        { name: 'Híbrido', value: modeHybrid },
      ].filter((row) => row.value > 0);
    } catch {
      // mantém base
    }
  } else {
    out.charts.modeMix = [
      { name: 'SaaS', value: out.modeSaas },
      { name: 'Local', value: out.modeLocal },
      { name: 'Híbrido', value: out.modeHybrid },
    ].filter((row) => row.value > 0);
    out.charts.companiesByStatus = [
      { name: 'active', value: out.companiesActive },
      { name: 'blocked', value: out.companiesBlocked },
      { name: 'trial', value: out.companiesTrial },
    ].filter((row) => row.value > 0);
  }

  // —— Licenças (License Manager) ——
  let licensesExpiring30 = 0;
  if (input.licenseManager) {
    try {
      const snap = await input.licenseManager.snapshot();
      const list = (await input.licenseManager.list()).map(ensureCompanyLicenseValidity);
      let scheduled = 0;
      let expiring7 = 0;
      let expiredByValidity = 0;
      let activeByValidity = 0;
      const licenseValidities: Array<{
        licenseId: string;
        tenantId: string;
        validity: CommercialLicenseViewState;
      }> = [];
      for (const lic of list) {
        const view =
          lic.validity ??
          buildCommercialLicenseViewState({
            startsAt: lic.startsAt,
            expiresAt: lic.expiresAt,
            licenseStatus: lic.status,
          });
        licenseValidities.push({
          licenseId: lic.id,
          tenantId: lic.tenantId,
          validity: view,
        });
        if (view.phase === 'scheduled') scheduled += 1;
        else if (view.phase === 'expired') expiredByValidity += 1;
        else {
          activeByValidity += 1;
          if (view.daysDelta != null && view.daysDelta <= 7) expiring7 += 1;
          if (view.daysDelta != null && view.daysDelta <= 30) licensesExpiring30 += 1;
        }
      }
      out.licensesActive = activeByValidity;
      out.licensesExpired = Math.max(snap.byStatus.Expirada, expiredByValidity);
      out.licensesTrial = snap.byStatus.Trial;
      out.licenses = activeByValidity;
      out.licensesScheduled = scheduled;
      out.licensesExpiring7d = expiring7;
      out.licensesExpiring30d = licensesExpiring30;
      out.licensesExpiring = licensesExpiring30;
      out.licenseValidities = licenseValidities;
      out.charts.licensesByStatus = [
        { name: 'Ativa', value: activeByValidity },
        { name: 'Agendada', value: scheduled },
        { name: 'Trial', value: snap.byStatus.Trial },
        { name: 'Expirada', value: out.licensesExpired },
        { name: 'Bloqueada', value: snap.byStatus.Bloqueada },
      ].filter((row) => row.value > 0);
    } catch {
      // mantém base
    }
  } else {
    licensesExpiring30 = out.licensesExpiring30d ?? out.licensesExpiring ?? 0;
  }

  // —— Atualizações (Control Plane — somente leitura) ——
  try {
    const [installations, requests] = await Promise.all([
      UpdateControlPlaneService.listInstallations(),
      UpdateControlPlaneService.listRequests(),
    ]);
    let current = 0;
    let outdated = 0;
    let unknown = 0;
    for (const row of installations) {
      if (row.updateStatus === 'current') current += 1;
      else if (row.updateStatus === 'outdated') outdated += 1;
      else unknown += 1;
    }
    const failedRequests = requests.filter((r) => r.status === 'failed').length;
    out.updates = {
      current,
      outdated,
      unknown,
      failedRequests,
      available: true,
    };
    out.support.outdatedInstallations = outdated;
    out.charts.updatesByStatus = [
      { name: 'Atualizadas', value: current },
      { name: 'Pendentes', value: outdated },
      { name: 'Desconhecidas', value: unknown },
      { name: 'Falhas', value: failedRequests },
    ].filter((row) => row.value > 0);
  } catch {
    out.updates = { ...out.updates, available: false };
    out.support.outdatedInstallations = null;
  }

  // —— Receita: MRR (assinaturas) ≠ caixa (payments/finance) ≠ a receber (cobranças abertas) ——
  const invoices = input.invoices ?? [];
  const payments = input.payments ?? [];
  const finance =
    input.persistence === 'postgres'
      ? await loadSubscriptionFinanceRevenueSignals(now)
      : null;
  const signals = mergeRevenueSignals(finance, invoices, payments, now);
  const financeRollup =
    input.persistence === 'postgres'
      ? await loadSubscriptionFinanceReceiptRollup(now)
      : null;
  const receiptRollup = financeRollup ?? deriveReceiptRollupFromPayments(payments, now);
  const overdueClients = new Set(signals.overdueClientKeys).size;

  let contractedMrrCents = 0;
  if (input.lifecycle) {
    try {
      const subs = await input.lifecycle.list();
      contractedMrrCents = deriveMrrCents(
        subs.map((s) => ({
          status: s.status,
          amountCents: s.amountCents,
          periodicity: s.periodicity,
        })),
      );
    } catch {
      contractedMrrCents = 0;
    }
  }
  if (input.persistence === 'postgres') {
    const fromDb = await loadSubscriptionMrrCents();
    // Preferir banco quando disponível (fonte oficial master_subscriptions).
    if (fromDb != null) contractedMrrCents = fromDb;
  }

  const hasRevenueSignal =
    contractedMrrCents > 0 ||
    signals.monthReceiptsCents > 0 ||
    receiptRollup.annualReceiptsCents > 0 ||
    receiptRollup.lifetimeReceiptsCents > 0 ||
    signals.predictedCents > 0 ||
    signals.overdueCents > 0 ||
    signals.available;

  out.revenue = {
    /** MRR contratado (ACTIVE/TRIAL) — card "MRR (Receita Recorrente Mensal)". */
    contractedMrrCents,
    /**
     * Compat: campo `predictedMrrCents` NÃO é MRR.
     * Representa "A receber" = soma de cobranças OPEN/PENDING/OVERDUE.
     */
    predictedMrrCents: signals.predictedCents,
    overdueClients: hasRevenueSignal ? overdueClients : null,
    monthReceiptsCents: signals.monthReceiptsCents,
    overdueCents: hasRevenueSignal ? signals.overdueCents : null,
    available: hasRevenueSignal,
  };

  // Legado: monthlyRevenueCents permanece alinhado ao caixa do mês (não ao MRR).
  out.monthlyRevenueCents = receiptRollup.monthReceiptsCents;
  out.annualRevenueCents = receiptRollup.annualReceiptsCents;
  out.revenueCents = receiptRollup.lifetimeReceiptsCents;
  out.renewalsDue = signals.upcomingDueCount + licensesExpiring30;
  out.licensesExpiring = licensesExpiring30;

  // —— Suporte / hybrid ——
  out.support.awaitingFirstLogin = await countAwaitingFirstLogin();
  if (input.hybridCounts) {
    out.support.syncConflicts = input.hybridCounts.unresolvedConflicts;
    out.support.syncPending = input.hybridCounts.syncPending;
    out.support.offlinePending = input.hybridCounts.offlinePending;
  }

  out.source = 'composed';
  out.persistence = input.persistence;
  return out;
}

/** Utilitário para recentPayments a partir de invoices (usado nos testes). */
export function recentFromInvoices(invoices: InvoiceLike[]): MasterRecentPayment[] {
  return invoices
    .filter((inv) => String(inv.status || '').toLowerCase() === 'paid')
    .slice()
    .sort(
      (a, b) =>
        Date.parse(b.paidAt || b.issuedAt || '') - Date.parse(a.paidAt || a.issuedAt || ''),
    )
    .slice(0, 8)
    .map((inv) => ({
      id: String(inv.id ?? inv.issuedAt),
      label: `Fatura`,
      amountCents: inv.amountCents,
      status: inv.status,
      method: 'invoice',
      at: inv.paidAt || inv.issuedAt || new Date().toISOString(),
    }));
}
