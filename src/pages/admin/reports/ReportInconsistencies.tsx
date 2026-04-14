import React, { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { AlertTriangle } from 'lucide-react';
import { useCurrentUser } from '../../../hooks/useCurrentUser';
import PageHeader from '../../../components/PageHeader';
import { db, isSupabaseConfigured } from '../../../services/supabaseClient';
import { LoadingState } from '../../../../components/UI';
import { adminReportCacheKey, queryCache, TTL } from '../../../services/queryCache';

interface InconsistencyRow {
  id: string;
  employee_id: string;
  employee_name: string;
  date: string;
  type: string;
  description: string;
  resolved: boolean;
  created_at: string;
}

const typeLabels: Record<string, string> = {
  missing_entry: 'Falta de entrada',
  missing_exit: 'Falta de saída',
  missing_break: 'Intervalo incompleto',
  duplicate_records: 'Marcações duplicadas',
  invalid_sequence: 'Sequência inválida',
};

const ReportInconsistencies: React.FC = () => {
  const { user, loading } = useCurrentUser();
  const [rows, setRows] = useState<InconsistencyRow[]>([]);
  const [employees, setEmployees] = useState<Map<string, string>>(new Map());
  const [filterResolved, setFilterResolved] = useState<boolean | 'all'>('all');
  const [loadingData, setLoadingData] = useState(false);

  useEffect(() => {
    if (!user?.companyId || !isSupabaseConfigured) return;
    const cid = user.companyId!;
    setLoadingData(true);
    const cacheKey = adminReportCacheKey(cid, 'inconsistencies');
    (async () => {
      try {
        const mapped = await queryCache.getOrFetch(
          cacheKey,
          async () => {
            const [incRows, userRows] = await Promise.all([
              db.select('time_inconsistencies', [{ column: 'company_id', operator: 'eq', value: cid }], { column: 'date', ascending: false }, 500) as Promise<any[]>,
              queryCache.getOrFetch(
                `users:${cid}`,
                () => db.select('users', [{ column: 'company_id', operator: 'eq', value: cid }]) as Promise<any[]>,
                TTL.NORMAL,
              ),
            ]);
            const empMap = new Map<string, string>();
            (userRows ?? []).forEach((u: any) => empMap.set(u.id, u.nome || u.email));
            const rowsWithNames = (incRows ?? []).map((r: any) => ({
              ...r,
              employee_name: empMap.get(r.employee_id) || r.employee_id?.slice(0, 8) || '—',
            }));
            return { empMap, rowsWithNames };
          },
          TTL.NORMAL,
        );
        setEmployees(mapped.empMap);
        setRows(mapped.rowsWithNames);
      } finally {
        setLoadingData(false);
      }
    })();
  }, [user?.companyId]);

  const filtered = filterResolved === 'all'
    ? rows
    : rows.filter((r) => r.resolved === filterResolved);

  if (loading) return <LoadingState message="Carregando..." />;
  if (!user) return <Navigate to="/" replace />;

  return (
    <div className="space-y-6">
      <PageHeader title="Relatório de Inconsistências" subtitle="Faltas de entrada/saída, intervalo incompleto, duplicadas" icon={<AlertTriangle className="w-5 h-5" />} />
      <div className="flex flex-wrap gap-4 items-center">
        <label className="flex items-center gap-2">
          <span className="text-sm text-slate-600 dark:text-slate-400">Exibir</span>
          <select
            value={filterResolved === 'all' ? 'all' : filterResolved ? 'resolved' : 'open'}
            onChange={(e) => setFilterResolved(e.target.value === 'all' ? 'all' : e.target.value === 'resolved') as boolean | 'all'}
            className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
          >
            <option value="all">Todas</option>
            <option value="open">Não resolvidas</option>
            <option value="resolved">Resolvidas</option>
          </select>
        </label>
      </div>
      {loadingData ? (
        <LoadingState message="Carregando..." />
      ) : (
        <div className="rounded-xl border border-slate-200 dark:border-slate-700 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-700">
                <th className="text-left px-4 py-3 font-bold text-slate-500 dark:text-slate-400">Data</th>
                <th className="text-left px-4 py-3 font-bold text-slate-500 dark:text-slate-400">Funcionário</th>
                <th className="text-left px-4 py-3 font-bold text-slate-500 dark:text-slate-400">Tipo</th>
                <th className="text-left px-4 py-3 font-bold text-slate-500 dark:text-slate-400">Descrição</th>
                <th className="text-left px-4 py-3 font-bold text-slate-500 dark:text-slate-400">Resolvida</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id} className="border-b border-slate-100 dark:border-slate-800">
                  <td className="px-4 py-3">{r.date}</td>
                  <td className="px-4 py-3">{r.employee_name}</td>
                  <td className="px-4 py-3">{typeLabels[r.type] || r.type}</td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{r.description}</td>
                  <td className="px-4 py-3">{r.resolved ? 'Sim' : 'Não'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && <p className="p-6 text-center text-slate-500 dark:text-slate-400">Nenhuma inconsistência no período.</p>}
        </div>
      )}
    </div>
  );
};

export default ReportInconsistencies;
