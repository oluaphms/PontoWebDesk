import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Building2,
  ShieldCheck,
  ShieldOff,
  FlaskConical,
  KeyRound,
  AlertTriangle,
  CircleDollarSign,
  TrendingUp,
  UserX,
  Clock3,
  Star,
  Rocket,
  Settings2,
  LayoutGrid,
  Trash2,
  type LucideIcon,
} from 'lucide-react';
import { masterApi, getMasterToken, type MasterDashboardResponse, type MasterExecutiveSummary } from '../api/masterApi';
import { ExecutiveKpiCard } from '../components/ExecutiveKpiCard';
import { MasterQuickShortcuts } from '../components/MasterQuickShortcuts';
import { MasterStatusBadge } from '../components/MasterStatusBadge';
import { MasterBillingService } from '../services/masterBillingService';
import {
  DASHBOARD_WIDGET_LABELS,
  DEFAULT_DASHBOARD_WIDGETS,
  readMasterUxPrefs,
  removeRecentClient,
  setDashboardWidgets,
  type MasterDashboardWidgetId,
  type MasterRecentCompany,
  type MasterUxPrefs,
} from '../ux/masterUxStorage';

function formatInt(n: number): string {
  return new Intl.NumberFormat('pt-BR').format(n || 0);
}

function formatMoneyCents(cents: number | null | undefined): string | null {
  if (cents == null || !Number.isFinite(cents)) return null;
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(
    new Date(t),
  );
}

const WAITING = 'Aguardando dados.';

function emptyExecutive(): MasterExecutiveSummary {
  return {
    companies: 0,
    companiesActive: 0,
    companiesBlocked: 0,
    companiesTrial: 0,
    users: 0,
    subscriptions: 0,
    licenses: 0,
    licensesActive: 0,
    licensesExpired: 0,
    licensesTrial: 0,
    licensesScheduled: 0,
    licensesExpiring7d: 0,
    licensesExpiring30d: 0,
    licenseValidities: [],
    revenueCents: 0,
    monthlyRevenueCents: 0,
    annualRevenueCents: 0,
    pixPending: 0,
    renewalsDue: 0,
    licensesExpiring: 0,
    currency: 'BRL',
    gateway: 0,
    gatewayActive: null,
    modeSaas: 0,
    modeLocal: 0,
    modeHybrid: 0,
    recentPayments: [],
    updates: {
      current: 0,
      outdated: 0,
      unknown: 0,
      failedRequests: 0,
      available: false,
    },
    revenue: {
      contractedMrrCents: null,
      predictedMrrCents: null,
      overdueClients: null,
      monthReceiptsCents: null,
      overdueCents: null,
      available: false,
    },
    support: {
      awaitingFirstLogin: null,
      outdatedInstallations: null,
      syncConflicts: null,
      syncPending: null,
      offlinePending: null,
    },
    charts: {
      companiesByStatus: [],
      modeMix: [],
      updatesByStatus: [],
      licensesByStatus: [],
    },
    source: 'in_memory',
  };
}

function Section({
  title,
  children,
  action,
}: {
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <section className="space-y-3 border-t border-border">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          {title}
        </h3>
        {action}
      </div>
      {children}
    </section>
  );
}

function Metric({
  label,
  value,
  hint,
  icon,
  tone,
  to,
}: {
  label: string;
  value: string | null;
  hint?: string;
  icon: LucideIcon;
  tone?: 'default' | 'teal' | 'sky' | 'amber' | 'rose' | 'violet' | 'emerald';
  to?: string;
}) {
  return (
    <ExecutiveKpiCard
      label={label}
      value={value ?? WAITING}
      hint={value == null ? WAITING : hint}
      icon={icon}
      tone={tone}
      to={to}
    />
  );
}

