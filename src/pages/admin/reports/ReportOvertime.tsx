import React, { useEffect, useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { TrendingUp } from 'lucide-react';
import { useCurrentUser } from '../../../hooks/useCurrentUser';
import PageHeader from '../../../components/PageHeader';
import { db, isSupabaseConfigured } from '../../../services/supabaseClient';
import { processEmployeeMonth } from '../../../engine/timeEngine';
import { LoadingState } from '../../../../components/UI';
import { adminReportCacheKey, queryCache, TTL } from '../../../services/queryCache';

interface EmployeeOption {
  id: string;
  nome: string;
  department_id?: string;
}

interface DailyOvertimeRow {
  date: string;
  overtime50: number;
  overtime100: number;
  total: number;
  isHolidayOrOff: boolean;
}

interface Row {
  employeeId: string;
  employeeName: string;
  departmentId?: string;
  overtime50: number;
  overtime100: number;
  total: number;
  workDays: number;
  overtimeDays: number;
  daily: DailyOvertimeRow[];
}

const ReportOvertime: React.FC = () => {
  const { user, loading } = useCurrentUser();
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [filterUserId, setFilterUserId] = useState('');
  const [filterDept, setFilterDept] = useState('');
  const [month, setMonth] = useState(() => {
    const n = new Date();
    return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}`;
  });
  const [rows, setRows] = useState<Row[]>([]);
  const [loadingData, setLoadingData] = useState(false);
  const [expandedEmployeeId, setExpandedEmployeeId] = useState<string | null>(null);

  useEffect(() => {
    if (!user?.companyId || !isSupabaseConfigured) return;
    (async () => {
      const cid = user.companyId!;
      const list = (await queryCache.getOrFetch(
        `users:${cid}`,
        () => db.select('users', [{ column: 'company_id', operator: 'eq', value: cid }]) as Promise<any[]>,
        TTL.NORMAL,
      )) as any[];
      setEmployees(
        (list ?? []).map((u: any) => ({
          id: u.id,
          nome: u.nome || u.email,
          department_id: u.department_id || '',
        })),
      );
    })();
  }, [user?.companyId]);

  useEffect(() => {
    if (!user?.companyId || !isSupabaseConfigured || employees.length === 0) return;
    const cid = user.companyId!;
    const [y, m] = month.split('-').map(Number);
    let cancelled = false;
    setLoadingData(true);
    const cacheKey = adminReportCacheKey(cid, 'overtime', month);
    (async () => {
      try {
        const result = await queryCache.getOrFetch(
          cacheKey,
          async () => {
            const out: Row[] = [];
            for (const emp of employees) {
              try {
                const days = await processEmployeeMonth(emp.id, cid, y, m);
                let overtime50 = 0;
                let overtime100 = 0;
                let workDays = 0;
                let overtimeDays = 0;
                const daily: DailyOvertimeRow[] = [];
                days.forEach((d) => {
                  if ((d.daily.total_worked_minutes ?? 0) > 0) workDays += 1;
                  if (d.overtime) {
                    const day50 = d.overtime.overtime_50_minutes / 60;
                    const day100 = d.overtime.overtime_100_minutes / 60;
                    overtime50 += day50;
                    overtime100 += day100;
                    if (day50 > 0 || day100 > 0) overtimeDays += 1;
                    daily.push({
                      date: d.date,
                      overtime50: day50,
                      overtime100: day100,
                      total: day50 + day100,
                      isHolidayOrOff: !!d.overtime.is_holiday_or_off,
                    });
                  }
                });
                out.push({
                  employeeId: emp.id,
                  employeeName: emp.nome,
                  departmentId: emp.department_id || '',
                  overtime50,
                  overtime100,
                  total: overtime50 + overtime100,
                  workDays,
                  overtimeDays,
                  daily: daily.sort((a, b) => a.date.localeCompare(b.date)),
                });
              } catch {
                out.push({
                  employeeId: emp.id,
                  employeeName: emp.nome,
                  departmentId: emp.department_id || '',
                  overtime50: 0,
                  overtime100: 0,
                  total: 0,
                  workDays: 0,
                  overtimeDays: 0,
                  daily: [],
                });
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

  const filteredRows = useMemo(() => {
    return rows
      .filter((r) => (!filterUserId || r.employeeId === filterUserId))
      .filter((r) => (!filterDept || r.departmentId === filterDept))
      .sort((a, b) => b.total - a.total);
  }, [rows, filterUserId, filterDept]);

  const summary = useMemo(() => {
    const total50 = filteredRows.reduce((s, r) => s + r.overtime50, 0);
    const total100 = filteredRows.reduce((s, r) => s + r.overtime100, 0);
    const totalHours = total50 + total100;
    const employeesWithOvertime = filteredRows.filter((r) => r.total > 0).length;
    const overtimeDays = filteredRows.reduce((s, r) => s + r.overtimeDays, 0);
    return { total50, total100, totalHours, employeesWithOvertime, overtimeDays };
  }, [filteredRows]);

  const departmentOptions = useMemo(
    () => [...new Set(employees.map((e) => e.department_id).filter(Boolean))] as string[],
    [employees],
  );

  if (loading) return <LoadingState message="Carregando..." />;
  if (!user) return <Navigate to="/" replace />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Relatório de Horas Extras"
        subtitle="Visão consolidada e detalhada (50% / 100%) por colaborador"
        icon={<TrendingUp className="w-5 h-5" />}
      />
      <div className="flex flex-wrap gap-4 items-end">
        <label className="block">
          <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Mês</span>
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="ml-2 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800" />
        </label>
        <label className="block">
          <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Funcionário</span>
          <select
            value={filterUserId}
            onChange={(e) => setFilterUserId(e.target.value)}
            className="ml-2 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 min-w-[180px]"
          >
            <option value="">Todos</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.nome}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Departamento</span>
          <select
            value={filterDept}
            onChange={(e) => setFilterDept(e.target.value)}
            className="ml-2 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 min-w-[180px]"
          >
            <option value="">Todos</option>
            {departmentOptions.map((deptId) => (
              <option key={deptId} value={deptId}>
                {deptId}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
        <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-4 bg-white dark:bg-slate-900/50">
          <p className="text-xs text-slate-500 dark:text-slate-400">HE 50% (h)</p>
          <p className="text-xl font-semibold tabular-nums">{summary.total50.toFixed(2)}</p>
        </div>
        <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-4 bg-white dark:bg-slate-900/50">
          <p className="text-xs text-slate-500 dark:text-slate-400">HE 100% (h)</p>
          <p className="text-xl font-semibold tabular-nums">{summary.total100.toFixed(2)}</p>
        </div>
        <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-4 bg-white dark:bg-slate-900/50">
          <p className="text-xs text-slate-500 dark:text-slate-400">HE Total (h)</p>
          <p className="text-xl font-semibold tabular-nums">{summary.totalHours.toFixed(2)}</p>
        </div>
        <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-4 bg-white dark:bg-slate-900/50">
          <p className="text-xs text-slate-500 dark:text-slate-400">Colaboradores com HE</p>
          <p className="text-xl font-semibold tabular-nums">{summary.employeesWithOvertime}</p>
        </div>
        <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-4 bg-white dark:bg-slate-900/50">
          <p className="text-xs text-slate-500 dark:text-slate-400">Dias com HE</p>
          <p className="text-xl font-semibold tabular-nums">{summary.overtimeDays}</p>
        </div>
      </div>

      {loadingData ? (
        <LoadingState message="Calculando horas extras..." />
      ) : (
        <div className="rounded-xl border border-slate-200 dark:border-slate-700 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-700">
                <th className="text-left px-4 py-3 font-bold text-slate-500 dark:text-slate-400">Detalhe</th>
                <th className="text-left px-4 py-3 font-bold text-slate-500 dark:text-slate-400">Funcionário</th>
                <th className="text-left px-4 py-3 font-bold text-slate-500 dark:text-slate-400">Departamento</th>
                <th className="text-right px-4 py-3 font-bold text-slate-500 dark:text-slate-400">HE 50% (h)</th>
                <th className="text-right px-4 py-3 font-bold text-slate-500 dark:text-slate-400">HE 100% (h)</th>
                <th className="text-right px-4 py-3 font-bold text-slate-500 dark:text-slate-400">Total (h)</th>
                <th className="text-right px-4 py-3 font-bold text-slate-500 dark:text-slate-400">Dias trabalhados</th>
                <th className="text-right px-4 py-3 font-bold text-slate-500 dark:text-slate-400">Dias com HE</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((r) => (
                <React.Fragment key={r.employeeId}>
                  <tr className="border-b border-slate-100 dark:border-slate-800">
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => setExpandedEmployeeId((prev) => (prev === r.employeeId ? null : r.employeeId))}
                        className="px-2 py-1 rounded border border-slate-300 dark:border-slate-600 text-xs hover:bg-slate-100 dark:hover:bg-slate-800"
                      >
                        {expandedEmployeeId === r.employeeId ? 'Ocultar' : 'Ver'}
                      </button>
                    </td>
                    <td className="px-4 py-3">{r.employeeName}</td>
                    <td className="px-4 py-3">{r.departmentId || '—'}</td>
                    <td className="text-right px-4 py-3 tabular-nums">{r.overtime50.toFixed(2)}</td>
                    <td className="text-right px-4 py-3 tabular-nums">{r.overtime100.toFixed(2)}</td>
                    <td className="text-right px-4 py-3 tabular-nums font-medium">{r.total.toFixed(2)}</td>
                    <td className="text-right px-4 py-3 tabular-nums">{r.workDays}</td>
                    <td className="text-right px-4 py-3 tabular-nums">{r.overtimeDays}</td>
                  </tr>
                  {expandedEmployeeId === r.employeeId && (
                    <tr className="bg-slate-50/60 dark:bg-slate-900/40 border-b border-slate-100 dark:border-slate-800">
                      <td colSpan={8} className="px-4 py-3">
                        {r.daily.length === 0 ? (
                          <p className="text-xs text-slate-500 dark:text-slate-400">Sem horas extras no período.</p>
                        ) : (
                          <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/50">
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="bg-slate-100 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-700">
                                  <th className="text-left px-3 py-2 font-semibold">Data</th>
                                  <th className="text-right px-3 py-2 font-semibold">HE 50% (h)</th>
                                  <th className="text-right px-3 py-2 font-semibold">HE 100% (h)</th>
                                  <th className="text-right px-3 py-2 font-semibold">Total (h)</th>
                                  <th className="text-left px-3 py-2 font-semibold">Tipo do dia</th>
                                </tr>
                              </thead>
                              <tbody>
                                {r.daily.map((d) => (
                                  <tr key={`${r.employeeId}-${d.date}`} className="border-b border-slate-100 dark:border-slate-800">
                                    <td className="px-3 py-2">{d.date}</td>
                                    <td className="text-right px-3 py-2 tabular-nums">{d.overtime50.toFixed(2)}</td>
                                    <td className="text-right px-3 py-2 tabular-nums">{d.overtime100.toFixed(2)}</td>
                                    <td className="text-right px-3 py-2 tabular-nums">{d.total.toFixed(2)}</td>
                                    <td className="px-3 py-2">{d.isHolidayOrOff ? 'Domingo/Feriado/Folga (100%)' : 'Dia útil (50%)'}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
          {!loadingData && filteredRows.length === 0 && (
            <p className="p-6 text-center text-slate-500 dark:text-slate-400">Nenhum dado de horas extras para os filtros selecionados.</p>
          )}
        </div>
      )}
    </div>
  );
};

export default ReportOvertime;
