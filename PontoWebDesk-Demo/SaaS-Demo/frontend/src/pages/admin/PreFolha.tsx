import { observabilityConsole } from '../../shared/logger/observabilityConsole';
import React, { useCallback, useEffect, useMemo, useState } from 'react';

// Validação de datas
const isValidDate = (dateStr: string): boolean => {
  if (!dateStr || typeof dateStr !== 'string') return false;
  const regex = /^\d{4}-\d{2}-\d{2}$/;
  if (!regex.test(dateStr)) return false;
  const date = new Date(dateStr);
  return !isNaN(date.getTime());
};
import { Navigate } from 'react-router-dom';
import { Calculator, Download, FileSpreadsheet, FileText, Loader2, RefreshCw } from 'lucide-react';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import PageHeader from '../../components/PageHeader';
import { LoadingState } from '../../../components/UI';
import RoleGuard from '../../components/auth/RoleGuard';
import { isSupabaseConfigured } from '../../services/supabaseClient';
import {
  generateCompanyPayroll,
  getPayrollSummaries,
  getMonthPeriod,
  type CalculatedPayrollRow,
} from '../../services/payrollCalculator';
import {
  exportPayrollToCSV,
  exportPayrollToExcel,
  generatePayrollJSON,
} from '../../utils/payrollExport';

// ============ COMPONENTE PRINCIPAL ============

