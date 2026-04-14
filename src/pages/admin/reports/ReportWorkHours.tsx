import React, { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Clock } from 'lucide-react';
import { useCurrentUser } from '../../../hooks/useCurrentUser';
import PageHeader from '../../../components/PageHeader';
import { db, isSupabaseConfigured } from '../../../services/supabaseClient';
import { processEmployeeMonth } from '../../../engine/timeEngine';
import { LoadingState } from '../../../../components/UI';
import { adminReportCacheKey, queryCache, TTL } from '../../../services/queryCache';

interface Row {
  employeeId: string;
  employeeName: string;
  totalHours: number;
  expectedHours: number;
  balance: number;
}

const ReportWorkHours: React.FC = () => {
  const { user, loading } = useCurrentUser();
  const [employees, setEmployees] = useState<{ id: string; nome: string }[]>([]);
  const [month, setMonth] = useState(() => {
    const n = new Date();
    return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}`;
  });
  const [rows, setRows] = useState<Row[]>([]);
  const [loadingData, setLoadingData] = useState(false);

  useEffect(() => {
    if (!user?.companyId || !isSupabaseConfigured) return;
    (async () => {
      const cid = user.companyId!;
      const list = (await queryCache.getOrFetch(
        `users:${cid}`,
        () => db.select('users', [{ column: 'company_id', operator: 'eq', value: cid }]) as Promise<any[]>,
        TTL.NORMAL,
      )) as any[];
      setEmployees((list ?? []).map((u: any) => ({ id: u.id, nome: u.nome || u.email })));
    })();
  }, [user?.companyId]);

  useEffect(() => {
    if (!user?.companyId || !isSupabaseConfigured || employees.length === 0) return;
    const cid = user.companyId!;
    const [y, m] = month.split('-').map(Number);
    let cancelled = false;
    setLoadingData(true);
    const cacheKey = adminReportCacheKey(cid, 'work_hours', month);
    (async () => {
      try {
        const result = await queryCache.getOrFetch(
          cacheKey,
          async () => {
            const out: Row[] = [];
            for (const emp of employees.slice(0, 100)) {
              try {
                const days = await processEmployeeMonth(emp.id, cid, y, m);
                const totalHours = days.reduce((s, d) => s + d.daily.total_worked_minutes / 60, 0);
                const expectedHours = days.reduce((s, d) => s + d.daily.expected_minutes / 60, 0);
                out.push({
                  employeeId: emp.id,
                  employeeName: emp.nome,
                  totalHours,
                  expectedHours,
                  balance: totalHours - expectedHours,
                });
              } catch {
                out.push({ employeeId: emp.id, employeeName: emp.nome, totalHours: 0, expectedHours: 0, balance: 0 });
              }
            }
            return out;
          },
          TTL.STATIC,
        );
        if (!cancelled) setRows(result);
      } finally {
        if (!cancelled) setLoadingData(false);
      }
    })();
    return () => { cancelled = true; };
  }, [user?.companyId, month, employees]);

  if (loading) return <LoadingState message="Carregando..." />;
  if (!user) return <Navigate to="/" replace />;

  return (
    <div className="space-y-6">
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
