import { observabilityConsole } from '../shared/logger/observabilityConsole';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { CalendarClock, CheckCircle2, Download, ExternalLink, Plus } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import DataTable from '../components/DataTable';
import ModalForm from '../components/ModalForm';
import { Button, LoadingState, EmptyState } from '../../components/UI';
import { useCurrentUser } from '../hooks/useCurrentUser';
import { db } from '../services/supabaseClient';
import { resolveTenantId } from '../services/tenantScope';
import { extractLocalCalendarDateFromIso } from '../utils/calendarUtils';
import {
  getTimeAttendanceData,
  getTimeAttendanceStatusDetail,
  getTimeAttendanceStatusPresentation,
  submitManualAttendancePunches,
  type TimeAttendanceRow,
} from '../services/timeAttendanceData';

interface EmployeeRow {
  id: string;
  nome: string;
}

interface TimeAttendanceFormState {
  employeeId: string;
  date: string;
  clockIn: string;
  clockOut: string;
  breakMinutes: string;
}

function civilMonthBounds(d = new Date()): { start: string; end: string } {
  const y = d.getFullYear();
  const m = d.getMonth();
  const last = new Date(y, m + 1, 0);
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    start: `${y}-${pad(m + 1)}-01`,
    end: `${y}-${pad(m + 1)}-${pad(last.getDate())}`,
  };
}