const AdminPreFolha: React.FC = () => {
  const { user, loading } = useCurrentUser();
  const now = new Date();

  // Inicializa período imediatamente (síncrono)
  const initialPeriod = useMemo(() => getMonthPeriod(now.getFullYear(), now.getMonth() + 1), []);

  // Estados
  const [ano, setAno] = useState(now.getFullYear());
  const [mes, setMes] = useState(now.getMonth() + 1);
  const [dataInicio, setDataInicio] = useState(initialPeriod.start);
  const [dataFim, setDataFim] = useState(initialPeriod.end);
  const [resultados, setResultados] = useState<CalculatedPayrollRow[]>([]);
  const [loadingData, setLoadingData] = useState(false);
  const [calculando, setCalculando] = useState(false);
  const [exportandoPdf, setExportandoPdf] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Atualiza datas quando mês/ano mudam
  useEffect(() => {
    const period = getMonthPeriod(ano, mes);
    setDataInicio(period.start);
    setDataFim(period.end);
  }, [ano, mes]);

  // Carrega dados quando o período muda (apenas se datas válidas)
  const loadData = useCallback(async () => {
    if (!user?.companyId || !isSupabaseConfigured() || !dataInicio || !dataFim) {
      setLoadingData(false);
      return;
    }

    setLoadingData(true);
    setMessage(null);

    try {
      const summaries = await getPayrollSummaries(user.companyId, dataInicio, dataFim);
      setResultados(summaries);
    } catch (e: any) {
      observabilityConsole.error(e);
      setMessage({ type: 'error', text: e?.message || 'Erro ao carregar pré-folha.' });
    } finally {
      setLoadingData(false);
    }
  }, [user?.companyId, dataInicio, dataFim]);

  // Carrega dados apenas quando período é válido
  useEffect(() => {
    if (dataInicio && dataFim) {
      loadData();
    }
  }, [loadData, dataInicio, dataFim]);

  // ============ CÁLCULO ============

  const handleCalcular = async () => {
    if (!user?.companyId) {
      setMessage({ type: 'error', text: 'Usuário não autenticado.' });
      return;
    }

    if (!isValidDate(dataInicio) || !isValidDate(dataFim)) {
      setMessage({ type: 'error', text: 'Período inválido. Selecione ano e mês.' });
      return;
    }

    if (dataInicio > dataFim) {
      setMessage({ type: 'error', text: 'Data de início não pode ser maior que data de fim.' });
      return;
    }

    setCalculando(true);
    setMessage(null);

    try {
      const { summaries, errors } = await generateCompanyPayroll(
        user.companyId,
        dataInicio,
        dataFim
      );

      if (errors.length > 0) {
        observabilityConsole.warn('Erros parciais:', errors);
      }

      setResultados(
        summaries.map((s) => ({
          employee_id: s.employee_id,
          employee_name: s.employee_name || 'Sem nome',
          worked_hours: Math.round((s.total_worked_minutes / 60) * 100) / 100,
          expected_hours: Math.round((s.total_expected_minutes / 60) * 100) / 100,
          overtime_hours: Math.round((s.total_overtime_minutes / 60) * 100) / 100,
          absence_hours: Math.round((s.total_absence_minutes / 60) * 100) / 100,
          night_hours: Math.round((s.total_night_minutes / 60) * 100) / 100,
          late_hours: Math.round((s.total_late_minutes / 60) * 100) / 100,
          work_days: s.total_work_days,
          absence_days: s.total_absence_days,
        }))
      );

      const successMsg = `Pré-folha calculada: ${summaries.length} funcionário(s)${errors.length > 0 ? ` (${errors.length} erros)` : ''}`;
      setMessage({ type: 'success', text: successMsg });
    } catch (e: any) {
      observabilityConsole.error(e);
      setMessage({ type: 'error', text: e?.message || 'Erro ao calcular pré-folha.' });
    } finally {
      setCalculando(false);
    }
  };

  // ============ EXPORTAÇÕES ============

  const exportCsv = () => {
    if (resultados.length === 0) return;
    const filename = `pre_folha_${ano}_${String(mes).padStart(2, '0')}`;
    exportPayrollToCSV(resultados, filename);
    setMessage({ type: 'success', text: 'Arquivo CSV exportado com sucesso!' });
  };

  const exportExcel = async () => {
    if (resultados.length === 0) return;
    try {
      const filename = `pre_folha_${ano}_${String(mes).padStart(2, '0')}.xlsx`;
      await exportPayrollToExcel(resultados, filename);
      setMessage({ type: 'success', text: 'Planilha Excel exportada com sucesso!' });
    } catch (e: any) {
      setMessage({ type: 'error', text: 'Erro ao exportar Excel. Verifique se a biblioteca xlsx está instalada.' });
    }
  };

  const exportJson = () => {
    if (resultados.length === 0) return;
    const jsonData = generatePayrollJSON(resultados, dataInicio, dataFim);
    const blob = new Blob([JSON.stringify(jsonData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pre_folha_${ano}_${String(mes).padStart(2, '0')}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setMessage({ type: 'success', text: 'Arquivo JSON exportado com sucesso!' });
  };

  const exportPdf = async () => {
    if (resultados.length === 0 || exportandoPdf) return;
    setExportandoPdf(true);
    try {
      const { jsPDF } = await import('jspdf');
      const autoTable = (await import('jspdf-autotable')).default;
      const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
      const title = 'Pré-Folha de Jornada';
      const periodLabel = `${dataInicio} a ${dataFim}`;

      doc.setFontSize(14);
      doc.text(title, 14, 12);
      doc.setFontSize(10);
      doc.text(`Período: ${periodLabel}`, 14, 18);

      const rows = resultados.map((row) => [
        row.employee_name,
        `${row.worked_hours.toFixed(2)}h`,
        `${row.overtime_hours.toFixed(2)}h`,
        `${row.absence_hours.toFixed(2)}h`,
        `${row.night_hours.toFixed(2)}h`,
        `${row.late_hours.toFixed(2)}h`,
        String(row.work_days),
        String(row.absence_days),
      ]);

      autoTable(doc, {
        startY: 24,
        head: [
          [
            'Funcionário',
            'Normais',
            'Extras',
            'Faltas',
            'Noturno',
            'Atrasos',
            'Dias Trab.',
            'Dias Falta',
          ],
        ],
        body: rows,
        styles: { fontSize: 8 },
        headStyles: { fillColor: [79, 70, 229] },
        theme: 'striped',
      });

      const filename = `pre_folha_${ano}_${String(mes).padStart(2, '0')}.pdf`;
      doc.save(filename);
      setMessage({ type: 'success', text: 'PDF exportado com sucesso!' });
    } catch (e: any) {
      observabilityConsole.error(e);
      setMessage({ type: 'error', text: 'Erro ao exportar PDF. Tente novamente.' });
    } finally {
      setExportandoPdf(false);
    }
  };

  // ============ TOTAIS ============

  const totais = useMemo(() => {
    return resultados.reduce(
      (acc, row) => ({
        worked_hours: acc.worked_hours + row.worked_hours,
        expected_hours: acc.expected_hours + row.expected_hours,
        overtime_hours: acc.overtime_hours + row.overtime_hours,
        absence_hours: acc.absence_hours + row.absence_hours,
        night_hours: acc.night_hours + row.night_hours,
        late_hours: acc.late_hours + row.late_hours,
        work_days: acc.work_days + row.work_days,
        absence_days: acc.absence_days + row.absence_days,
      }),
      {
        worked_hours: 0,
        expected_hours: 0,
        overtime_hours: 0,
        absence_hours: 0,
        night_hours: 0,
        late_hours: 0,
        work_days: 0,
        absence_days: 0,
      }
    );
  }, [resultados]);

  // ============ RENDER ============

  if (loading) return <LoadingState message="Carregando..." />;
  if (!user) return <Navigate to="/" replace />;

  const meses = Array.from({ length: 12 }, (_, i) => i + 1);
  const anos = Array.from({ length: 8 }, (_, i) => now.getFullYear() - 3 + i);

  return (
    <RoleGuard user={user} allowedRoles={['admin', 'hr']}>
      <div className="space-y-6">
        {/* Mensagens */}
        {message && (
          <div
            className={`p-4 rounded-xl text-sm ${
              message.type === 'success'
                ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300'
                : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300'
            }`}
          >
            {message.text}
          </div>
        )}

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <PageHeader
            helpSlug="pre-folha"
            title="Pré-Folha de Jornada"
            subtitle="Cálculo de horas trabalhadas, extras, faltas e noturnas para exportação. Não calcula valores monetários."
            icon={<Calculator size={24} />}
          />
        </div>

        {/* Painel de Controle */}
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/50 p-4 space-y-4">
          {/* Linha 1: Período */}
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Ano</label>
              <select
                value={ano}
                onChange={(e) => setAno(parseInt(e.target.value, 10))}
                className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
              >
                {anos.map((a) => (
                  <option key={a} value={a}>{a}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Mês</label>
              <select
                value={mes}
                onChange={(e) => setMes(parseInt(e.target.value, 10))}
                className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
              >
                {meses.map((m) => (
                  <option key={m} value={m}>
                    {String(m).padStart(2, '0')}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Início</label>
              <input
                type="date"
                value={dataInicio}
                onChange={(e) => setDataInicio(e.target.value)}
                className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Fim</label>
              <input
                type="date"
                value={dataFim}
                onChange={(e) => setDataFim(e.target.value)}
                className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
              />
            </div>
            <button
              type="button"
              onClick={handleCalcular}
              disabled={calculando}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 text-white font-medium hover:bg-indigo-700 disabled:opacity-50"
            >
              {calculando ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4" />
              )}
              {calculando ? 'Calculando...' : 'Calcular Pré-Folha'}
            </button>
          </div>

          {/* Linha 2: Exportações */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-slate-500 mr-2">Exportar:</span>
            <button
              type="button"
              onClick={exportCsv}
              disabled={resultados.length === 0 || calculando}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 font-medium hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 text-sm"
            >
              <FileText className="w-4 h-4" /> CSV
            </button>
            <button
              type="button"
              onClick={exportPdf}
              disabled={resultados.length === 0 || calculando || exportandoPdf}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 font-medium hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 text-sm"
            >
              <FileText className="w-4 h-4" /> {exportandoPdf ? 'PDF…' : 'PDF'}
            </button>
            <button
              type="button"
              onClick={exportExcel}
              disabled={resultados.length === 0 || calculando}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 font-medium hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 text-sm"
            >
              <FileSpreadsheet className="w-4 h-4" /> Excel
            </button>
            <button
              type="button"
              onClick={exportJson}
              disabled={resultados.length === 0 || calculando}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 font-medium hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 text-sm"
            >
              <Download className="w-4 h-4" /> JSON
            </button>
          </div>
        </div>

        {/* Aviso */}
        <p className="text-xs text-slate-500 dark:text-slate-400 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-800/40 px-4 py-3 leading-relaxed">
          <strong>Aviso:</strong> Esta pré-folha calcula apenas a jornada de trabalho (horas normais, extras, faltas e noturnas). 
          Não inclui cálculos de salário, INSS, FGTS, IRRF ou outros valores monetários. 
          Use para conferência de jornada e exportação para sistemas contábeis.
        </p>

        {/* Resumo dos Totais */}
        {resultados.length > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
            <div className="p-3 rounded-xl bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-100 dark:border-indigo-800">
              <div className="text-xs text-indigo-600 dark:text-indigo-400">Horas Normais</div>
              <div className="text-lg font-bold text-indigo-900 dark:text-indigo-100">
                {totais.worked_hours.toFixed(2)}h
              </div>
            </div>
            <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-100 dark:border-amber-800">
              <div className="text-xs text-amber-600 dark:text-amber-400">Horas Extras</div>
              <div className="text-lg font-bold text-amber-900 dark:text-amber-100">
                {totais.overtime_hours.toFixed(2)}h
              </div>
            </div>
            <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-900/20 border border-rose-100 dark:border-rose-800">
              <div className="text-xs text-rose-600 dark:text-rose-400">Faltas</div>
              <div className="text-lg font-bold text-rose-900 dark:text-rose-100">
                {totais.absence_hours.toFixed(2)}h
              </div>
            </div>
            <div className="p-3 rounded-xl bg-violet-50 dark:bg-violet-900/20 border border-violet-100 dark:border-violet-800">
              <div className="text-xs text-violet-600 dark:text-violet-400">Noturno</div>
              <div className="text-lg font-bold text-violet-900 dark:text-violet-100">
                {totais.night_hours.toFixed(2)}h
              </div>
            </div>
            <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
              <div className="text-xs text-slate-600 dark:text-slate-400">Atrasos</div>
              <div className="text-lg font-bold text-slate-900 dark:text-slate-100">
                {totais.late_hours.toFixed(2)}h
              </div>
            </div>
            <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-100 dark:border-emerald-800">
              <div className="text-xs text-emerald-600 dark:text-emerald-400">Dias Trab.</div>
              <div className="text-lg font-bold text-emerald-900 dark:text-emerald-100">
                {totais.work_days}
              </div>
            </div>
            <div className="p-3 rounded-xl bg-orange-50 dark:bg-orange-900/20 border border-orange-100 dark:border-orange-800">
              <div className="text-xs text-orange-600 dark:text-orange-400">Dias Falta</div>
              <div className="text-lg font-bold text-orange-900 dark:text-orange-100">
                {totais.absence_days}
              </div>
            </div>
          </div>
        )}

        {/* Tabela de Resultados */}
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/50 overflow-hidden">
          {loadingData ? (
            <div className="p-12 text-center text-slate-500">Carregando...</div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-700">
                      <th className="text-left px-4 py-3 font-bold text-slate-500 dark:text-slate-400">Funcionário</th>
                      <th className="text-right px-4 py-3 font-bold text-slate-500 dark:text-slate-400">Normais</th>
                      <th className="text-right px-4 py-3 font-bold text-slate-500 dark:text-slate-400">Extras</th>
                      <th className="text-right px-4 py-3 font-bold text-slate-500 dark:text-slate-400">Faltas</th>
                      <th className="text-right px-4 py-3 font-bold text-slate-500 dark:text-slate-400">Noturno</th>
                      <th className="text-right px-4 py-3 font-bold text-slate-500 dark:text-slate-400">Atrasos</th>
                      <th className="text-right px-4 py-3 font-bold text-slate-500 dark:text-slate-400">Dias Trab.</th>
                      <th className="text-right px-4 py-3 font-bold text-slate-500 dark:text-slate-400">Dias Falta</th>
                    </tr>
                  </thead>
                  <tbody>
                    {resultados.map((row) => (
                      <tr key={row.employee_id} className="border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
                        <td className="px-4 py-3 text-slate-900 dark:text-white font-medium">
                          <div>{row.employee_name}</div>
                          <div className="text-xs text-slate-400">{row.email}</div>
                        </td>
                        <td className="px-4 py-3 text-right text-slate-600 dark:text-slate-300">
                          <span className="font-medium text-indigo-600 dark:text-indigo-400">
                            {row.worked_hours.toFixed(2)}h
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right text-slate-600 dark:text-slate-300">
                          <span className={row.overtime_hours > 0 ? 'text-amber-600 dark:text-amber-400 font-medium' : ''}>
                            {row.overtime_hours.toFixed(2)}h
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right text-slate-600 dark:text-slate-300">
                          <span className={row.absence_hours > 0 ? 'text-rose-600 dark:text-rose-400 font-medium' : ''}>
                            {row.absence_hours.toFixed(2)}h
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right text-slate-600 dark:text-slate-300">
                          <span className={row.night_hours > 0 ? 'text-violet-600 dark:text-violet-400 font-medium' : ''}>
                            {row.night_hours.toFixed(2)}h
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right text-slate-600 dark:text-slate-300">
                          <span className={row.late_hours > 0 ? 'text-orange-600 dark:text-orange-400' : ''}>
                            {row.late_hours.toFixed(2)}h
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right text-slate-600 dark:text-slate-300">
                          {row.work_days}
                        </td>
                        <td className="px-4 py-3 text-right text-slate-600 dark:text-slate-300">
                          <span className={row.absence_days > 0 ? 'text-rose-600 dark:text-rose-400 font-medium' : ''}>
                            {row.absence_days}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mensagem quando não há dados */}
              {!loadingData && resultados.length === 0 && (
                <div className="p-8 text-center">
                  <div className="text-slate-400 mb-2">
                    <Calculator className="w-12 h-12 mx-auto opacity-50" />
                  </div>
                  <p className="text-slate-500 dark:text-slate-400">
                    Nenhum dado calculado para este período.
                  </p>
                  <p className="text-sm text-slate-400 mt-2">
                    Clique em <strong>Calcular Pré-Folha</strong> para processar a jornada dos funcionários.
                  </p>
                </div>
              )}
            </>
          )}
        </div>

        {/* Legenda */}
        {resultados.length > 0 && (
          <div className="flex flex-wrap gap-4 text-xs text-slate-500 dark:text-slate-400">
            <div className="flex items-center gap-1">
              <span className="w-3 h-3 rounded-full bg-indigo-500"></span>
              <span>Horas normais trabalhadas</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="w-3 h-3 rounded-full bg-amber-500"></span>
              <span>Horas extras</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="w-3 h-3 rounded-full bg-rose-500"></span>
              <span>Faltas (horas não trabalhadas)</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="w-3 h-3 rounded-full bg-violet-500"></span>
              <span>Adicional noturno (22h-05h)</span>
            </div>
          </div>
        )}
      </div>
    </RoleGuard>
  );
};

export default AdminPreFolha;
