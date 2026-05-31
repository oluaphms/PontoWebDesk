import { observabilityConsole } from '../../shared/logger/observabilityConsole';
import React, { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Scale } from 'lucide-react';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import PageHeader from '../../components/PageHeader';
import { db, isSupabaseConfigured, type Filter } from '../../services/supabaseClient';
import { LoadingState, Input } from '../../../components/UI';
import { formatDateForTablePtBr } from '../../utils/timeCalculations';
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

/** Motor atual: `applyDailyBankLedger` grava em `bank_hours_ledger` (FIFO). */
interface BankHoursLedgerRow {
  id: string;
  employee_id: string;
  company_id: string;
  date: string;
  minutes: number;
  type: string;
  source: string;
  expires_at?: string | null;
  used_minutes: number;
  created_at: string;
}

interface EmployeeOption {
  id: string;
  nome: string;
}

function formatMonthYearPtBr(ym: string): string {
  const [y, m] = ym.split('-').map((x) => parseInt(x, 10));
  if (!y || !m || m < 1 || m > 12) return ym;
  const d = new Date(y, m - 1, 1);
  return new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' }).format(d);
}

function minutesToH(m: number): string {
  const h = m / 60;
  return `${h >= 0 ? '' : '−'}${Math.abs(h).toFixed(2)}h`;
}

