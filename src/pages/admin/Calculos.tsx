import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import {
  Calculator,
  ChevronLeft,
  ChevronRight,
  Download,
  FileText,
  Filter,
  ListChecks,
  Printer,
  Search,
  Sheet,
  UserCog,
} from 'lucide-react';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { useToast } from '../../components/ToastProvider';
import PageHeader from '../../components/PageHeader';
import { LoadingState } from '../../../components/UI';
import { isSupabaseConfigured } from '../../services/supabaseClient';
import { buscarColaboradores } from '../../../services/api';
import { processEmployeeDay, type DaySummary } from '../../engine/timeEngine';

function fmtMinutos(m: number): string {
  const sign = m < 0 ? '-' : '';
  const a = Math.abs(Math.round(m));
  const h = Math.floor(a / 60);
  const min = a % 60;
  return `${sign}${h}:${String(min).padStart(2, '0')}`;
}

function formatDataPt(ymd: string): string {
  if (!ymd || ymd.length < 10) return ymd;
  const [y, mo, d] = ymd.slice(0, 10).split('-');
  return `${d}/${mo}/${y}`;
}

function nomeDiaSemana(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  if (!y || !m || !d) return '';
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString('pt-BR', { weekday: 'short' });
}

/** Gera cada dia civil entre início e fim (YYYY-MM-DD), inclusive. */
function eachDayBetween(startYmd: string, endYmd: string): string[] {
  const [ys, ms, ds] = startYmd.split('-').map(Number);
  const [ye, me, de] = endYmd.split('-').map(Number);
  const out: string[] = [];
  const cur = new Date(ys, ms - 1, ds);
  const end = new Date(ye, me - 1, de);
  if (cur > end) return out;
  while (cur <= end) {
    out.push(
      `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}-${String(cur.getDate()).padStart(2, '0')}`,
    );
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

const MAX_DIAS = 120;

const AdminCalculos: React.FC = () => {
  const { user, loading } = useCurrentUser();
  const toast = useToast();
  const selectNomeRef = useRef<HTMLSelectElement>(null);
  const [employees, setEmployees] = useState<{ id: string; nome: string }[]>([]);
  const [loadingListas, setLoadingListas] = useState(true);
  const [periodStart, setPeriodStart] = useState(() =>
    new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10),
  );
  const [periodEnd, setPeriodEnd] = useState(() => new Date().toISOString().slice(0, 10));
  const [numeroFolha, setNumeroFolha] = useState('');
  const [filterUserId, setFilterUserId] = useState('');
  const [calcRows, setCalcRows] = useState<DaySummary[] | null>(null);
  const [loadingCalc, setLoadingCalc] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [showFiltrosExtra, setShowFiltrosExtra] = useState(false);

  useEffect(() => {
    if (!user?.companyId || !isSupabaseConfigured) {
      setLoadingListas(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const list = await buscarColaboradores(user.companyId!);
        if (!cancelled) {
          setEmployees([...list].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')));
        }
      } catch (e) {
        console.error(e);
        if (!cancelled) toast.addToast('error', 'Não foi possível carregar colaboradores.');
      } finally {
        if (!cancelled) setLoadingListas(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.companyId, toast]);

  const empIndex = useMemo(() => {
    if (!filterUserId) return -1;
    return employees.findIndex((e) => e.id === filterUserId);
  }, [employees, filterUserId]);

  const goPrevEmp = () => {
    if (empIndex <= 0) return;
    setFilterUserId(employees[empIndex - 1].id);
    setCalcRows(null);
  };

  const goNextEmp = () => {
    if (empIndex < 0 || empIndex >= employees.length - 1) return;
    setFilterUserId(employees[empIndex + 1].id);
    setCalcRows(null);
  };

  const atualizar = useCallback(async () => {
    if (!user?.companyId || !filterUserId) {
      toast.addToast('error', 'Selecione um colaborador e clique em Atualizar.');
      return;
    }
    const dias = eachDayBetween(periodStart, periodEnd);
    if (dias.length === 0) {
      toast.addToast('error', 'Período inválido.');
      return;
    }
    if (dias.length > MAX_DIAS) {
      toast.addToast('error', `Reduza o período (máximo ${MAX_DIAS} dias).`);
      return;
    }
    setLoadingCalc(true);
    setCalcRows(null);
    try {
      const rows: DaySummary[] = [];
      for (const d of dias) {
        rows.push(await processEmployeeDay(filterUserId, user.companyId, d));
      }
      setCalcRows(rows);
    } catch (e: any) {
      console.error(e);
      toast.addToast('error', e?.message || 'Falha ao calcular.');
    } finally {
      setLoadingCalc(false);
    }
  }, [user?.companyId, filterUserId, periodStart, periodEnd, toast]);

  const exportarCsv = () => {
    if (!calcRows?.length) {
      toast.addToast('error', 'Não há dados para exportar. Clique em Atualizar.');
      return;
    }
    const nome = employees.find((e) => e.id === filterUserId)?.nome ?? '';
    const headers = [
      'Data',
      'Dia',
      'Entrada',
      'Saída',
      'Trabalhadas',
      'Atraso',
      'Falta',
      'Extra 50%',
      'Extra 100%',
      'Noturno',
    ];
    const lines = [headers.join(';')];
    for (const r of calcRows) {
      const o = r.overtime;
      lines.push(
        [
          r.date,
          nomeDiaSemana(r.date),
          r.daily.entrada ?? '',
          r.daily.saida ?? '',
          fmtMinutos(r.daily.total_worked_minutes),
          fmtMinutos(r.daily.late_minutes),
          fmtMinutos(r.daily.missing_minutes),
          o ? fmtMinutos(o.overtime_50_minutes) : '0:00',
          o ? fmtMinutos(o.overtime_100_minutes) : '0:00',
          fmtMinutos(r.night_minutes),
        ].join(';'),
      );
    }
    const blob = new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `calculos-${nome.replace(/\s+/g, '_')}-${periodStart}_${periodEnd}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast.addToast('success', 'Exportação gerada.');
  };

  const exportarPdf = async () => {
    if (!calcRows?.length) {
      toast.addToast('error', 'Não há dados para exportar. Clique em Atualizar.');
      return;
    }
    setExportingPdf(true);
    try {
      const nome = employees.find((e) => e.id === filterUserId)?.nome ?? '—';
      const { jsPDF } = await import('jspdf');
      const autoTable = (await import('jspdf-autotable')).default;

      const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
      const pageW = doc.internal.pageSize.getWidth();
      doc.setFontSize(14);
      doc.setFont(undefined, 'bold');
      doc.text('PontoWebDesk — Cálculos (diário)', pageW / 2, 12, { align: 'center' });
      doc.setFont(undefined, 'normal');
      doc.setFontSize(10);
      const sub = [
        `Colaborador: ${nome}`,
        `Período: ${formatDataPt(periodStart)} a ${formatDataPt(periodEnd)}`,
        numeroFolha ? `Nº folha: ${numeroFolha}` : null,
      ]
        .filter(Boolean)
        .join('  ·  ');
      doc.text(sub, pageW / 2, 19, { align: 'center' });

      const head = [
        ['Data', 'Dia', 'Entrada', 'Saída', 'Trabalh.', 'Atraso', 'Falta', 'Extra 50%', 'Extra 100%', 'Noturno'],
      ];
      const body = calcRows.map((r) => {
        const o = r.overtime;
        return [
          formatDataPt(r.date),
          nomeDiaSemana(r.date),
          r.daily.entrada ?? '—',
          r.daily.saida ?? '—',
          fmtMinutos(r.daily.total_worked_minutes),
          fmtMinutos(r.daily.late_minutes),
          fmtMinutos(r.daily.missing_minutes),
          o ? fmtMinutos(o.overtime_50_minutes) : '0:00',
          o ? fmtMinutos(o.overtime_100_minutes) : '0:00',
          fmtMinutos(r.night_minutes),
        ];
      });

      autoTable(doc, {
        head,
        body,
        startY: 26,
        styles: { fontSize: 7, cellPadding: 1.2, overflow: 'linebreak' },
        headStyles: { fillColor: [79, 70, 229], fontSize: 8 },
        margin: { left: 10, right: 10 },
      });

      doc.save(`calculos-${nome.replace(/\s+/g, '_')}-${periodStart}_${periodEnd}.pdf`);
      toast.addToast('success', 'PDF gerado.');
    } catch (e) {
      console.error(e);
      toast.addToast('error', 'Não foi possível gerar o PDF. Tente novamente.');
    } finally {
      setExportingPdf(false);
    }
  };

  const imprimir = () => {
    if (!calcRows?.length) {
      toast.addToast('error', 'Não há dados para imprimir. Clique em Atualizar.');
      return;
    }
    window.print();
  };

  if (loading) return <LoadingState message="Carregando..." />;
  if (!user) return <Navigate to="/" replace />;

  const inp =
    'px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-sm';

  const nomeColaborador = employees.find((e) => e.id === filterUserId)?.nome ?? '';

  return (
    <div className="calculos-report-root space-y-4 print:space-y-2">
      <div className="print:hidden">
        <PageHeader title="Cálculos" />
      </div>

      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/50 overflow-hidden print:border-0 print:shadow-none print:overflow-visible">
        {/* Só impressão / Salvar como PDF no navegador: contexto do relatório */}
        <div className="hidden print:block px-4 py-3 border-b border-slate-900 text-center">
          <p className="text-base font-bold">PontoWebDesk — Cálculos</p>
          <p className="text-sm mt-1">
            {nomeColaborador ? `Colaborador: ${nomeColaborador}` : 'Colaborador: —'}
            {' · '}
            Período: {formatDataPt(periodStart)} a {formatDataPt(periodEnd)}
            {numeroFolha ? ` · Folha: ${numeroFolha}` : ''}
          </p>
        </div>

        {/* Barra superior: ações */}
        <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-800/40 print:hidden">
          <div className="flex items-center gap-2 text-slate-800 dark:text-slate-100 font-semibold text-sm mr-2">
            <Calculator className="w-5 h-5 text-indigo-600 dark:text-indigo-400 shrink-0" aria-hidden />
            <span>Cálculos</span>
          </div>
          <button
            type="button"
            onClick={() => toast.addToast('info', 'Opções de cálculo serão configuradas em versão futura.')}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border border-slate-200 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <ListChecks className="w-4 h-4 text-rose-600" />
            Opções
          </button>
          <button
            type="button"
            onClick={() => setShowFiltrosExtra((v) => !v)}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border ${
              showFiltrosExtra
                ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/30'
                : 'border-slate-200 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            <Filter className="w-4 h-4 text-emerald-600" />
            Filtros
          </button>
          <button
            type="button"
            onClick={exportarCsv}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border border-slate-200 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <Download className="w-4 h-4 text-emerald-600" />
            CSV
          </button>
          <button
            type="button"
            onClick={() => void exportarPdf()}
            disabled={exportingPdf}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border border-slate-200 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50"
          >
            <FileText className="w-4 h-4 text-indigo-600" />
            {exportingPdf ? 'PDF…' : 'PDF'}
          </button>
          <button
            type="button"
            onClick={imprimir}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border border-slate-200 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <Printer className="w-4 h-4 text-slate-600" />
            Imprimir
          </button>
        </div>

        {/* Filtros principais (ocultos na impressão para não sair “captura da tela”) */}
        <div className="p-3 space-y-3 border-b border-slate-200 dark:border-slate-800 print:hidden">
          <div className="flex flex-col xl:flex-row flex-wrap gap-3 xl:items-end">
            <div className="flex flex-wrap items-end gap-2">
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-0.5">Período</label>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="date"
                    value={periodStart}
                    onChange={(e) => {
                      setPeriodStart(e.target.value);
                      setCalcRows(null);
                    }}
                    className={inp}
                  />
                  <span className="text-sm text-slate-500">até</span>
                  <input
                    type="date"
                    value={periodEnd}
                    onChange={(e) => {
                      setPeriodEnd(e.target.value);
                      setCalcRows(null);
                    }}
                    className={inp}
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-0.5">Nº Folha</label>
                <input
                  type="text"
                  inputMode="numeric"
                  placeholder="—"
                  value={numeroFolha}
                  onChange={(e) => setNumeroFolha(e.target.value)}
                  className={`${inp} w-24`}
                />
              </div>
              <div className="min-w-[200px] flex-1 max-w-md">
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-0.5">Nome</label>
                <select
                  ref={selectNomeRef}
                  value={filterUserId}
                  onChange={(e) => {
                    setFilterUserId(e.target.value);
                    setCalcRows(null);
                  }}
                  className={`${inp} w-full`}
                >
                  <option value="">Selecione…</option>
                  {employees.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.nome}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-1 pb-0.5">
                <button
                  type="button"
                  title="Colaborador anterior"
                  onClick={goPrevEmp}
                  disabled={empIndex <= 0}
                  className="p-2 rounded-lg border border-slate-200 dark:border-slate-600 disabled:opacity-40 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  <ChevronLeft className="w-5 h-5 text-emerald-600" />
                </button>
                <button
                  type="button"
                  title="Próximo colaborador"
                  onClick={goNextEmp}
                  disabled={empIndex < 0 || empIndex >= employees.length - 1}
                  className="p-2 rounded-lg border border-slate-200 dark:border-slate-600 disabled:opacity-40 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  <ChevronRight className="w-5 h-5 text-emerald-600" />
                </button>
                <Link
                  to="/admin/timesheet"
                  title="Espelho de ponto"
                  className="p-2 rounded-lg border border-slate-200 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600"
                >
                  <Sheet className="w-5 h-5" />
                </Link>
                <button
                  type="button"
                  title="Focar busca"
                  onClick={() => selectNomeRef.current?.focus()}
                  className="p-2 rounded-lg border border-slate-200 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600"
                >
                  <Search className="w-5 h-5" />
                </button>
                <Link
                  to="/admin/employees"
                  title="Cadastro de funcionários"
                  className="p-2 rounded-lg border border-slate-200 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600"
                >
                  <UserCog className="w-5 h-5 text-blue-600" />
                </Link>
              </div>
            </div>
            <div className="flex-1 flex justify-end">
              <button
                type="button"
                onClick={() => void atualizar()}
                disabled={loadingCalc || !filterUserId}
                className="px-6 py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50 shadow-sm"
              >
                {loadingCalc ? 'Calculando…' : 'Atualizar'}
              </button>
            </div>
          </div>

          {showFiltrosExtra && (
            <p className="text-xs text-slate-500 dark:text-slate-400 print:hidden">
              Filtros adicionais (departamento, projeto, etc.) poderão ser incluídos nas próximas versões.
            </p>
          )}
        </div>

        {/* Grade */}
        <div className="p-3 min-h-[240px] print:min-h-0">
          {loadingListas && <p className="text-sm text-slate-500 print:hidden">Carregando listas…</p>}
          {!loadingListas && loadingCalc && (
            <div className="flex items-center justify-center py-16 text-slate-500 text-sm print:hidden">
              Processando período…
            </div>
          )}
          {!loadingCalc && calcRows === null && (
            <div className="flex flex-col items-center justify-center py-16 text-center text-slate-500 dark:text-slate-400 text-sm border border-dashed border-slate-200 dark:border-slate-700 rounded-xl print:hidden">
              <Calculator className="w-10 h-10 mb-2 opacity-40" />
              <p>Selecione o colaborador, o período e clique em <strong className="text-slate-700 dark:text-slate-300">Atualizar</strong> para exibir os cálculos.</p>
            </div>
          )}
          {!loadingCalc && calcRows && calcRows.length === 0 && (
            <p className="text-sm text-slate-500 print:hidden">Nenhum dia no período.</p>
          )}
          {!loadingCalc && calcRows && calcRows.length > 0 && (
            <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-100 dark:bg-slate-800 text-left">
                    <th className="px-2 py-2 font-semibold">Data</th>
                    <th className="px-2 py-2 font-semibold">Dia</th>
                    <th className="px-2 py-2 font-semibold">Entrada</th>
                    <th className="px-2 py-2 font-semibold">Saída</th>
                    <th className="px-2 py-2 font-semibold">Trabalhadas</th>
                    <th className="px-2 py-2 font-semibold">Atraso</th>
                    <th className="px-2 py-2 font-semibold">Falta</th>
                    <th className="px-2 py-2 font-semibold">Extra 50%</th>
                    <th className="px-2 py-2 font-semibold">Extra 100%</th>
                    <th className="px-2 py-2 font-semibold">Noturno</th>
                  </tr>
                </thead>
                <tbody>
                  {calcRows.map((r) => {
                    const o = r.overtime;
                    return (
                      <tr key={r.date} className="border-t border-slate-100 dark:border-slate-800">
                        <td className="px-2 py-1.5 tabular-nums whitespace-nowrap">{formatDataPt(r.date)}</td>
                        <td className="px-2 py-1.5 capitalize text-slate-600 dark:text-slate-400">{nomeDiaSemana(r.date)}</td>
                        <td className="px-2 py-1.5 tabular-nums">{r.daily.entrada ?? '—'}</td>
                        <td className="px-2 py-1.5 tabular-nums">{r.daily.saida ?? '—'}</td>
                        <td className="px-2 py-1.5 tabular-nums">{fmtMinutos(r.daily.total_worked_minutes)}</td>
                        <td className="px-2 py-1.5 tabular-nums">{fmtMinutos(r.daily.late_minutes)}</td>
                        <td className="px-2 py-1.5 tabular-nums">{fmtMinutos(r.daily.missing_minutes)}</td>
                        <td className="px-2 py-1.5 tabular-nums">{o ? fmtMinutos(o.overtime_50_minutes) : '0:00'}</td>
                        <td className="px-2 py-1.5 tabular-nums">{o ? fmtMinutos(o.overtime_100_minutes) : '0:00'}</td>
                        <td className="px-2 py-1.5 tabular-nums">{fmtMinutos(r.night_minutes)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default AdminCalculos;