const TimeAttendancePage: React.FC = () => {
  const navigate = useNavigate();
  const { user, loading } = useCurrentUser();
  const initialMonth = useMemo(() => civilMonthBounds(), []);
  const [rows, setRows] = useState<TimeAttendanceRow[]>([]);
  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [isLoadingData, setIsLoadingData] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filterEmployeeId, setFilterEmployeeId] = useState('');
  const [filterPeriodStart, setFilterPeriodStart] = useState(initialMonth.start);
  const [filterPeriodEnd, setFilterPeriodEnd] = useState(initialMonth.end);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<TimeAttendanceFormState>({
    employeeId: '',
    date: extractLocalCalendarDateFromIso(new Date().toISOString()),
    clockIn: '',
    clockOut: '',
    breakMinutes: '0',
  });
  const [saving, setSaving] = useState(false);

  const effectiveCompanyId = useMemo(() => resolveTenantId(user), [user]);

  const loadData = useCallback(async () => {
    if (!user || !effectiveCompanyId) return;

    setIsLoadingData(true);
    setError(null);
    try {
      const start = filterPeriodStart.slice(0, 10);
      const end = filterPeriodEnd.slice(0, 10);
      if (start > end) {
        setError('Período inválido: a data inicial não pode ser posterior à final.');
        setRows([]);
        return;
      }

      const [employeeByCompanyRows, employeeByTenantRows] = await Promise.all([
        db.select('users', [{ column: 'company_id', operator: 'eq', value: effectiveCompanyId }]) as Promise<any[]>,
        (
          db.select('users', [{ column: 'tenant_id', operator: 'eq', value: effectiveCompanyId }]) as Promise<any[]>
        ).catch(() => [] as any[]),
      ]);

      const employeeRows = [...(employeeByCompanyRows ?? []), ...(employeeByTenantRows ?? [])];
      const uniqueUsers = Array.from(new Map(employeeRows.map((e: any) => [e.id, e])).values());

      const displayName = (e: any) => (e.nome || e.name || e.full_name || e.email || 'Sem nome') as string;

      const empList: EmployeeRow[] = uniqueUsers
        .filter((e: any) => (e.role || '').toLowerCase() !== 'admin')
        .map((e: any) => ({
          id: e.id,
          nome: displayName(e),
        }));
      empList.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
      setEmployees(empList);

      const nameMap = new Map(empList.map((e) => [e.id, e.nome]));
      const { rows: dataRows } = await getTimeAttendanceData(effectiveCompanyId, start, end, nameMap);
      setRows(dataRows);
    } catch (e) {
      observabilityConsole.error('Erro ao carregar dados de jornada:', e);
      setError('Não foi possível carregar os registros de jornada.');
    } finally {
      setIsLoadingData(false);
    }
  }, [user, effectiveCompanyId, filterPeriodStart, filterPeriodEnd]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  /** Atualiza a lista quando o auto-fix ainda está em voo — reflete `timesheets_daily` assim que o motor persiste. */
  useEffect(() => {
    if (!effectiveCompanyId) return;
    const pendingInFlight = rows.some((r) => !r.has_timesheet_daily && r.auto_recalc_in_flight);
    if (!pendingInFlight) return;
    const t = window.setTimeout(() => {
      void loadData();
    }, 4000);
    return () => window.clearTimeout(t);
  }, [rows, effectiveCompanyId, loadData]);

  const filteredRows = rows.filter((r) => {
    if (filterEmployeeId && r.employee_id !== filterEmployeeId) return false;
    return true;
  });

  const openNewEntry = () => {
    setForm({
      employeeId: '',
      date: extractLocalCalendarDateFromIso(new Date().toISOString()),
      clockIn: '',
      clockOut: '',
      breakMinutes: '0',
    });
    setModalOpen(true);
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !effectiveCompanyId) return;
    if (!form.employeeId || !form.date || !form.clockIn || !form.clockOut) return;

    setSaving(true);
    try {
      await submitManualAttendancePunches({
        companyId: effectiveCompanyId,
        userId: form.employeeId,
        dateYmd: form.date,
        clockInHHmm: form.clockIn,
        clockOutHHmm: form.clockOut,
        breakMinutes: Number(form.breakMinutes || '0'),
      });
      setError(null);
      setModalOpen(false);
      await loadData();
    } catch (err) {
      observabilityConsole.error('Erro ao salvar lançamento manual:', err);
      setError(err instanceof Error ? err.message : 'Falha ao gravar batidas ou recalcular o dia.');
    } finally {
      setSaving(false);
    }
  };

  const handleApproveHours = () => {
    observabilityConsole.log('Approve hours for current filter selection');
  };

  const handleExport = () => {
    const list = filteredRows;
    if (!list.length) return;
    const header = [
      'date',
      'employee',
      'entrada_hhmm',
      'saida_hhmm',
      'intervalo_min',
      'total_horas_motor',
      'rep_pendente_qtd',
      'status_processamento',
      'status_detail',
    ];
    const csvRows = list.map((r) => [
      r.date,
      r.employee_name ?? r.employee_id,
      r.clock_in ?? '',
      r.clock_out ?? '',
      r.break_minutes ?? 0,
      r.total_hours_motor != null ? Number(r.total_hours_motor.toFixed(2)) : '',
      r.pending_rep_punch_count ?? 0,
      getTimeAttendanceStatusPresentation(r).label,
      getTimeAttendanceStatusDetail(r),
    ]);
    const csvContent = [header, ...csvRows]
      .map((row) => row.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `time_attendance_${extractLocalCalendarDateFromIso(new Date().toISOString())}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return <LoadingState message="Carregando jornada de trabalho..." />;
  }
  if (!user) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="space-y-8">
      <PageHeader
        helpSlug="jornada"
        title="Jornada de Trabalho"
        subtitle="Controle de registros de entrada, saída e intervalos"
        icon={<CalendarClock className="w-5 h-5" />}
      />

      <section className="glass-card rounded-[2.25rem] p-4 sm:p-6 space-y-4">
        {!effectiveCompanyId && (
          <p className="text-sm text-amber-800 dark:text-amber-200 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-xl px-4 py-3">
            Empresa não identificada no perfil. Atualize a página, faça login novamente ou peça ao administrador para vincular sua conta (company_id / tenant).
          </p>
        )}
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between lg:gap-8">
          <div className="grid w-full min-w-0 flex-1 grid-cols-1 gap-x-6 gap-y-5 md:grid-cols-2 md:gap-x-8 xl:grid-cols-5 xl:gap-x-6">
            <div className="min-w-0 w-full max-w-full overflow-hidden">
              <label
                htmlFor="time-attendance-filter-employee"
                className="block text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1.5"
              >
                Colaborador
              </label>
              <select
                id="time-attendance-filter-employee"
                className="box-border w-full max-w-full min-h-11 min-w-0 px-4 py-2.5 rounded-2xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-slate-100"
                value={filterEmployeeId}
                onChange={(e) => setFilterEmployeeId(e.target.value)}
                disabled={!effectiveCompanyId}
              >
                <option value="">Todos</option>
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.nome}
                  </option>
                ))}
              </select>
            </div>
            <div className="min-w-0 w-full max-w-full overflow-hidden">
              <label
                htmlFor="time-attendance-period-start"
                className="block text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1.5"
              >
                Período — início
              </label>
              <input
                id="time-attendance-period-start"
                type="date"
                className="box-border w-full max-w-full min-h-11 min-w-0 px-4 py-2.5 rounded-2xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-slate-100 [color-scheme:light] dark:[color-scheme:dark]"
                value={filterPeriodStart}
                onChange={(e) => setFilterPeriodStart(e.target.value)}
              />
            </div>
            <div className="min-w-0 w-full max-w-full overflow-hidden">
              <label
                htmlFor="time-attendance-period-end"
                className="block text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1.5"
              >
                Período — fim
              </label>
              <input
                id="time-attendance-period-end"
                type="date"
                className="box-border w-full max-w-full min-h-11 min-w-0 px-4 py-2.5 rounded-2xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-slate-100 [color-scheme:light] dark:[color-scheme:dark]"
                value={filterPeriodEnd}
                onChange={(e) => setFilterPeriodEnd(e.target.value)}
              />
            </div>
            <div className="flex min-w-0 items-end xl:col-span-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-full min-h-11 sm:w-auto"
                onClick={() => {
                  const b = civilMonthBounds();
                  setFilterEmployeeId('');
                  setFilterPeriodStart(b.start);
                  setFilterPeriodEnd(b.end);
                }}
              >
                Limpar filtros
              </Button>
            </div>
          </div>
          <div className="flex flex-col sm:flex-row flex-wrap gap-2 w-full lg:w-auto lg:max-w-md lg:justify-end flex-shrink-0">
            <Button type="button" size="sm" variant="outline" onClick={handleExport} className="w-full min-h-11 sm:w-auto justify-center">
              <Download className="w-4 h-4" />
              Exportar
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={handleApproveHours} className="w-full min-h-11 sm:w-auto justify-center">
              <CheckCircle2 className="w-4 h-4" />
              Aprovar horas
            </Button>
            <Button type="button" size="sm" onClick={openNewEntry} className="w-full min-h-11 sm:w-auto justify-center" disabled={!effectiveCompanyId}>
              <Plus className="w-4 h-4" />
              Lançamento manual
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="w-full min-h-11 sm:w-auto justify-center"
              onClick={() => navigate('/admin/timesheet')}
            >
              <ExternalLink className="w-4 h-4" />
              Espelho de ponto
            </Button>
          </div>
        </div>
      </section>

      <section className="space-y-4 min-w-0 overflow-hidden">
        <h2 className="text-sm font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest">
          Registros de jornada
        </h2>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Totais de horas exibidos são os calculados pelo motor (`timesheets_daily`). Horários de entrada/saída refletem as batidas em `time_records`. A coluna «REP (pend.)» mostra apenas evidência em `rep_punch_logs` ainda sem `time_record` — não entra no motor nem nas horas.
        </p>
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        {isLoadingData ? (
          <LoadingState message="Carregando registros..." />
        ) : filteredRows.length === 0 ? (
          <EmptyState
            title="Nenhum registro"
            message="Nenhum registro de jornada encontrado para o período e filtros selecionados."
          />
        ) : (
          <div className="overflow-x-auto max-w-full">
            <DataTable<TimeAttendanceRow>
              columns={[
                {
                  key: 'date',
                  header: 'Data',
                  render: (row) => row.date,
                },
                {
                  key: 'employee_name',
                  header: 'Colaborador',
                  render: (row) => row.employee_name ?? row.employee_id,
                },
                {
                  key: 'clock_in',
                  header: 'Entrada',
                  render: (row) => {
                    const batidasMsg = 'Batidas não localizadas (verifique sincronização)';
                    if (row.status_label === 'inconsistent_data') return batidasMsg;
                    if (row.total_hours_motor != null && row.total_hours_motor > 0 && !row.clock_in && !row.clock_out) {
                      return batidasMsg;
                    }
                    return row.clock_in ?? '—';
                  },
                },
                {
                  key: 'clock_out',
                  header: 'Saída',
                  render: (row) => {
                    const batidasMsg = 'Batidas não localizadas (verifique sincronização)';
                    if (row.status_label === 'inconsistent_data') return batidasMsg;
                    if (row.total_hours_motor != null && row.total_hours_motor > 0 && !row.clock_in && !row.clock_out) {
                      return batidasMsg;
                    }
                    return row.clock_out ?? '—';
                  },
                },
                {
                  key: 'break_minutes',
                  header: 'Intervalo',
                  render: (row) => `${row.break_minutes ?? 0} min`,
                },
                {
                  key: 'total_hours_motor',
                  header: 'Total (motor)',
                  render: (row) =>
                    row.total_hours_motor != null ? `${row.total_hours_motor.toFixed(2)} h` : '—',
                },
                {
                  key: 'rep_pending',
                  header: 'REP (pend.)',
                  render: (row) => {
                    const n = row.pending_rep_punch_count ?? 0;
                    if (!row.has_pending_rep_punches || n <= 0) return '—';
                    return (
                      <span
                        className="text-amber-800 dark:text-amber-200 font-medium"
                        title="Batidas no REP com colaborador identificado, ainda sem linha no espelho — não somam ao total do motor."
                      >
                        {n} batida(s)
                      </span>
                    );
                  },
                },
                {
                  key: 'status',
                  header: 'Status',
                  render: (row) => {
                    const st = getTimeAttendanceStatusPresentation(row);
                    return (
                      <span
                        className={`text-xs font-semibold ${st.badgeClassName} ${st.tooltip ? 'cursor-help border-b border-dotted border-current/40' : ''}`}
                        title={st.tooltip}
                      >
                        {st.label}
                      </span>
                    );
                  },
                },
              ]}
              data={filteredRows}
            />
          </div>
        )}
      </section>

      <ModalForm
        title="Novo lançamento manual"
        description="Serão criadas batidas em sequência (entrada, intervalo se houver, saída) em time_records e em seguida o dia será recalculado pelo motor."
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        onSubmit={handleFormSubmit}
        footer={
          <div className="flex justify-end gap-3">
            <Button type="button" variant="outline" size="sm" onClick={() => setModalOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" size="sm" loading={saving}>
              Salvar e recalcular
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Colaborador</label>
            <select
              className="mt-1 w-full px-4 py-2.5 rounded-2xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm"
              value={form.employeeId}
              onChange={(e) => setForm((f) => ({ ...f, employeeId: e.target.value }))}
              required
            >
              <option value="">Selecione</option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.nome}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Data</label>
              <input
                type="date"
                className="mt-1 w-full px-4 py-2.5 rounded-2xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm"
                value={form.date}
                onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
                required
              />
            </div>
            <div>
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Entrada</label>
              <input
                type="time"
                className="mt-1 w-full px-4 py-2.5 rounded-2xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm"
                value={form.clockIn}
                onChange={(e) => setForm((f) => ({ ...f, clockIn: e.target.value }))}
                required
              />
            </div>
            <div>
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Saída</label>
              <input
                type="time"
                className="mt-1 w-full px-4 py-2.5 rounded-2xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm"
                value={form.clockOut}
                onChange={(e) => setForm((f) => ({ ...f, clockOut: e.target.value }))}
                required
              />
            </div>
          </div>
          <div>
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Intervalo (minutos)</label>
            <input
              type="number"
              min={0}
              className="mt-1 w-full px-4 py-2.5 rounded-2xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm"
              value={form.breakMinutes}
              onChange={(e) => setForm((f) => ({ ...f, breakMinutes: e.target.value }))}
            />
          </div>
        </div>
      </ModalForm>
    </div>
  );
};

export default TimeAttendancePage;