function ledgerTypeLabel(t: string): string {
  const u = String(t || '').toUpperCase();
  if (u === 'CREDIT') return 'Crédito';
  if (u === 'DEBIT') return 'Débito';
  return t || '—';
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
  const [ledgerRows, setLedgerRows] = useState<BankHoursLedgerRow[]>([]);
  const [timeBalanceRows, setTimeBalanceRows] = useState<any[]>([]);
  const [recentOutsideMonth, setRecentOutsideMonth] = useState<BankHoursRow[]>([]);
  const [recentLedgerOutside, setRecentLedgerOutside] = useState<BankHoursLedgerRow[]>([]);
  const [loadingData, setLoadingData] = useState(false);

  useEffect(() => {
    if (!user?.companyId || !isSupabaseConfigured()) return;
    const load = async () => {
      const usersRows = await queryCache.getOrFetch(
        `users:${user.companyId}`,
        () =>
          db.select('users', [{ column: 'company_id', operator: 'eq', value: user.companyId }], {
            columns: 'id, nome, email',
            limit: 500,
          }) as Promise<any[]>,
        TTL.NORMAL,
      );
      setEmployees((usersRows ?? []).map((u: any) => ({ id: u.id, nome: u.nome || u.email })));
    };
    void load();
  }, [user?.companyId]);

  useEffect(() => {
    if (!user?.companyId || !isSupabaseConfigured()) return;
    const load = async () => {
      setLoadingData(true);
      try {
        const cid = user.companyId;
        const [yy, mm] = monthFilter.split('-').map((x) => parseInt(x, 10));
        const lastD = yy && mm ? new Date(yy, mm, 0).getDate() : 31;
        const monthStart = yy && mm ? `${yy}-${String(mm).padStart(2, '0')}-01` : `${monthFilter}-01`;
        const monthEnd =
          yy && mm ? `${yy}-${String(mm).padStart(2, '0')}-${String(lastD).padStart(2, '0')}` : `${monthFilter}-31`;

        const cacheKey = `admin_bank_hours:${cid}:${filterUserId || 'all'}:${monthFilter}:ledger_v1`;

        const { bankRows, balanceRows, ledger } = await queryCache.getOrFetch(
          cacheKey,
          async () => {
            const baseFilters: Filter[] = [
              { column: 'company_id', operator: 'eq', value: String(cid).trim() },
              { column: 'date', operator: 'gte', value: monthStart },
              { column: 'date', operator: 'lte', value: monthEnd },
            ];
            const empFilter: Filter[] = filterUserId
              ? [...baseFilters, { column: 'employee_id', operator: 'eq', value: filterUserId }]
              : baseFilters;

            const [bank, led] = await Promise.all([
              db.select('bank_hours', empFilter, { column: 'date', ascending: false }, 500).catch(() => [] as any[]),
              db
                .select('bank_hours_ledger', empFilter, { column: 'created_at', ascending: false }, 800)
                .catch(() => [] as any[]),
            ]);

            let balances: any[] = [];
            const userIds = filterUserId ? [filterUserId] : employees.map((e) => e.id);
            if (userIds.length > 0) {
              const balanceFilters: Filter[] = [
                { column: 'month', operator: 'eq', value: monthFilter },
                { column: 'user_id', operator: 'in', value: userIds },
              ];
              balances = ((await db.select('time_balance', balanceFilters, undefined, 200)) as any[]) ?? [];
            }
            return { bankRows: bank ?? [], balanceRows: balances, ledger: led ?? [] };
          },
          TTL.NORMAL,
        );

        const mappedLedger: BankHoursLedgerRow[] = (ledger ?? []).map((r: any) => ({
          id: String(r.id),
          employee_id: String(r.employee_id),
          company_id: String(r.company_id ?? ''),
          date: String(r.date || '').slice(0, 10),
          minutes: Number(r.minutes ?? 0),
          type: String(r.type ?? ''),
          source: String(r.source ?? ''),
          expires_at: r.expires_at != null ? String(r.expires_at) : null,
          used_minutes: Number(r.used_minutes ?? 0),
          created_at: String(r.created_at ?? ''),
        }));

        setRows(bankRows ?? []);
        setLedgerRows(mappedLedger);
        setTimeBalanceRows(balanceRows ?? []);

        const monthEmptyLegacy = !(bankRows ?? []).length;
        const monthEmptyLedger = !mappedLedger.length;
        if (monthEmptyLegacy && monthEmptyLedger) {
          try {
            const rf: Filter[] = [{ column: 'company_id', operator: 'eq', value: String(cid).trim() }];
            if (filterUserId) rf.push({ column: 'employee_id', operator: 'eq', value: filterUserId });
            const [recentBank, recentLed] = await Promise.all([
              db.select('bank_hours', rf, { column: 'date', ascending: false }, 25).catch(() => [] as any[]),
              db.select('bank_hours_ledger', rf, { column: 'created_at', ascending: false }, 40).catch(() => [] as any[]),
            ]);
            const outsideB = (recentBank ?? []).filter((r: any) => {
              const d = String(r.date || '').slice(0, 10);
              return d && (d < monthStart || d > monthEnd);
            }) as BankHoursRow[];
            const outsideL = (recentLed ?? [])
              .filter((r: any) => {
                const d = String(r.date || '').slice(0, 10);
                return d && (d < monthStart || d > monthEnd);
              })
              .map((r: any) => ({
                id: String(r.id),
                employee_id: String(r.employee_id),
                company_id: String(r.company_id ?? ''),
                date: String(r.date || '').slice(0, 10),
                minutes: Number(r.minutes ?? 0),
                type: String(r.type ?? ''),
                source: String(r.source ?? ''),
                expires_at: r.expires_at != null ? String(r.expires_at) : null,
                used_minutes: Number(r.used_minutes ?? 0),
                created_at: String(r.created_at ?? ''),
              }));
            setRecentOutsideMonth(outsideB);
            setRecentLedgerOutside(outsideL);
          } catch {
            setRecentOutsideMonth([]);
            setRecentLedgerOutside([]);
          }
        } else {
          setRecentOutsideMonth([]);
          setRecentLedgerOutside([]);
        }
      } catch (e) {
        observabilityConsole.error(e);
      } finally {
        setLoadingData(false);
      }
    };
    void load();
  }, [user?.companyId, filterUserId, monthFilter, employees]);

  const employeeName = (id: string) => employees.find((e) => e.id === id)?.nome || id?.slice(0, 8) || '—';

  const hasLedgerInMonth = ledgerRows.length > 0;
  const hasLegacyInMonth = rows.length > 0;
  const hasAnyMovement = hasLedgerInMonth || hasLegacyInMonth;

  return (
    <div className="space-y-6">
      <PageHeader
        helpSlug="banco-de-horas"
        helpSection="como-funciona"
        title="Banco de Horas"
        subtitle="Ledger atual (FIFO) e registros legados; fechamento mensal quando existir."
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
              <option key={e.id} value={e.id}>
                {e.nome}
              </option>
            ))}
          </select>
        </div>
        <div className="min-w-[140px]">
          <Input
            label="Mês (movimentações e fechamento)"
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

          <div className="glass-card rounded-[2.25rem] p-6 space-y-8">
            <div>
              <h3 className="text-sm font-bold text-slate-600 dark:text-slate-300 mb-1">Movimentações do ledger (motor atual)</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
                O processamento diário grava créditos/débitos em <code className="text-[10px]">bank_hours_ledger</code> (saldo
                FIFO com <code className="text-[10px]">used_minutes</code>).
              </p>
              {hasLedgerInMonth ? (
                <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-800/50">
                        <th className="text-left py-2 px-2">Data ref.</th>
                        {!filterUserId ? <th className="text-left py-2 px-2">Funcionário</th> : null}
                        <th className="text-left py-2 px-2">Tipo</th>
                        <th className="text-left py-2 px-2">Origem</th>
                        <th className="text-right py-2 px-2">Minutos</th>
                        <th className="text-right py-2 px-2">Utilizado</th>
                        <th className="text-left py-2 px-2">Expira</th>
                        <th className="text-left py-2 px-2">Registrado em</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ledgerRows.map((r) => (
                        <tr key={r.id} className="border-b border-slate-100 dark:border-slate-800">
                          <td className="py-2 px-2 whitespace-nowrap">{formatDateForTablePtBr(r.date)}</td>
                          {!filterUserId ? <td className="py-2 px-2">{employeeName(r.employee_id)}</td> : null}
                          <td
                            className={`py-2 px-2 font-medium ${
                              r.type === 'CREDIT' ? 'text-emerald-600' : r.type === 'DEBIT' ? 'text-amber-700' : ''
                            }`}
                          >
                            {ledgerTypeLabel(r.type)}
                          </td>
                          <td className="py-2 px-2 text-slate-600 dark:text-slate-300">{r.source}</td>
                          <td className="py-2 px-2 text-right tabular-nums">{minutesToH(r.minutes)}</td>
                          <td className="py-2 px-2 text-right tabular-nums text-slate-500">{minutesToH(r.used_minutes)}</td>
                          <td className="py-2 px-2 text-xs text-slate-500">
                            {r.expires_at ? formatDateForTablePtBr(r.expires_at.slice(0, 10)) : '—'}
                          </td>
                          <td className="py-2 px-2 text-xs text-slate-500 whitespace-nowrap">
                            {r.created_at ? new Date(r.created_at).toLocaleString('pt-BR') : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-sm text-slate-500 dark:text-slate-400">Nenhum lançamento no ledger neste mês para o filtro.</p>
              )}
            </div>

            <div>
              <h3 className="text-sm font-bold text-slate-600 dark:text-slate-300 mb-1">Registros legados (bank_hours)</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
                Tabela antiga de movimentos cumulativos; pode coexistir com o ledger em migrações antigas.
              </p>
              {hasLegacyInMonth ? (
                <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-800/50">
                        <th className="text-left py-2 px-2">Data</th>
                        {!filterUserId ? <th className="text-left py-2 px-2">Funcionário</th> : null}
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
                          {!filterUserId ? <td className="py-2 px-2">{employeeName(r.employee_id)}</td> : null}
                          <td className="text-right py-2 px-2 text-emerald-600">
                            {(r.hours_added ?? 0) > 0 ? `+${Number(r.hours_added).toFixed(2)}h` : '—'}
                          </td>
                          <td className="text-right py-2 px-2 text-amber-600">
                            {(r.hours_removed ?? 0) > 0 ? `−${Number(r.hours_removed).toFixed(2)}h` : '—'}
                          </td>
                          <td className="text-right py-2 px-2 font-medium">{Number(r.balance ?? 0).toFixed(2)}h</td>
                          <td className="py-2 px-2 text-slate-500">{r.source || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-sm text-slate-500 dark:text-slate-400">Nenhum registro legado neste mês.</p>
              )}
            </div>

            {!hasAnyMovement && (
              <div className="space-y-4 text-sm text-slate-600 dark:text-slate-400 border-t border-slate-200 dark:border-slate-700 pt-6">
                <p>
                  Nenhuma movimentação em{' '}
                  <strong className="text-slate-800 dark:text-slate-200">{formatMonthYearPtBr(monthFilter)}</strong>
                  {filterUserId ? (
                    <>
                      {' '}
                      para <strong className="text-slate-800 dark:text-slate-200">{employeeName(filterUserId)}</strong>{' '}
                      no ledger nem em bank_hours.
                    </>
                  ) : (
                    <> para a empresa neste período (ledger e legado).</>
                  )}
                </p>
                {(recentLedgerOutside.length > 0 || recentOutsideMonth.length > 0) && (
                  <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-900/40 p-4 space-y-4">
                    <p className="text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wide">
                      Histórico fora do mês selecionado
                    </p>
                    {recentLedgerOutside.length > 0 && (
                      <div>
                        <p className="text-xs text-slate-500 mb-2">Ledger ({recentLedgerOutside.length})</p>
                        <div className="overflow-x-auto">
                          <table className="w-full text-xs sm:text-sm">
                            <thead>
                              <tr className="border-b border-slate-200 dark:border-slate-700 text-left">
                                <th className="py-2 pr-2">Data</th>
                                {!filterUserId ? <th className="py-2 pr-2">Funcionário</th> : null}
                                <th className="py-2 pr-2">Tipo</th>
                                <th className="py-2 pr-2 text-right">Minutos</th>
                                <th className="py-2">Origem</th>
                              </tr>
                            </thead>
                            <tbody>
                              {recentLedgerOutside.map((r) => (
                                <tr key={r.id} className="border-b border-slate-100 dark:border-slate-800">
                                  <td className="py-2 pr-2 whitespace-nowrap">{formatDateForTablePtBr(r.date)}</td>
                                  {!filterUserId ? <td className="py-2 pr-2">{employeeName(r.employee_id)}</td> : null}
                                  <td className="py-2 pr-2">{ledgerTypeLabel(r.type)}</td>
                                  <td className="py-2 pr-2 text-right tabular-nums">{minutesToH(r.minutes)}</td>
                                  <td className="py-2 text-slate-500">{r.source}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                    {recentOutsideMonth.length > 0 && (
                      <div>
                        <p className="text-xs text-slate-500 mb-2">Legado bank_hours ({recentOutsideMonth.length})</p>
                        <div className="overflow-x-auto">
                          <table className="w-full text-xs sm:text-sm">
                            <thead>
                              <tr className="border-b border-slate-200 dark:border-slate-700 text-left">
                                <th className="py-2 pr-2">Data</th>
                                {!filterUserId ? <th className="py-2 pr-2">Funcionário</th> : null}
                                <th className="py-2 pr-2 text-right">Saldo</th>
                                <th className="py-2">Origem</th>
                              </tr>
                            </thead>
                            <tbody>
                              {recentOutsideMonth.map((r) => (
                                <tr key={r.id} className="border-b border-slate-100 dark:border-slate-800">
                                  <td className="py-2 pr-2 whitespace-nowrap">{formatDateForTablePtBr(r.date)}</td>
                                  {!filterUserId ? <td className="py-2 pr-2">{employeeName(r.employee_id)}</td> : null}
                                  <td className="py-2 pr-2 text-right font-medium tabular-nums">
                                    {Number(r.balance ?? 0).toFixed(2)}h
                                  </td>
                                  <td className="py-2 text-slate-500">{r.source || '—'}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                  </div>
                )}
                {!recentLedgerOutside.length && !recentOutsideMonth.length && (
                  <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                    Também não há histórico anterior. Confirme em Configurações se o banco de horas está habilitado (
                    <code className="text-[10px]">time_bank_enabled</code>) e se o processamento diário rodou para os dias
                    com extras ou faltas.
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminBankHours;
