import React, { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Scale, User, TrendingUp, TrendingDown } from 'lucide-react';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import PageHeader from '../../components/PageHeader';
import { db, isSupabaseConfigured } from '../../services/supabaseClient';
import { LoadingState, Input } from '../../../components/UI';
import { formatDateForTablePtBr } from '../../utils/timeCalculations';
import RoleGuard from '../../components/auth/RoleGuard';
import { queryCache, TTL } from '../../services/queryCache';

interface BankHoursRow {
  id: string;
  employee_id: string;
  date: string;
  hours_added: number;
  hours_removed: number;
  balance: number;
  source?: string;
  created_at: string;
}

interface EmployeeOption {
  id: string;
  nome: string;
}

const AdminBankHours: React.FC = () => {
  const { user, loading } = useCurrentUser();
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [filterUserId, setFilterUserId] = useState('');
  const [monthFilter, setMonthFilter] = useState(() => {
    const n = new Date();
    return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}`;
  });
  const [rows, setRows] = useState<BankHoursRow[]>([]);
  const [timeBalanceRows, setTimeBalanceRows] = useState<any[]>([]);
  const [loadingData, setLoadingData] = useState(false);

  useEffect(() => {
    if (!user?.companyId || !isSupabaseConfigured) return;
    const load = async () => {
      // Otimização: carregar apenas colunas necessárias
      const usersRows = await queryCache.getOrFetch(
        `users:${user.companyId}`,
        () => db.select('users', [{ column: 'company_id', operator: 'eq', value: user.companyId }], {
          columns: 'id, nome, email',
          limit: 500,
        }) as Promise<any[]>,
        TTL.NORMAL,
      );
      setEmployees((usersRows ?? []).map((u: any) => ({ id: u.id, nome: u.nome || u.email })));
    };
    load();
  }, [user?.companyId]);

  useEffect(() => {
    if (!user?.companyId || !isSupabaseConfigured) return;
    const load = async () => {
      setLoadingData(true);
      try {
        const cid = user.companyId;
        // Chave alinhada a invalidateAfterTimesheetMonthClose (prefixo admin_bank_hours:${companyId})
        const cacheKey = `admin_bank_hours:${cid}:${filterUserId || 'all'}:${monthFilter}:e${employees.length}`;

        const { bankRows, balanceRows } = await queryCache.getOrFetch(
          cacheKey,
          async () => {
            const filters: { column: string; operator: string; value: any }[] = [
              { column: 'company_id', operator: 'eq', value: cid },
            ];
            if (filterUserId) filters.push({ column: 'employee_id', operator: 'eq', value: filterUserId });
            const userIds = filterUserId ? [filterUserId] : employees.map((e) => e.id);
            const bank = (await db.select('bank_hours', filters, { column: 'date', ascending: false }, 500)) as any[];

            let balances: any[] = [];
            if (userIds.length > 0) {
              const balanceFilters: { column: string; operator: string; value: any }[] = [
                { column: 'month', operator: 'eq', value: monthFilter },
                { column: 'user_id', operator: 'in', value: userIds },
              ];
              balances = ((await db.select('time_balance', balanceFilters, undefined, 200)) as any[]) ?? [];
            }
            return { bankRows: bank ?? [], balanceRows: balances };
          },
          TTL.NORMAL,
        );

        setRows(bankRows ?? []);
        setTimeBalanceRows(balanceRows ?? []);
      } catch (e) {
        console.error(e);
      } finally {
        setLoadingData(false);
      }
    };
    load();
  }, [user?.companyId, filterUserId, monthFilter, employees]);

  const byEmployee = React.useMemo(() => {
    const map = new Map<string, { movements: BankHoursRow[]; currentBalance: number }>();
    const sorted = [...rows].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    sorted.forEach((r) => {
      if (!map.has(r.employee_id)) map.set(r.employee_id, { movements: [], currentBalance: 0 });
      const entry = map.get(r.employee_id)!;
      entry.movements.push(r);
      if (entry.currentBalance === 0) entry.currentBalance = r.balance ?? 0;
    });
    return map;
  }, [rows]);

  const employeeName = (id: string) => employees.find((e) => e.id === id)?.nome || id?.slice(0, 8) || '—';

  return (
    <RoleGuard user={user} allowedRoles={['admin', 'hr']}>
      <div className="space-y-6">
        <PageHeader
          title="Banco de Horas"
          subtitle="Saldo e histórico de créditos e débitos por funcionário"
          icon={<Scale className="w-5 h-5" />}
        />

        <div className="glass-card rounded-[2.25rem] p-6 flex flex-wrap gap-4 items-end">
          <div className="min-w-[200px]">
            <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Funcionário</label>
            <select
              className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm"
              value={filterUserId}
              onChange={(e) => setFilterUserId(e.target.value)}
            >
              <option value="">Todos</option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>{e.nome}</option>
              ))}
            </select>
          </div>
          <div className="min-w-[140px]">
            <Input
              label="Mês (resumo mensal)"
              type="month"
              value={monthFilter}
              onChange={(e) => setMonthFilter(e.target.value)}
            />
          </div>
        </div>

        {loading ? (
          <LoadingState message="Carregando..." />
        ) : !user ? (
          <Navigate to="/" replace />
        ) : loadingData ? (
          <LoadingState message="Carregando movimentações..." />
        ) : (
          <div className="space-y-6">
            {timeBalanceRows.length > 0 && (
              <div className="glass-card rounded-[2.25rem] p-6">
                <h3 className="text-sm font-bold text-slate-600 dark:text-slate-300 mb-4">Resumo mensal (fechamento)</h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 dark:border-slate-700">
                        <th className="text-left py-2 px-2">Funcionário</th>
                        <th className="text-right py-2 px-2">Total horas</th>
                        <th className="text-right py-2 px-2">Extras</th>
                        <th className="text-right py-2 px-2">Débito</th>
                        <th className="text-right py-2 px-2">Saldo final</th>
                      </tr>
                    </thead>
                    <tbody>
                      {timeBalanceRows.map((b: any) => (
                        <tr key={b.id} className="border-b border-slate-100 dark:border-slate-800">
                          <td className="py-2 px-2">{employeeName(b.user_id)}</td>
                          <td className="text-right py-2 px-2">{Number(b.total_hours ?? 0).toFixed(1)}h</td>
                          <td className="text-right py-2 px-2 text-emerald-600">{Number(b.extra_hours ?? 0).toFixed(1)}h</td>
                          <td className="text-right py-2 px-2 text-amber-600">{Number(b.debit_hours ?? 0).toFixed(1)}h</td>
                          <td className="text-right py-2 px-2 font-medium">{Number(b.final_balance ?? 0).toFixed(1)}h</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div className="glass-card rounded-[2.25rem] p-6">
              <h3 className="text-sm font-bold text-slate-600 dark:text-slate-300 mb-4">Movimentação do banco</h3>
              {rows.length === 0 ? (
                <p className="text-slate-500 dark:text-slate-400 text-sm">Nenhuma movimentação no período.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 dark:border-slate-700">
                        <th className="text-left py-2 px-2">Data</th>
                        <th className="text-left py-2 px-2">Funcionário</th>
                        <th className="text-right py-2 px-2">Crédito</th>
                        <th className="text-right py-2 px-2">Débito</th>
                        <th className="text-right py-2 px-2">Saldo</th>
                        <th className="text-left py-2 px-2">Origem</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.slice(0, 200).map((r) => (
                        <tr key={r.id} className="border-b border-slate-100 dark:border-slate-800">
                          <td className="py-2 px-2">{formatDateForTablePtBr(r.date)}</td>
                          <td className="py-2 px-2">{employeeName(r.employee_id)}</td>
                          <td className="text-right py-2 px-2 text-emerald-600">
                            {(r.hours_added ?? 0) > 0 ? `+${Number(r.hours_added).toFixed(2)}h` : '—'}
                          </td>
                          <td className="text-right py-2 px-2 text-amber-600">
                            {(r.hours_removed ?? 0) > 0 ? `-${Number(r.hours_removed).toFixed(2)}h` : '—'}
                          </td>
                          <td className="text-right py-2 px-2 font-medium">{Number(r.balance ?? 0).toFixed(2)}h</td>
                          <td className="py-2 px-2 text-slate-500">{r.source || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </RoleGuard>
  );
};

export default AdminBankHours;
