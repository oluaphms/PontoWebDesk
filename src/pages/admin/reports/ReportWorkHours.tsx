import React, { useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { ArrowLeft, Clock } from 'lucide-react';
import { useCurrentUser } from '../../../hooks/useCurrentUser';
import PageHeader from '../../../components/PageHeader';
import { isSupabaseConfigured } from '../../../services/supabaseClient';
import { fetchEmployees } from '../../../services/employeesApi.service';
import { buildWorkHoursMonthReport, loadTimesheetMonthContext } from './reportTimesheetMonth';
import { LoadingState } from '../../../../components/UI';
import { adminReportCacheKey, queryCache, TTL } from '../../../services/queryCache';
import { useAbortableAsyncEffect } from '../../../hooks/useAbortableAsyncEffect';
import { useCompanyEmployees } from '../../../hooks/useCompanyEmployees';

interface Row {
  employeeId: string;
  employeeName: string;
  totalHours: number;
  expectedHours: number;
  balance: number;
}

const ReportWorkHours: React.FC = () => {
  const { user, loading } = useCurrentUser();
  const { employees, loadingEmployees } = useCompanyEmployees(user?.companyId);
  const [month, setMonth] = useState(() => {
    const n = new Date();
    return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}`;
  });
  const [rows, setRows] = useState<Row[]>([]);
  const [loadingData, setLoadingData] = useState(false);
  const [dataNotice, setDataNotice] = useState<string | null>(null);

  useAbortableAsyncEffect(
    async (isCancelled) => {
      if (!user?.companyId || !isSupabaseConfigured()) return;
      const cid = user.companyId;
      const [y, m] = month.split('-').map(Number);
      setLoadingData(true);
      const cacheKey = adminReportCacheKey(cid, 'work_hours', month);
      try {
        const result = await queryCache.getOrFetch(
          cacheKey,
          async () => {
            const apiEmployees = await fetchEmployees(cid);
            const { sheetByRecordId, recordIdMap } = await loadTimesheetMonthContext(cid, y, m, apiEmployees);
            const hasSheetData = sheetByRecordId.size > 0;
            const out = buildWorkHoursMonthReport(apiEmployees, recordIdMap, sheetByRecordId);
            return { rows: out, hasSheetData };
          },
          TTL.STATIC,
        );
        if (!isCancelled()) {
          setRows(result.rows);
          setDataNotice(
            result.hasSheetData
              ? null
              : 'Nenhum dia calculado no motor para este mês. Abra o Espelho de Ponto para recalcular a jornada.',
          );
        }
      } finally {
        if (!isCancelled()) setLoadingData(false);
      }
    },
    [user?.companyId, month],
  );

  if (loading || loadingEmployees) return <LoadingState message="Carregando..." />;
  if (!user) return <Navigate to="/" replace />;

  return (
    <div className="space-y-6">
      <Link
        to="/admin/reports"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-indigo-600 dark:text-indigo-400 hover:underline"
      >
        <ArrowLeft className="w-4 h-4" /> Voltar aos relatórios
      </Link>
      <PageHeader
        title="Relatório de Jornada"
        subtitle="Horas trabalhadas × esperadas por funcionário no mês. Use o Espelho de Ponto para ver entrada/saída, localização e método (foto, GPS, manual) por dia."
        icon={<Clock className="w-5 h-5" />}
      />
      <div className="flex flex-wrap gap-4 items-end">
        <label className="block">
          <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Mês</span>
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="ml-2 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800" />
        </label>
      </div>
      {dataNotice && (
        <p className="text-sm text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg px-4 py-3">
          {dataNotice}
        </p>
      )}
      {loadingData ? (
        <LoadingState message="Calculando jornada..." />
      ) : (
        <div className="rounded-xl border border-slate-200 dark:border-slate-700 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-700">
                <th className="text-left px-4 py-3 font-bold text-slate-500 dark:text-slate-400">Funcionário</th>
                <th className="text-right px-4 py-3 font-bold text-slate-500 dark:text-slate-400">Horas trabalhadas</th>
                <th className="text-right px-4 py-3 font-bold text-slate-500 dark:text-slate-400">Horas esperadas</th>
                <th className="text-right px-4 py-3 font-bold text-slate-500 dark:text-slate-400">Saldo</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.employeeId} className="border-b border-slate-100 dark:border-slate-800">
                  <td className="px-4 py-3">{r.employeeName}</td>
                  <td className="text-right px-4 py-3 tabular-nums">{r.totalHours.toFixed(1)}h</td>
                  <td className="text-right px-4 py-3 tabular-nums">{r.expectedHours.toFixed(1)}h</td>
                  <td className={`text-right px-4 py-3 tabular-nums ${r.balance >= 0 ? 'text-emerald-600' : 'text-amber-600'}`}>{r.balance >= 0 ? '+' : ''}{r.balance.toFixed(1)}h</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default ReportWorkHours;
