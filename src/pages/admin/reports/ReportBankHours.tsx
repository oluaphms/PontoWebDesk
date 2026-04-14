import React, { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Scale } from 'lucide-react';
import { useCurrentUser } from '../../../hooks/useCurrentUser';
import PageHeader from '../../../components/PageHeader';
import { db, isSupabaseConfigured } from '../../../services/supabaseClient';
import { LoadingState } from '../../../../components/UI';
import { adminReportCacheKey, queryCache, TTL } from '../../../services/queryCache';

interface BankRow {
  employee_id: string;
  employee_name: string;
  balance: number;
  last_date: string;
}

const ReportBankHours: React.FC = () => {
  const { user, loading } = useCurrentUser();
  const [rows, setRows] = useState<BankRow[]>([]);
  const [loadingData, setLoadingData] = useState(false);

  useEffect(() => {
    if (!user?.companyId || !isSupabaseConfigured) return;
    const cid = user.companyId!;
    setLoadingData(true);
    const cacheKey = adminReportCacheKey(cid, 'bank_hours_summary');
    (async () => {
      try {
        const list = await queryCache.getOrFetch(
          cacheKey,
          async () => {
            const [bankRows, userRows] = await Promise.all([
              db.select('bank_hours', [{ column: 'company_id', operator: 'eq', value: cid }], { column: 'date', ascending: false }, 2000) as Promise<any[]>,
              queryCache.getOrFetch(
                `users:${cid}`,
                () => db.select('users', [{ column: 'company_id', operator: 'eq', value: cid }]) as Promise<any[]>,
                TTL.NORMAL,
              ),
            ]);
            const empMap = new Map<string, string>();
            (userRows ?? []).forEach((u: any) => empMap.set(u.id, u.nome || u.email));
            const byEmployee = new Map<string, { balance: number; last_date: string }>();
            (bankRows ?? []).forEach((r: any) => {
              if (!byEmployee.has(r.employee_id)) {
                byEmployee.set(r.employee_id, { balance: r.balance ?? 0, last_date: r.date ?? '' });
              }
            });
            const out: BankRow[] = [];
            byEmployee.forEach((v, eid) => {
              out.push({
                employee_id: eid,
                employee_name: empMap.get(eid) || eid?.slice(0, 8) || '—',
                balance: v.balance,
                last_date: v.last_date,
              });
            });
            out.sort((a, b) => b.balance - a.balance);
            return out;
          },
          TTL.NORMAL,
        );
        setRows(list);
      } finally {
        setLoadingData(false);
      }
    })();
  }, [user?.companyId]);

  if (loading) return <LoadingState message="Carregando..." />;
  if (!user) return <Navigate to="/" replace />;

  return (
    <div className="space-y-6">
      <PageHeader title="Relatório de Banco de Horas" subtitle="Saldo atual por funcionário" icon={<Scale className="w-5 h-5" />} />
      {loadingData ? (
        <LoadingState message="Carregando..." />
      ) : (
        <div className="rounded-xl border border-slate-200 dark:border-slate-700 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-700">
                <th className="text-left px-4 py-3 font-bold text-slate-500 dark:text-slate-400">Funcionário</th>
                <th className="text-right px-4 py-3 font-bold text-slate-500 dark:text-slate-400">Saldo (h)</th>
                <th className="text-left px-4 py-3 font-bold text-slate-500 dark:text-slate-400">Última movimentação</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.employee_id} className="border-b border-slate-100 dark:border-slate-800">
                  <td className="px-4 py-3">{r.employee_name}</td>
                  <td className={`text-right px-4 py-3 tabular-nums font-medium ${r.balance >= 0 ? 'text-emerald-600' : 'text-amber-600'}`}>{r.balance >= 0 ? '+' : ''}{r.balance.toFixed(2)}h</td>
                  <td className="px-4 py-3">{r.last_date || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 && <p className="p-6 text-center text-slate-500 dark:text-slate-400">Nenhuma movimentação de banco de horas.</p>}
        </div>
      )}
    </div>
  );
};

export default ReportBankHours;
