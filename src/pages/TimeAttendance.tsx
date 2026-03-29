import React, { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { CalendarClock, CheckCircle2, Download, Edit3, Plus } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import DataTable from '../components/DataTable';
import ModalForm from '../components/ModalForm';
import { Button, LoadingState, EmptyState } from '../../components/UI';
import { useCurrentUser } from '../hooks/useCurrentUser';
import { db, isSupabaseConfigured } from '../services/supabaseClient';

interface TimeLogRow {
  id: string;
  employee_id: string;
  employee_name?: string;
  clock_in: string | null;
  clock_out: string | null;
  break_time: number;
  total_hours: number;
  date: string;
}

interface EmployeeRow {
  id: string;
  nome: string;
}

interface TimeLogFormState {
  id?: string;
  employeeId: string;
  date: string;
  clockIn: string;
  clockOut: string;
  breakMinutes: string;
}

const TimeAttendancePage: React.FC = () => {
  const { user, loading } = useCurrentUser();
  const [logs, setLogs] = useState<TimeLogRow[]>([]);
  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [isLoadingData, setIsLoadingData] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filterEmployeeId, setFilterEmployeeId] = useState('');
  const [filterDate, setFilterDate] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<TimeLogFormState>({
    employeeId: '',
    date: new Date().toISOString().slice(0, 10),
    clockIn: '',
    clockOut: '',
    breakMinutes: '0',
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user || !isSupabaseConfigured) return;

    const load = async () => {
      setIsLoadingData(true);
      setError(null);
      try {
        const [logRows, employeeRows] = await Promise.all([
          db.select('time_logs', [{ column: 'company_id', operator: 'eq', value: user.companyId }]) as Promise<any[]>,
          db.select('users', [{ column: 'company_id', operator: 'eq', value: user.companyId }]) as Promise<any[]>,
        ]);

        const empList: EmployeeRow[] =
          (employeeRows ?? []).map((e: any) => ({
            id: e.id,
            nome: e.nome ?? e.email ?? 'Sem nome',
          })) ?? [];
        setEmployees(empList);

        const mapped: TimeLogRow[] =
          (logRows ?? []).map((l: any) => {
            const emp = empList.find((e) => e.id === l.employee_id);
            return {
              id: l.id,
              employee_id: l.employee_id,
              employee_name: emp?.nome,
              clock_in: l.clock_in,
              clock_out: l.clock_out,
              break_time: l.break_time ?? 0,
              total_hours: l.total_hours ?? 0,
              date: l.date,
            };
          }) ?? [];

        setLogs(mapped);
      } catch (e) {
        console.error('Erro ao carregar time_logs:', e);
        setError('Não foi possível carregar os registros de jornada.');
      } finally {
        setIsLoadingData(false);
      }
    };

    load();
  }, [user]);

  const filteredLogs = logs.filter((l) => {
    if (filterEmployeeId && l.employee_id !== filterEmployeeId) return false;
    if (filterDate && l.date !== filterDate) return false;
    return true;
  });

  const getStatus = (log: TimeLogRow): 'Working' | 'On Break' | 'Offline' => {
    if (!log.clock_in) return 'Offline';
    if (log.clock_in && !log.clock_out) return 'Working';
    return 'Offline';
  };

  const openNewEntry = () => {
    setForm({
      employeeId: '',
      date: new Date().toISOString().slice(0, 10),
      clockIn: '',
      clockOut: '',
      breakMinutes: '0',
    });
    setModalOpen(true);
  };

  const openEditEntry = (log: TimeLogRow) => {
    setForm({
      id: log.id,
      employeeId: log.employee_id,
      date: log.date,
      clockIn: log.clock_in ? log.clock_in.slice(11, 16) : '',
      clockOut: log.clock_out ? log.clock_out.slice(11, 16) : '',
      breakMinutes: String(log.break_time ?? 0),
    });
    setModalOpen(true);
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isSupabaseConfigured || !user) return;
    if (!form.employeeId || !form.date || !form.clockIn || !form.clockOut) return;

    setSaving(true);
    try {
      const clockInIso = `${form.date}T${form.clockIn}:00`;
      const clockOutIso = `${form.date}T${form.clockOut}:00`;
      const diffMs = new Date(clockOutIso).getTime() - new Date(clockInIso).getTime();
      const totalHours = Math.max(diffMs / (1000 * 60 * 60) - Number(form.breakMinutes || '0') / 60, 0);

      const payload = {
        employee_id: form.employeeId,
        company_id: user.companyId,
        clock_in: clockInIso,
        clock_out: clockOutIso,
        break_time: Number(form.breakMinutes || '0'),
        total_hours: Number(totalHours.toFixed(2)),
        date: form.date,
      };

      if (form.id) {
        await (db as { update: (table: string, id: string, data: any) => Promise<any> }).update(
          'time_logs',
          form.id,
          payload,
        );
        setLogs((prev) =>
          prev.map((l) => (l.id === form.id ? { ...l, ...payload, employee_id: payload.employee_id } : l)),
        );
      } else {
        const id = crypto.randomUUID();
        await (db as { insert: (table: string, data: any) => Promise<any> }).insert('time_logs', {
          id,
          ...payload,
        });
        const emp = employees.find((e) => e.id === payload.employee_id);
        setLogs((prev) => [
          ...prev,
          {
            id,
            employee_id: payload.employee_id,
            employee_name: emp?.nome,
            clock_in: payload.clock_in,
            clock_out: payload.clock_out,
            break_time: payload.break_time,
            total_hours: payload.total_hours,
            date: payload.date,
          },
        ]);
      }
      setModalOpen(false);
    } catch (err) {
      console.error('Erro ao salvar time_log:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleApproveHours = () => {
    console.log('Approve hours for current filter selection');
  };

  const handleExport = () => {
    const rows = filteredLogs;
    if (!rows.length) return;
    const header = ['date', 'employee', 'clock_in', 'clock_out', 'break_minutes', 'total_hours', 'status'];
    const csvRows = rows.map((l) => [
      l.date,
      l.employee_name ?? l.employee_id,
      l.clock_in ?? '',
      l.clock_out ?? '',
      l.break_time ?? 0,
      l.total_hours ?? 0,
      getStatus(l),
    ]);
    const csvContent = [header, ...csvRows]
      .map((r) => r.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `time_attendance_${new Date().toISOString().slice(0, 10)}.csv`;
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
        title="Jornada de Trabalho"
        subtitle="Controle de registros de entrada, saída e intervalos"
        icon={<CalendarClock className="w-5 h-5" />}
      />

      <section className="glass-card rounded-[2.25rem] p-6 space-y-4">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between md:flex-wrap">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 min-w-0 flex-1">
            <div className="min-w-0">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Colaborador</label>
              <select
                className="mt-1 w-full px-4 py-2.5 rounded-2xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm"
                value={filterEmployeeId}
                onChange={(e) => setFilterEmployeeId(e.target.value)}
              >
                <option value="">Todos</option>
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.nome}
                  </option>
                ))}
              </select>
            </div>
            <div className="min-w-0">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Data</label>
              <input
                type="date"
                className="mt-1 w-full px-4 py-2.5 rounded-2xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm"
                value={filterDate}
                onChange={(e) => setFilterDate(e.target.value)}
              />
            </div>
            <div className="flex items-end sm:col-span-2 md:col-span-1">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-full sm:w-auto"
                onClick={() => {
                  setFilterEmployeeId('');
                  setFilterDate('');
                }}
              >
                Limpar filtros
              </Button>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 flex-shrink-0">
            <Button type="button" size="sm" variant="outline" onClick={handleExport} className="w-full sm:w-auto">
              <Download className="w-4 h-4" />
              Exportar
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={handleApproveHours} className="w-full sm:w-auto">
              <CheckCircle2 className="w-4 h-4" />
              Aprovar horas
            </Button>
            <Button type="button" size="sm" onClick={openNewEntry} className="w-full sm:w-auto">
              <Plus className="w-4 h-4" />
              Lançamento manual
            </Button>
          </div>
        </div>
      </section>

      <section className="space-y-4 min-w-0 overflow-hidden">
        <h2 className="text-sm font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest">
          Registros de jornada
        </h2>
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        {isLoadingData ? (
          <LoadingState message="Carregando registros..." />
        ) : filteredLogs.length === 0 ? (
          <EmptyState
            title="Nenhum registro"
            message="Nenhum registro de jornada encontrado para os filtros selecionados."
          />
        ) : (
          <div className="overflow-x-auto max-w-full">
            <DataTable<TimeLogRow>
            columns={[
              {
                key: 'employee_name',
                header: 'Colaborador',
                render: (row) => row.employee_name ?? row.employee_id,
              },
              {
                key: 'clock_in',
                header: 'Entrada',
                render: (row) =>
                  row.clock_in
                    ? new Date(row.clock_in).toLocaleTimeString('pt-BR', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })
                    : '--:--',
              },
              {
                key: 'clock_out',
                header: 'Saída',
                render: (row) =>
                  row.clock_out
                    ? new Date(row.clock_out).toLocaleTimeString('pt-BR', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })
                    : '--:--',
              },
              {
                key: 'break_time',
                header: 'Intervalo',
                render: (row) => `${row.break_time ?? 0} min`,
              },
              {
                key: 'total_hours',
                header: 'Total',
                render: (row) => `${(row.total_hours ?? 0).toFixed(2)} h`,
              },
              {
                key: 'status',
                header: 'Status',
                render: (row) => {
                  const status = getStatus(row);
                  if (status === 'Working') {
                    return <span className="text-emerald-600 text-xs font-semibold">Trabalhando</span>;
                  }
                  if (status === 'On Break') {
                    return <span className="text-amber-600 text-xs font-semibold">Em intervalo</span>;
                  }
                  return <span className="text-slate-500 text-xs font-semibold">Offline</span>;
                },
              },
              {
                key: 'actions',
                header: '',
                render: (row) => (
                  <div className="flex justify-end gap-2">
                    <Button size="xs" variant="outline" onClick={() => openEditEntry(row)}>
                      <Edit3 className="w-3 h-3" />
                      Editar
                    </Button>
                  </div>
                ),
              },
            ]}
            data={filteredLogs}
          />
          </div>
        )}
      </section>

      <ModalForm
        title={form.id ? 'Editar lançamento' : 'Novo lançamento manual'}
        description="Ajuste manualmente os registros de jornada deste colaborador."
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        onSubmit={handleFormSubmit}
        footer={
          <div className="flex justify-end gap-3">
            <Button type="button" variant="outline" size="sm" onClick={() => setModalOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" size="sm" loading={saving}>
              Salvar
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
