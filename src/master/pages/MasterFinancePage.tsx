import React, { useEffect, useState } from 'react';
import {
  RefreshCw,
  Download,
  FileSpreadsheet,
  FileText,
  Building2,
  Ban,
  FlaskConical,
  Wallet,
  CalendarRange,
  KeyRound,
  LogIn,
  PackageOpen,
  CheckCircle2,
  XCircle,
  Rocket,
} from 'lucide-react';
import { ExecutiveKpiCard } from '../components/ExecutiveKpiCard';
import {
  fetchMasterFinance,
  formatFinanceMoney,
  type CommercialReportRow,
  type CommercialReportsSnapshot,
  type MasterFinanceResponse,
} from '../api/financeApi';
import {
  exportCommercialReportsCsv,
  exportCommercialReportsExcel,
  exportCommercialReportsPdf,
} from '../utils/commercialReportExport';
import { MasterBackToDashboard } from '../components/MasterBackToDashboard';

function ReportTable({
  title,
  rows,
  empty,
}: {
  title: string;
  rows: CommercialReportRow[];
  empty: string;
}) {
  return (
    <div className="rounded-2xl border border-border bg-surface shadow-card overflow-hidden">
      <div className="border-b border-slate-200 px-4 py-3 dark:border-slate-800">
        <h3 className="text-sm font-medium text-slate-900 dark:text-white">{title}</h3>
      </div>
      <div className="overflow-x-auto max-h-72">
        <table className="w-full text-left text-sm">
          <thead className="sticky top-0 bg-slate-50 text-[11px] uppercase text-slate-500 dark:bg-slate-950/80">
            <tr>
              <th className="px-4 py-2">Nome</th>
              <th className="px-4 py-2">Detalhe</th>
              <th className="px-4 py-2">Valor</th>
              <th className="px-4 py-2">Meta</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
            {rows.map((row) => (
              <tr key={`${title}-${row.id}`}>
                <td className="px-4 py-2 text-slate-900 dark:text-white">{row.label}</td>
                <td className="px-4 py-2 text-xs text-slate-500">{row.secondary || '—'}</td>
                <td className="px-4 py-2 text-xs text-slate-600 dark:text-slate-300">
                  {row.value == null ? '—' : String(row.value)}
                </td>
                <td className="px-4 py-2 text-xs text-slate-500">{row.meta || '—'}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-slate-500">
                  {empty}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * /master/finance — Central de Relatórios Comerciais (FASE 29).
 */
export function MasterFinancePage() {
  const [data, setData] = useState<MasterFinanceResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [exportBusy, setExportBusy] = useState<string | null>(null);

  async function load(nextFrom = from, nextTo = to) {
    setLoading(true);
    setError(null);
    try {
      setData(
        await fetchMasterFinance({
          from: nextFrom || undefined,
          to: nextTo || undefined,
        }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao carregar relatórios');
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const reports: CommercialReportsSnapshot | null = data?.reports ?? null;
  const k = reports?.kpis;

  async function onExport(kind: 'csv' | 'excel' | 'pdf') {
    if (!reports) return;
    setExportBusy(kind);
    try {
      if (kind === 'csv') exportCommercialReportsCsv(reports);
      else if (kind === 'excel') await exportCommercialReportsExcel(reports);
      else await exportCommercialReportsPdf(reports);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao exportar');
    } finally {
      setExportBusy(null);
    }
  }

  return (
    <div className="max-w-[1400px] space-y-8">
      <MasterBackToDashboard />
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-1">
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-indigo-400/90">
            Central de Relatórios
          </p>
          <h2 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-white md:text-3xl">
            Relatórios comerciais
          </h2>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-[11px] text-slate-500">
            De
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-white"
            />
          </label>
          <label className="flex flex-col gap-1 text-[11px] text-slate-500">
            Até
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-white"
            />
          </label>
          <button
            type="button"
            onClick={() => void load(from, to)}
            className="inline-flex items-center gap-2 rounded-xl border border-border-strong bg-surface px-3 py-2 text-xs text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
          >
            <CalendarRange className="h-3.5 w-3.5" />
            Filtrar
          </button>
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex items-center gap-2 rounded-xl border border-border-strong bg-surface px-3 py-2 text-xs text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Atualizar
          </button>
        </div>
      </header>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={!reports || exportBusy === 'csv'}
          onClick={() => void onExport('csv')}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-xs disabled:opacity-40 dark:border-slate-700"
        >
          <Download className="h-3.5 w-3.5" />
          CSV
        </button>
        <button
          type="button"
          disabled={!reports || exportBusy === 'excel'}
          onClick={() => void onExport('excel')}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-xs disabled:opacity-40 dark:border-slate-700"
        >
          <FileSpreadsheet className="h-3.5 w-3.5" />
          Excel
        </button>
        <button
          type="button"
          disabled={!reports || exportBusy === 'pdf'}
          onClick={() => void onExport('pdf')}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-xs disabled:opacity-40 dark:border-slate-700"
        >
          <FileText className="h-3.5 w-3.5" />
          PDF
        </button>
      </div>

      {loading && <p className="text-sm text-slate-500">Carregando relatórios…</p>}
      {error && (
        <p className="rounded-xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-600">
          {error}
        </p>
      )}

      {!loading && k && (
        <>
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <ExecutiveKpiCard
              label="Clientes ativos"
              value={String(k.clientsActive)}
              hint="Situação ativa"
              icon={Building2}
            />
            <ExecutiveKpiCard
              label="Clientes bloqueados"
              value={String(k.clientsBlocked)}
              hint="bloqueados + suspensos"
              icon={Ban}
            />
            <ExecutiveKpiCard
              label="Clientes em teste"
              value={String(k.clientsTrial)}
              hint="teste / FREE / TRIAL"
              icon={FlaskConical}
            />
            <ExecutiveKpiCard
              label="Receita mensal"
              value={formatFinanceMoney(k.revenueMonthCents)}
              hint={from || to ? 'No período filtrado' : 'Mês corrente'}
              icon={Wallet}
            />
            <ExecutiveKpiCard
              label="Receita anual"
              value={formatFinanceMoney(k.revenueYearCents)}
              hint={from || to ? 'No período filtrado' : 'Ano corrente'}
              icon={Wallet}
            />
            <ExecutiveKpiCard
              label="Licenças vencendo"
              value={String(k.licensesExpiring)}
              hint="Aviso ≤ 30 dias"
              icon={KeyRound}
            />
            <ExecutiveKpiCard
              label="Sem acesso"
              value={String(k.companiesWithoutLogin)}
              hint="primeiro acesso vazio"
              icon={LogIn}
            />
            <ExecutiveKpiCard
              label="Sem atualização"
              value={String(k.companiesWithoutUpdate)}
              hint="Instalações desatualizadas"
              icon={PackageOpen}
            />
            <ExecutiveKpiCard
              label="Atualizações OK"
              value={String(k.updatesCompleted)}
              hint="Solicitações concluídas"
              icon={CheckCircle2}
            />
            <ExecutiveKpiCard
              label="Atualizações com falha"
              value={String(k.updatesFailed)}
              hint="Solicitações com falha"
              icon={XCircle}
            />
            <ExecutiveKpiCard
              label="Implantações concluídas"
              value={String(k.implantationsCompleted)}
              hint="Assistente finalizado"
              icon={Rocket}
            />
          </section>

          <section className="grid gap-4 lg:grid-cols-2">
            <ReportTable
              title="Empresas por cidade"
              rows={reports!.tables.byCity}
              empty="Nenhuma cidade no CRM."
            />
            <ReportTable
              title="Empresas por plano"
              rows={reports!.tables.byPlan}
              empty="Nenhum plano cadastrado."
            />
            <ReportTable
              title="Licenças vencendo"
              rows={reports!.tables.licensesExpiring}
              empty="Nenhuma licença no limiar de vencimento."
            />
            <ReportTable
              title="Empresas sem acesso"
              rows={reports!.tables.withoutLogin}
              empty="Nenhuma empresa aguardando primeiro acesso."
            />
            <ReportTable
              title="Empresas sem atualização"
              rows={reports!.tables.withoutUpdate}
              empty="Nenhuma instalação desatualizada."
            />
            <ReportTable
              title="Atualizações realizadas"
              rows={reports!.tables.updatesCompleted}
              empty="Nenhuma atualização concluída no filtro."
            />
            <ReportTable
              title="Atualizações com falha"
              rows={reports!.tables.updatesFailed}
              empty="Nenhuma falha no filtro."
            />
            <ReportTable
              title="Implantações concluídas"
              rows={reports!.tables.implantationsCompleted}
              empty="Nenhuma implantação concluída no filtro."
            />
          </section>
        </>
      )}

      {!loading && !reports && !error && (
        <p className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-sm text-amber-800 dark:text-amber-200">
          Snapshot de relatórios indisponível. Verifique persistência Master e migrations.
        </p>
      )}
    </div>
  );
}

export default MasterFinancePage;