function RecentList({
  items,
  empty,
  onRemove,
}: {
  items: MasterRecentCompany[];
  empty: string;
  onRemove?: (id: string) => void;
}) {
  if (items.length === 0) {
    return <p className="rounded-2xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500 dark:border-slate-800">{empty}</p>;
  }
  return (
    <ul className="divide-y divide-slate-200 overflow-hidden rounded-2xl border border-border bg-surface shadow-card dark:divide-slate-800 ">
      {items.map((item) => (
        <li key={item.id} className="flex items-stretch">
          <Link
            to={`/master/tenants/${item.id}`}
            className="flex min-w-0 flex-1 items-center justify-between gap-3 px-4 py-3 transition hover:bg-indigo-50/60 dark:hover:bg-indigo-500/10"
          >
            <span className="truncate text-sm font-medium text-slate-900 dark:text-white">
              {item.name}
            </span>
            <span className="shrink-0 text-[11px] text-slate-400">{formatDate(item.at)}</span>
          </Link>
          {onRemove ? (
            <button
              type="button"
              title="Remover da lista"
              aria-label={`Excluir ${item.name} dos últimos acessados`}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onRemove(item.id);
              }}
              className="inline-flex shrink-0 items-center justify-center border-l border-slate-200 px-3 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600 dark:border-slate-800 dark:hover:bg-rose-950/40 dark:hover:text-rose-300"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/**
 * Dashboard Comercial — UX FASE 32 (personalizável, atalhos, recentes).
 */
export function MasterDashboardPage() {
  const [data, setData] = useState<MasterDashboardResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [prefs, setPrefs] = useState<MasterUxPrefs>(() => readMasterUxPrefs());
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const [deletingPaymentId, setDeletingPaymentId] = useState<string | null>(null);

  async function loadDashboard() {
    setLoading(true);
    setError(null);
    try {
      const res = await masterApi<MasterDashboardResponse>('/dashboard');
      setData(res);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erro ao carregar dashboard';
      setError(msg);
      if (!getMasterToken() || /revogad|inválid|expirad|login master/i.test(msg)) {
        window.location.assign('/master/login');
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadDashboard();
  }, []);

  useEffect(() => {
    setPrefs(readMasterUxPrefs());
  }, []);

  async function onDeleteRecentPayment(p: {
    id: string;
    label: string;
    method: string;
  }) {
    const isInvoice = p.method === 'invoice';
    const kind = isInvoice ? 'fatura' : 'pagamento';
    if (
      !window.confirm(
        `Excluir este registro de teste (${kind})?\n\n${p.label || p.id}\n\nEsta ação remove o registro e não pode ser desfeita.`,
      )
    ) {
      return;
    }
    setDeletingPaymentId(p.id);
    setError(null);
    try {
      if (isInvoice) {
        await MasterBillingService.invoiceAction(p.id, 'delete');
      } else {
        await MasterBillingService.paymentAction(p.id, 'delete');
      }
      await loadDashboard();
    } catch (err) {
      setError(err instanceof Error ? err.message : `Falha ao excluir ${kind}`);
    } finally {
      setDeletingPaymentId(null);
    }
  }

  const e = useMemo(() => {
    const base = emptyExecutive();
    const raw = data?.executive;
    if (!raw) return base;
    return {
      ...base,
      ...raw,
      updates: { ...base.updates, ...(raw.updates || {}) },
      revenue: { ...base.revenue, ...(raw.revenue || {}) },
      support: { ...base.support, ...(raw.support || {}) },
      charts: {
        companiesByStatus: raw.charts?.companiesByStatus ?? base.charts.companiesByStatus,
        modeMix: raw.charts?.modeMix ?? base.charts.modeMix,
        updatesByStatus: raw.charts?.updatesByStatus ?? base.charts.updatesByStatus,
        licensesByStatus: raw.charts?.licensesByStatus ?? base.charts.licensesByStatus,
      },
      recentPayments: raw.recentPayments ?? base.recentPayments,
      licenseValidities: raw.licenseValidities ?? [],
    };
  }, [data?.executive]);
  const revenue = e.revenue;
  const support = e.support;
  const recentPayments = e.recentPayments;
  const widgets = useMemo(
    () => new Set(prefs.dashboardWidgets.length ? prefs.dashboardWidgets : DEFAULT_DASHBOARD_WIDGETS),
    [prefs.dashboardWidgets],
  );

  function toggleWidget(id: MasterDashboardWidgetId) {
    const current = prefs.dashboardWidgets.length
      ? [...prefs.dashboardWidgets]
      : [...DEFAULT_DASHBOARD_WIDGETS];
    const next = current.includes(id) ? current.filter((w) => w !== id) : [...current, id];
    setPrefs(setDashboardWidgets(next.length ? next : [...DEFAULT_DASHBOARD_WIDGETS]));
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6 md:space-y-8">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-indigo-600 dark:text-indigo-200">
            Operação comercial
          </p>
          <h2 className="text-2xl font-semibold tracking-tight text-foreground md:text-3xl">
            Página inicial
          </h2>
          <p className="max-w-2xl text-sm text-foreground-secondary">
            Indicadores comerciais, atalhos e histórico local de operação — sem métricas técnicas.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setCustomizeOpen((v) => !v)}
          className="inline-flex items-center gap-2 self-start rounded-xl border border-border bg-surface px-3 py-2 text-xs font-medium text-foreground-secondary shadow-sm hover:border-indigo-200 hover:bg-indigo-50"
        >
          <LayoutGrid className="h-3.5 w-3.5" />
          Personalizar
        </button>
      </header>

      {customizeOpen && (
        <div className="rounded-2xl border border-indigo-200/60 bg-indigo-50/50 p-4 dark:border-indigo-500/20 dark:bg-indigo-500/5">
          <p className="mb-3 flex items-center gap-2 text-sm font-medium text-slate-900 dark:text-white">
            <Settings2 className="h-4 w-4" /> Widgets da página inicial
          </p>
          <div className="flex flex-wrap gap-2">
            {(Object.keys(DASHBOARD_WIDGET_LABELS) as MasterDashboardWidgetId[]).map((id) => {
              const on = widgets.has(id);
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => toggleWidget(id)}
                  className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                    on
                      ? 'border-indigo-400 bg-indigo-600 text-white'
                      : 'border-slate-300 bg-white text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300'
                  }`}
                >
                  {DASHBOARD_WIDGET_LABELS[id]}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {loading && <p className="text-sm text-slate-500 dark:text-slate-400">Carregando métricas…</p>}
      {error && (
        <p className="rounded-xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-600 dark:text-rose-400">
          {error}
        </p>
      )}

      {!loading && !error && (
        <>
          {widgets.has('shortcuts') && (
            <Section title="Atalhos rápidos">
              <MasterQuickShortcuts />
            </Section>
          )}

          {widgets.has('companies') && (
            <Section title="Empresas">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <Metric
                  label="Empresas"
                  value={formatInt(e.companies)}
                  icon={Building2}
                  tone="teal"
                  to="/master/tenants"
                />
                <Metric
                  label="Empresas Ativas"
                  value={formatInt(e.companiesActive)}
                  icon={ShieldCheck}
                  tone="emerald"
                  to="/master/tenants"
                />
                <Metric
                  label="Empresas em Teste"
                  value={formatInt(e.companiesTrial)}
                  icon={FlaskConical}
                  tone="amber"
                  to="/master/tenants"
                />
                <Metric
                  label="Empresas Bloqueadas"
                  value={formatInt(e.companiesBlocked)}
                  icon={ShieldOff}
                  tone="rose"
                  to="/master/tenants"
                />
              </div>
            </Section>
          )}

          {widgets.has('licenses') && (
            <Section title="Licenças">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                <Metric
                  label="Licenças Ativas"
                  value={formatInt(e.licensesActive ?? e.licenses)}
                  icon={KeyRound}
                  tone="emerald"
                  to="/master/licenses"
                />
                <Metric
                  label="Licenças futuras"
                  value={formatInt(e.licensesScheduled ?? 0)}
                  hint="Aguardando início"
                  icon={KeyRound}
                  tone="amber"
                  to="/master/licenses"
                />
                <Metric
                  label="Licenças expiradas"
                  value={formatInt(e.licensesExpired ?? 0)}
                  icon={AlertTriangle}
                  tone="rose"
                  to="/master/licenses"
                />
                <Metric
                  label="Expiram em até 7 dias"
                  value={formatInt(e.licensesExpiring7d ?? 0)}
                  icon={AlertTriangle}
                  tone="amber"
                  to="/master/licenses"
                />
                <Metric
                  label="Expiram em até 30 dias"
                  value={formatInt(e.licensesExpiring30d ?? e.licensesExpiring)}
                  hint="Aviso de vencimento"
                  icon={AlertTriangle}
                  tone="amber"
                  to="/master/licenses"
                />
                <Metric
                  label="Empresas sem acesso"
                  value={
                    support.awaitingFirstLogin == null
                      ? null
                      : formatInt(support.awaitingFirstLogin)
                  }
                  icon={UserX}
                  tone="amber"
                  to="/master/tenants"
                />
              </div>
            </Section>
          )}

          {widgets.has('revenue') && (
            <Section title="Receita">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <Metric
                  label="MRR (Receita Recorrente Mensal)"
                  value={formatMoneyCents(revenue.contractedMrrCents)}
                  hint="Base contratada ACTIVE/TRIAL"
                  icon={CircleDollarSign}
                  tone="emerald"
                  to="/master/finance"
                />
                <Metric
                  label="Receita prevista"
                  value={formatMoneyCents(revenue.predictedMrrCents)}
                  hint="A receber — cobranças abertas"
                  icon={TrendingUp}
                  tone="sky"
                  to="/master/finance"
                />
                <Metric
                  label="Próximos vencimentos"
                  value={formatInt(e.renewalsDue)}
                  hint="Cobranças e licenças nos próximos 30 dias"
                  icon={Clock3}
                  tone="violet"
                  to="/master/licenses"
                />
                <Metric
                  label="Recebimentos do mês"
                  value={formatMoneyCents(revenue.monthReceiptsCents)}
                  hint="Caixa efetivamente recebido"
                  icon={CircleDollarSign}
                  tone="default"
                  to="/master/payments"
                />
              </div>
            </Section>
          )}

          <div className="grid gap-6 lg:grid-cols-3">
            {widgets.has('favorites') && (
              <Section
                title="Favoritos"
                action={<Star className="h-3.5 w-3.5 text-amber-500" />}
              >
                <RecentList items={prefs.favorites} empty="Marque empresas com ★ no detalhe." />
              </Section>
            )}
            {widgets.has('recentClients') && (
              <Section title="Últimos clientes acessados">
                <RecentList
                  items={prefs.recentClients}
                  empty="Abra uma empresa para aparecer aqui."
                  onRemove={(id) => {
                    setPrefs(removeRecentClient(id));
                  }}
                />
              </Section>
            )}
            {widgets.has('recentImplants') && (
              <Section
                title="Últimas empresas implantadas"
                action={<Rocket className="h-3.5 w-3.5 text-indigo-500" />}
              >
                <RecentList
                  items={prefs.recentImplants}
                  empty="Conclua ou abra uma implantação para registrar."
                />
              </Section>
            )}
          </div>

          {widgets.has('recentPayments') && (
            <Section
              title="Últimos pagamentos"
              action={
                <Link to="/master/payments" className="text-[11px] font-medium text-indigo-600 dark:text-indigo-300">
                  Ver todos
                </Link>
              }
            >
              <div className="overflow-x-auto overflow-hidden rounded-2xl border border-border bg-surface shadow-card">
                {recentPayments.length === 0 ? (
                  <p className="px-4 py-8 text-center text-sm text-slate-500">
                    Nenhum pagamento recente.
                  </p>
                ) : (
                  <table className="w-full min-w-[560px] text-left text-sm">
                    <thead className="border-b border-border bg-[var(--ds-table-head)] text-[11px] uppercase tracking-wide text-foreground-secondary">
                      <tr>
                        <th className="px-4 py-3 font-medium">Descrição</th>
                        <th className="px-4 py-3 font-medium">Valor</th>
                        <th className="px-4 py-3 font-medium">Situação</th>
                        <th className="px-4 py-3 font-medium">Método</th>
                        <th className="px-4 py-3 font-medium">Quando</th>
                        <th className="px-4 py-3 font-medium text-right">Ações</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                      {recentPayments.slice(0, 8).map((p) => (
                        <tr
                          key={`${p.method}:${p.id}`}
                          className="transition hover:bg-indigo-50/50 dark:hover:bg-indigo-500/5"
                        >
                          <td className="px-4 py-3 text-slate-900 dark:text-white">
                            {p.label || p.id}
                          </td>
                          <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                            {formatMoneyCents(p.amountCents) || '—'}
                          </td>
                          <td className="px-4 py-3">
                            <MasterStatusBadge status={p.status} />
                          </td>
                          <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{p.method}</td>
                          <td className="px-4 py-3 text-slate-500">{formatDate(p.at)}</td>
                          <td className="px-4 py-3 text-right">
                            <button
                              type="button"
                              title="Excluir registro de teste"
                              disabled={deletingPaymentId === p.id}
                              onClick={(ev) => {
                                ev.stopPropagation();
                                void onDeleteRecentPayment(p);
                              }}
                              className="inline-flex items-center gap-1 rounded-lg border border-border-strong px-2 py-1 text-[11px] text-foreground-secondary hover:border-rose-400 hover:bg-rose-500/10 hover:text-rose-700 disabled:opacity-40"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                              {deletingPaymentId === p.id ? 'Excluindo…' : 'Excluir'}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </Section>
          )}
        </>
      )}
    </div>
  );
}

export default MasterDashboardPage;
