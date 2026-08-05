import React, { useEffect, useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Scale } from 'lucide-react';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import PageHeader from '../../components/PageHeader';
import { db, isSupabaseConfigured, type Filter } from '../../services/supabaseClient';
import { Input, LoadingState } from '../../../components/UI';
import { formatDateForTablePtBr } from '../../utils/timeCalculations';
import { queryCache, TTL } from '../../services/queryCache';
import { apiGet, apiPost } from '../../services/api';
import { useToast } from '../../components/ToastProvider';
import { fetchEmployeesPage } from '../../services/employeesApi.service';

interface BankHoursLedgerRow {
  id: string;
  employee_id: string;
  company_id: string;
  date: string;
  minutes: number;
  type: 'CREDIT' | 'DEBIT' | string;
  source: string;
  expires_at?: string | null;
  used_minutes: number;
  created_at: string;
}

interface EmployeeOption {
  id: string;
  nome: string;
}

type SummaryRow = {
  employee_id: string;
  movement_count: number;
  credit_available_minutes: number;
  debit_minutes: number;
  balance_minutes: number;
  last_movement_date: string | null;
};

type FormMode = 'manual' | 'overtime' | 'compensation';

type PendingRequestRow = {
  id: string;
  user_id: string;
  company_id: string;
  type: 'overtime_request' | 'time_bank_compensation' | string;
  status: string;
  reason: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

function parseMetadata(value: unknown): Record<string, unknown> | null {
  if (!value) return null;
  if (typeof value === 'object') return value as Record<string, unknown>;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (parsed && typeof parsed === 'object') return parsed as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  return null;
}

function formatMonthYearPtBr(ym: string): string {
  const [y, m] = ym.split('-').map((x) => parseInt(x, 10));
  if (!y || !m || m < 1 || m > 12) return ym;
  const d = new Date(y, m - 1, 1);
  return new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' }).format(d);
}

function minutesToH(m: number): string {
  const sign = m >= 0 ? '' : '−';
  const abs = Math.abs(m);
  const hh = Math.floor(abs / 60);
  const mm = abs % 60;
  return `${sign}${hh}h ${String(mm).padStart(2, '0')}m`;
}

function ledgerTypeLabel(t: string): string {
  const u = String(t || '').toUpperCase();
  if (u === 'CREDIT') return 'Crédito';
  if (u === 'DEBIT') return 'Débito';
  return t || '—';
}

function computeLedgerAvailableBalanceMinutes(rows: BankHoursLedgerRow[]): number {
  return rows.reduce((acc, row) => {
    const type = String(row.type ?? '').toUpperCase();
    if (type === 'CREDIT') return acc + Math.max(0, row.minutes - row.used_minutes);
    if (type === 'DEBIT') return acc - Math.max(0, row.minutes);
    return acc;
  }, 0);
}

const AdminBankHours: React.FC = () => {
  const { user, loading } = useCurrentUser();
  const toast = useToast();
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [filterUserId, setFilterUserId] = useState('');
  const [monthFilter, setMonthFilter] = useState(() => {
    const n = new Date();
    return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}`;
  });
  const [summaryRows, setSummaryRows] = useState<SummaryRow[]>([]);
  const [ledgerRows, setLedgerRows] = useState<BankHoursLedgerRow[]>([]);
  const [pendingRows, setPendingRows] = useState<PendingRequestRow[]>([]);
  const [recentLedgerOutside, setRecentLedgerOutside] = useState<BankHoursLedgerRow[]>([]);
  const [loadingData, setLoadingData] = useState(false);
  const [formMode, setFormMode] = useState<FormMode>('manual');
  const [formEmployeeId, setFormEmployeeId] = useState('');
  const [formType, setFormType] = useState<'CREDIT' | 'DEBIT'>('CREDIT');
  const [formMinutes, setFormMinutes] = useState('60');
  const [formReason, setFormReason] = useState('');
  const [formDate, setFormDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [submittingForm, setSubmittingForm] = useState(false);

  useEffect(() => {
    if (!user?.companyId) return;
    const load = async () => {
      const { employees: employeeRows } = await fetchEmployeesPage(user.companyId, { limit: 200, offset: 0 });
      const activeEmployees = (employeeRows ?? [])
        .filter((employee) => employee.status !== 'inactive' && employee.status !== 'inativo' && employee.invisivel !== true)
        .map((employee) => ({
          id: String(employee.id),
          nome: String(employee.nome || employee.email || employee.id),
        }));
      setEmployees(activeEmployees);
      if (filterUserId && !activeEmployees.some((employee) => employee.id === filterUserId)) {
        setFilterUserId('');
      }
    };
    void load();
  }, [filterUserId, user?.companyId]);

  useEffect(() => {
    if (!user?.companyId || !isSupabaseConfigured()) return;
    const load = async () => {
      setLoadingData(true);
      try {
        const cid = user.companyId;
        const [yy, mm] = monthFilter.split('-').map((x) => parseInt(x, 10));
        const lastD = yy && mm ? new Date(yy, mm, 0).getDate() : 31;
        const monthStart = yy && mm ? `${yy}-${String(mm).padStart(2, '0')}-01` : `${monthFilter}-01`;
        const monthEnd = yy && mm ? `${yy}-${String(mm).padStart(2, '0')}-${String(lastD).padStart(2, '0')}` : `${monthFilter}-31`;

        const cacheKey = `admin_bank_hours:${cid}:${filterUserId || 'all'}:${monthFilter}:ledger_only_v2`;
        const payload = await queryCache.getOrFetch(
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
            const [ledgerData, summary, pending] = await Promise.all([
              db.select('bank_hours_ledger', empFilter, { column: 'created_at', ascending: false }, 800).catch(() => [] as any[]),
              apiGet<{ ok: boolean; data?: SummaryRow[] }>(
                `/bank-hours/summary?month=${encodeURIComponent(monthFilter)}${
                  filterUserId ? `&employeeId=${encodeURIComponent(filterUserId)}` : ''
                }`,
              ).catch(() => ({ ok: true, data: [] as SummaryRow[] })),
              apiGet<{ ok: boolean; data?: PendingRequestRow[] }>('/bank-hours/requests?status=pending').catch(() => ({
                ok: true,
                data: [] as PendingRequestRow[],
              })),
            ]);
            return { ledgerData: ledgerData ?? [], summary: summary.data ?? [], pending: pending.data ?? [] };
          },
          TTL.NORMAL,
        );

        const mappedLedger: BankHoursLedgerRow[] = (payload.ledgerData ?? []).map((r: any) => ({
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

        setLedgerRows(mappedLedger);
        setSummaryRows((payload.summary ?? []).map((r) => ({ ...r })));
        setPendingRows(
          (payload.pending ?? []).map((r) => ({
            ...r,
            metadata: parseMetadata(r.metadata),
          })),
        );

        if (!mappedLedger.length) {
          const rf: Filter[] = [{ column: 'company_id', operator: 'eq', value: String(cid).trim() }];
          if (filterUserId) rf.push({ column: 'employee_id', operator: 'eq', value: filterUserId });
          const recentLed = await db
            .select('bank_hours_ledger', rf, { column: 'created_at', ascending: false }, 40)
            .catch(() => [] as any[]);
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
          setRecentLedgerOutside(outsideL);
        } else {
          setRecentLedgerOutside([]);
        }
      } finally {
        setLoadingData(false);
      }
    };
    void load();
  }, [user?.companyId, filterUserId, monthFilter]);

  const employeeName = (id: string) => employees.find((e) => e.id === id)?.nome || id.slice(0, 8) || '—';
  const hasLedgerInMonth = ledgerRows.length > 0;

  const localSummary = useMemo<SummaryRow[]>(() => {
    if (summaryRows.length > 0) return summaryRows;
    const grouped = new Map<string, BankHoursLedgerRow[]>();
    for (const row of ledgerRows) {
      const arr = grouped.get(row.employee_id) ?? [];
      arr.push(row);
      grouped.set(row.employee_id, arr);
    }
    return Array.from(grouped.entries())
      .map(([employee_id, rows]) => {
        const creditAvailable = rows
          .filter((r) => String(r.type).toUpperCase() === 'CREDIT')
          .reduce((acc, r) => acc + Math.max(0, r.minutes - r.used_minutes), 0);
        const debitMinutes = rows
          .filter((r) => String(r.type).toUpperCase() === 'DEBIT')
          .reduce((acc, r) => acc + Math.max(0, r.minutes), 0);
        return {
          employee_id,
          movement_count: rows.length,
          credit_available_minutes: creditAvailable,
          debit_minutes: debitMinutes,
          balance_minutes: computeLedgerAvailableBalanceMinutes(rows),
          last_movement_date: rows[0]?.date ?? null,
        };
      })
      .sort((a, b) => b.balance_minutes - a.balance_minutes);
  }, [summaryRows, ledgerRows]);

  const refreshCurrentData = async (): Promise<void> => {
    if (!user?.companyId) return;
    const keyPrefix = `admin_bank_hours:${user.companyId}:${filterUserId || 'all'}:${monthFilter}`;
    queryCache.invalidate(keyPrefix);
    const summaryKeyPrefix = `admin_bank_hours_summary:${user.companyId}:${monthFilter}:${filterUserId || 'all'}`;
    queryCache.invalidate(summaryKeyPrefix);
    setLoadingData(true);
    try {
      const [yy, mm] = monthFilter.split('-').map((x) => parseInt(x, 10));
      const lastD = yy && mm ? new Date(yy, mm, 0).getDate() : 31;
      const monthStart = yy && mm ? `${yy}-${String(mm).padStart(2, '0')}-01` : `${monthFilter}-01`;
      const monthEnd = yy && mm ? `${yy}-${String(mm).padStart(2, '0')}-${String(lastD).padStart(2, '0')}` : `${monthFilter}-31`;
      const baseFilters: Filter[] = [
        { column: 'company_id', operator: 'eq', value: String(user.companyId).trim() },
        { column: 'date', operator: 'gte', value: monthStart },
        { column: 'date', operator: 'lte', value: monthEnd },
      ];
      const empFilter: Filter[] = filterUserId
        ? [...baseFilters, { column: 'employee_id', operator: 'eq', value: filterUserId }]
        : baseFilters;
      const [ledgerData, summary, pending] = await Promise.all([
        db.select('bank_hours_ledger', empFilter, { column: 'created_at', ascending: false }, 800).catch(() => [] as any[]),
        apiGet<{ ok: boolean; data?: SummaryRow[] }>(
          `/bank-hours/summary?month=${encodeURIComponent(monthFilter)}${
            filterUserId ? `&employeeId=${encodeURIComponent(filterUserId)}` : ''
          }`,
        ).catch(() => ({ ok: true, data: [] as SummaryRow[] })),
        apiGet<{ ok: boolean; data?: PendingRequestRow[] }>('/bank-hours/requests?status=pending').catch(() => ({
          ok: true,
          data: [] as PendingRequestRow[],
        })),
      ]);
      const mappedLedger: BankHoursLedgerRow[] = (ledgerData ?? []).map((r: any) => ({
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
      setLedgerRows(mappedLedger);
      setSummaryRows((summary.data ?? []).map((r) => ({ ...r })));
      setPendingRows(
        (pending.data ?? []).map((r) => ({
          ...r,
          metadata: parseMetadata(r.metadata),
        })),
      );
    } finally {
      setLoadingData(false);
    }
  };

  const handleSubmitWorkflow = async (): Promise<void> => {
    const employeeId = String(formEmployeeId || filterUserId || '').trim();
    const minutes = Math.max(0, Math.round(Number(formMinutes || 0)));
    const reason = formReason.trim();
    if (!employeeId) {
      toast.addToast('error', 'Selecione um colaborador.');
      return;
    }
    if (!minutes) {
      toast.addToast('error', 'Informe a quantidade de minutos.');
      return;
    }
    if (reason.length < 3) {
      toast.addToast('error', 'Informe uma justificativa com ao menos 3 caracteres.');
      return;
    }
    setSubmittingForm(true);
    try {
      if (formMode === 'manual') {
        await apiPost('/bank-hours/manual-adjustments', {
          employeeId,
          type: formType,
          minutes,
          reason,
          date: formDate,
        });
        toast.addToast('success', 'Ajuste manual registrado no ledger.');
      } else if (formMode === 'overtime') {
        await apiPost('/bank-hours/overtime-requests', {
          employeeId,
          minutes,
          reason,
          requestedDate: formDate,
        });
        toast.addToast('success', 'Solicitação de hora extra criada.');
      } else {
        await apiPost('/bank-hours/compensation-requests', {
          employeeId,
          minutes,
          reason,
          requestedDate: formDate,
        });
        toast.addToast('success', 'Solicitação de compensação criada.');
      }
      setFormReason('');
      await refreshCurrentData();
    } catch (error) {
      toast.addToast('error', 'Falha ao registrar operação no banco de horas.');
      console.error(error);
    } finally {
      setSubmittingForm(false);
    }
  };

  const handleReviewPending = async (row: PendingRequestRow, approve: boolean): Promise<void> => {
    if (!row?.id) return;
    try {
      if (row.type === 'overtime_request') {
        await apiPost('/bank-hours/overtime-requests/review', {
          requestId: row.id,
          approve,
        });
      } else if (row.type === 'time_bank_compensation') {
        await apiPost('/bank-hours/compensation-requests/review', {
          requestId: row.id,
          approve,
        });
      } else {
        toast.addToast('error', 'Tipo de solicitação não suportado para revisão.');
        return;
      }
      toast.addToast('success', approve ? 'Solicitação aprovada.' : 'Solicitação rejeitada.');
      await refreshCurrentData();
    } catch (error) {
      console.error(error);
      toast.addToast('error', 'Falha ao revisar solicitação.');
    }
  };

  if (loading) return <LoadingState message="Carregando..." />;
  if (!user) return <Navigate to="/" replace />;

  return (
    <div className="space-y-6">
      <PageHeader
        helpSlug="banco-de-horas"
        helpSection="como-funciona"
        title="Banco de Horas"
        subtitle="Fonte oficial: bank_hours_ledger (crédito disponível FIFO menos débitos)."
        icon={<Scale className="w-5 h-5" />}
      />

      <div className="glass-card rounded-[2.25rem] p-6 flex flex-wrap gap-4 items-end">
        <div className="min-w-[220px]">
          <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Colaboradores</label>
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
        <div className="min-w-[160px]">
          <Input label="Mês" type="month" value={monthFilter} onChange={(e) => setMonthFilter(e.target.value)} />
        </div>
      </div>

      <div className="glass-card rounded-[2.25rem] p-6 space-y-4">
        <div className="flex flex-wrap items-end gap-4">
          <div className="min-w-[220px]">
            <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Fluxo RH</label>
            <select
              className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm"
              value={formMode}
              onChange={(e) => setFormMode(e.target.value as FormMode)}
            >
              <option value="manual">Ajuste manual</option>
              <option value="overtime">Solicitar hora extra</option>
              <option value="compensation">Solicitar compensação</option>
            </select>
          </div>
          <div className="min-w-[220px]">
            <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Colaborador</label>
            <select
              className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm"
              value={formEmployeeId}
              onChange={(e) => setFormEmployeeId(e.target.value)}
            >
              <option value="">Selecione</option>
              {employees.map((e) => (
                <option key={`form-${e.id}`} value={e.id}>
                  {e.nome}
                </option>
              ))}
            </select>
          </div>
          {formMode === 'manual' && (
            <div className="min-w-[180px]">
              <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Tipo</label>
              <select
                className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm"
                value={formType}
                onChange={(e) => setFormType(e.target.value as 'CREDIT' | 'DEBIT')}
              >
                <option value="CREDIT">Crédito</option>
                <option value="DEBIT">Débito</option>
              </select>
            </div>
          )}
          <div className="min-w-[160px]">
            <Input
              label="Minutos"
              type="number"
              min={1}
              step={1}
              value={formMinutes}
              onChange={(e) => setFormMinutes(e.target.value)}
            />
          </div>
          <div className="min-w-[180px]">
            <Input label="Data referência" type="date" value={formDate} onChange={(e) => setFormDate(e.target.value)} />
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Justificativa</label>
          <textarea
            className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm min-h-[84px]"
            value={formReason}
            onChange={(e) => setFormReason(e.target.value)}
            placeholder="Descreva o motivo da operação"
          />
        </div>
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => {
              void handleSubmitWorkflow();
            }}
            disabled={submittingForm}
            className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium disabled:opacity-50"
          >
            {submittingForm ? 'Enviando...' : 'Registrar'}
          </button>
        </div>
      </div>

      <div className="glass-card rounded-[2.25rem] p-6">
        <h3 className="text-sm font-bold text-slate-700 dark:text-slate-200 mb-1">Aprovações pendentes (RH)</h3>
        <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
          Fluxo oficial: solicitação pendente → aprovação/rejeição → lançamento no ledger (somente quando aprovado).
        </p>
        {pendingRows.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">Sem pendências no momento.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-800/50">
                  <th className="text-left py-2 px-2">Data</th>
                  <th className="text-left py-2 px-2">Colaborador</th>
                  <th className="text-left py-2 px-2">Fluxo</th>
                  <th className="text-right py-2 px-2">Minutos</th>
                  <th className="text-left py-2 px-2">Data referência</th>
                  <th className="text-left py-2 px-2">Motivo</th>
                  <th className="text-right py-2 px-2">Ações</th>
                </tr>
              </thead>
              <tbody>
                {pendingRows.map((row) => {
                  const m = row.metadata ?? {};
                  const requestedMinutes = Math.max(0, Number(m.requested_minutes ?? 0));
                  const requestedDate = String(m.requested_date ?? '').slice(0, 10);
                  return (
                    <tr key={row.id} className="border-b border-slate-100 dark:border-slate-800">
                      <td className="py-2 px-2 whitespace-nowrap">{formatDateForTablePtBr(String(row.created_at).slice(0, 10))}</td>
                      <td className="py-2 px-2">{employeeName(row.user_id)}</td>
                      <td className="py-2 px-2">{row.type === 'overtime_request' ? 'Hora extra' : 'Compensação'}</td>
                      <td className="py-2 px-2 text-right">{requestedMinutes}</td>
                      <td className="py-2 px-2">{requestedDate ? formatDateForTablePtBr(requestedDate) : '—'}</td>
                      <td className="py-2 px-2 max-w-[360px] truncate" title={row.reason || ''}>
                        {row.reason || '—'}
                      </td>
                      <td className="py-2 px-2">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            className="px-2.5 py-1.5 rounded-lg text-xs font-medium bg-emerald-600 hover:bg-emerald-700 text-white"
                            onClick={() => {
                              void handleReviewPending(row, true);
                            }}
                          >
                            Aprovar
                          </button>
                          <button
                            type="button"
                            className="px-2.5 py-1.5 rounded-lg text-xs font-medium bg-red-600 hover:bg-red-700 text-white"
                            onClick={() => {
                              void handleReviewPending(row, false);
                            }}
                          >
                            Rejeitar
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {loadingData ? (
        <LoadingState message="Carregando movimentações..." />
      ) : (
        <div className="space-y-6">
          <div className="glass-card rounded-[2.25rem] p-6">
            <h3 className="text-sm font-bold text-slate-700 dark:text-slate-200 mb-3">Resumo por colaborador</h3>
            {localSummary.length === 0 ? (
              <p className="text-sm text-slate-500 dark:text-slate-400">Sem saldo calculado no período selecionado.</p>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-800/50">
                      <th className="text-left py-2 px-2">Funcionário</th>
                      <th className="text-right py-2 px-2">Crédito disponível</th>
                      <th className="text-right py-2 px-2">Débito</th>
                      <th className="text-right py-2 px-2">Saldo</th>
                      <th className="text-right py-2 px-2">Mov.</th>
                      <th className="text-left py-2 px-2">Última data</th>
                    </tr>
                  </thead>
                  <tbody>
                    {localSummary.map((r) => (
                      <tr key={r.employee_id} className="border-b border-slate-100 dark:border-slate-800">
                        <td className="py-2 px-2">{employeeName(r.employee_id)}</td>
                        <td className="py-2 px-2 text-right text-emerald-600 font-medium">{minutesToH(r.credit_available_minutes)}</td>
                        <td className="py-2 px-2 text-right text-amber-700 font-medium">{minutesToH(r.debit_minutes)}</td>
                        <td className={`py-2 px-2 text-right font-bold ${r.balance_minutes >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                          {minutesToH(r.balance_minutes)}
                        </td>
                        <td className="py-2 px-2 text-right">{r.movement_count}</td>
                        <td className="py-2 px-2">{r.last_movement_date ? formatDateForTablePtBr(r.last_movement_date) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="glass-card rounded-[2.25rem] p-6">
            <h3 className="text-sm font-bold text-slate-700 dark:text-slate-200 mb-1">Movimentações do ledger</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
              Créditos consideram consumo em FIFO via campo <code className="text-[10px]">used_minutes</code>.
            </p>
            {hasLedgerInMonth ? (
              <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-800/50">
                      <th className="text-left py-2 px-2">Data</th>
                      {!filterUserId ? <th className="text-left py-2 px-2">Funcionário</th> : null}
                      <th className="text-left py-2 px-2">Tipo</th>
                      <th className="text-left py-2 px-2">Origem</th>
                      <th className="text-right py-2 px-2">Minutos</th>
                      <th className="text-right py-2 px-2">Utilizado</th>
                      <th className="text-left py-2 px-2">Expira</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ledgerRows.map((r) => (
                      <tr key={r.id} className="border-b border-slate-100 dark:border-slate-800">
                        <td className="py-2 px-2">{formatDateForTablePtBr(r.date)}</td>
                        {!filterUserId ? <td className="py-2 px-2">{employeeName(r.employee_id)}</td> : null}
                        <td className={`py-2 px-2 font-medium ${r.type === 'CREDIT' ? 'text-emerald-600' : 'text-amber-700'}`}>
                          {ledgerTypeLabel(r.type)}
                        </td>
                        <td className="py-2 px-2">{r.source || '—'}</td>
                        <td className="py-2 px-2 text-right">{minutesToH(r.minutes)}</td>
                        <td className="py-2 px-2 text-right">{minutesToH(r.used_minutes)}</td>
                        <td className="py-2 px-2">{r.expires_at ? formatDateForTablePtBr(r.expires_at.slice(0, 10)) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Nenhuma movimentação em <strong>{formatMonthYearPtBr(monthFilter)}</strong> para o filtro selecionado.
              </p>
            )}
          </div>

          {!hasLedgerInMonth && recentLedgerOutside.length > 0 && (
            <div className="glass-card rounded-[2.25rem] p-6">
              <h3 className="text-sm font-bold text-slate-700 dark:text-slate-200 mb-2">Histórico fora do mês</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
                Foram encontrados lançamentos em períodos diferentes de <strong>{formatMonthYearPtBr(monthFilter)}</strong>.
              </p>
              <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-800/50">
                      <th className="text-left py-2 px-2">Data</th>
                      {!filterUserId ? <th className="text-left py-2 px-2">Funcionário</th> : null}
                      <th className="text-left py-2 px-2">Tipo</th>
                      <th className="text-right py-2 px-2">Minutos</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentLedgerOutside.map((r) => (
                      <tr key={`outside-${r.id}`} className="border-b border-slate-100 dark:border-slate-800">
                        <td className="py-2 px-2">{formatDateForTablePtBr(r.date)}</td>
                        {!filterUserId ? <td className="py-2 px-2">{employeeName(r.employee_id)}</td> : null}
                        <td className="py-2 px-2">{ledgerTypeLabel(r.type)}</td>
                        <td className="py-2 px-2 text-right">{minutesToH(r.minutes)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default AdminBankHours;
