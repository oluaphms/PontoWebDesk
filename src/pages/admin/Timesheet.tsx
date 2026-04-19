import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { isSupabaseConfigured, supabase } from '../../services/supabaseClient';
import { buscarEspelhoAdmin, buscarFiltrosEspelhoAdmin } from '../../../services/api';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { useToast } from '../../components/ToastProvider';
import PageHeader from '../../components/PageHeader';
import { LoadingState, Button } from '../../../components/UI';
import { FileDown, FileSpreadsheet, Lock, Plus } from 'lucide-react';
import { AddTimeRecordModal } from '../../components/AddTimeRecordModal';
import { ManualRecordModal } from '../../components/ManualRecordModal';
import { EditTimeRecordModal } from '../../components/EditTimeRecordModal';
import { SkeletonFiltro, TimesheetTableSkeleton } from '../../components/TimesheetTableSkeleton';
import {
  buildDayMirrorSummary,
  DayMirror,
  isManualRecord,
  formatMinutes,
  getDayStatus,
} from '../../utils/timesheetMirror';
import { closeTimesheet, isTimesheetClosed } from '../../services/timeProcessingService';
import { invalidateAfterTimesheetMonthClose } from '../../services/queryCache';
import { enumerateLocalCalendarDays } from '../../utils/localDateTimeToIso';

/** Data local YYYY-MM-DD (evita UTC deslocar o “hoje” no max do input). */
function localDateKey(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

type AdminEmployee = { id: string; nome: string; department_id?: string; role?: string };

type TimeRecord = {
  id: string;
  user_id: string;
  created_at: string;
  type: 'entrada' | 'saida' | 'intervalo_saida' | 'intervalo_volta';
  manual_reason?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  is_manual?: boolean;
};

const AdminTimesheet: React.FC = () => {
  const { user, loading } = useCurrentUser();
  const toast = useToast();

  const [employees, setEmployees] = useState<AdminEmployee[]>([]);
  const [departments, setDepartments] = useState<{ id: string; name: string }[]>([]);
  const [records, setRecords] = useState<TimeRecord[]>([]);
  const [holidays, setHolidays] = useState<{ id: string; date: string; name: string }[]>([]);
  const [loadingEspelho, setLoadingEspelho] = useState(false);
  const [loadingFiltros, setLoadingFiltros] = useState(false);

  const [filterUserId, setFilterUserId] = useState('');
  const [filterDepartmentId, setFilterDepartmentId] = useState('');
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');
  const todayMax = useMemo(() => localDateKey(), []);

  const periodValid =
    Boolean(periodStart && periodEnd && periodStart <= periodEnd && periodEnd <= todayMax && periodStart <= todayMax);

  const companyId = user?.companyId || user?.company_id;

  const [closingMonth, setClosingMonth] = useState(() => {
    const n = new Date();
    return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}`;
  });
  const [closingLoading, setClosingLoading] = useState(false);

  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedManualRecord, setSelectedManualRecord] = useState<TimeRecord | null>(null);
  const [showManualModal, setShowManualModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [recordToEdit, setRecordToEdit] = useState<TimeRecord | null>(null);

  const holidayDates = useMemo(() => new Set(holidays.map((h) => h.date).filter(Boolean)), [holidays]);

  /** Catálogo (colaboradores + departamentos) — não depende do período; evita selects vazios. */
  const loadFiltrosEspelho = useCallback(async () => {
    if (!companyId || !isSupabaseConfigured()) return;
    setLoadingFiltros(true);
    try {
      const f = await buscarFiltrosEspelhoAdmin(companyId);
      setEmployees(f.employees);
      setDepartments(f.departments);
    } catch (e) {
      console.error(e);
      toast.addToast('error', 'Não foi possível carregar colaboradores e departamentos.');
    } finally {
      setLoadingFiltros(false);
    }
  }, [companyId, toast]);

  useEffect(() => {
    void loadFiltrosEspelho();
  }, [loadFiltrosEspelho]);

  const loadEspelho = useCallback(async () => {
    if (!companyId || !isSupabaseConfigured()) {
      setLoadingEspelho(false);
      return;
    }
    if (!periodValid) {
      setRecords([]);
      setHolidays([]);
      setLoadingEspelho(false);
      return;
    }
    setLoadingEspelho(true);
    try {
      const data = await buscarEspelhoAdmin(companyId, periodStart, periodEnd);
      setEmployees(data.employees ?? []);
      setDepartments(data.departments ?? []);
      setRecords((data.records ?? []) as TimeRecord[]);
      setHolidays(data.holidays ?? []);
    } catch (e) {
      console.error(e);
      toast.addToast('error', 'Não foi possível carregar o espelho de ponto.');
    } finally {
      setLoadingEspelho(false);
    }
  }, [companyId, periodStart, periodEnd, periodValid, toast]);

  useEffect(() => {
    void loadEspelho();
  }, [loadEspelho]);

  const filteredEmployees = useMemo(() => {
    return employees.filter((emp) => {
      if (filterDepartmentId && emp.department_id !== filterDepartmentId) return false;
      return true;
    });
  }, [employees, filterDepartmentId]);

  const displayRecords = useMemo(() => {
    if (!filterUserId) return [];
    return records.filter((r) => r.user_id === filterUserId);
  }, [records, filterUserId]);

  const empMirror = useMemo(() => {
    if (!periodValid) return new Map<string, DayMirror>();
    return buildDayMirrorSummary(displayRecords, periodStart, periodEnd);
  }, [displayRecords, periodStart, periodEnd, periodValid]);

  const periodDates = useMemo(() => {
    if (!periodValid) return [];
    return enumerateLocalCalendarDays(periodStart, periodEnd);
  }, [periodStart, periodEnd, periodValid]);

  const formatDateBR = (dateStr: string) => {
    const [y, m, day] = dateStr.split('-');
    return `${day}/${m}/${y}`;
  };

  const handleAddRecord = async (data: {
    user_id: string;
    created_at: string;
    type: string;
    manual_reason?: string;
    latitude?: number;
    longitude?: number;
  }) => {
    if (!companyId) return;
    try {
      const { error } = await supabase.from('time_records').insert({
        ...data,
        id: crypto.randomUUID(),
        company_id: companyId,
        is_manual: true,
        /** NOT NULL no Postgres — batida criada pelo RH/admin no espelho (igual RPC `insert_time_record_for_user` / firestoreService). */
        method: 'admin',
      });
      if (error) throw error;
      toast.addToast('success', 'Batida adicionada com sucesso.');
      setShowAddModal(false);
      await loadEspelho();
    } catch (err) {
      console.error(err);
      toast.addToast('error', 'Erro ao adicionar batida.');
    }
  };

  const handleExportCSV = () => {
    if (!filterUserId || !periodValid) return;
    const emp = employees.find((e) => e.id === filterUserId);
    const rows: string[] = [
      'Data,Colaborador,Entrada,Saída Intervalo,Volta Intervalo,Saída,Horas trabalhadas,Status',
    ];
    for (const date of periodDates) {
      const day = empMirror.get(date);
      if (!day) continue;
      const st = holidayDates.has(date)
        ? 'FERIADO'
        : getDayStatus(day).label || '';
      rows.push(
        [
          formatDateBR(date),
          emp?.nome || '',
          day.entradaInicio || '-',
          day.saidaIntervalo || '-',
          day.voltaIntervalo || '-',
          day.saidaFinal || '-',
          formatMinutes(day.workedMinutes),
          st,
        ].join(','),
      );
    }
    const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `espelho-${filterUserId}-${periodStart}-${periodEnd}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const handleExportExcel = () => {
    handleExportCSV();
    toast.addToast('info', 'Arquivo gerado no formato CSV (compatível com Excel).');
  };

  const handleExportPDF = () => {
    window.print();
  };

  const handleCloseMonth = async () => {
    if (!companyId || !filterUserId) {
      toast.addToast('error', 'Selecione um colaborador para fechar a folha.');
      return;
    }
    const [y, m] = closingMonth.split('-').map(Number);
    if (!y || !m) return;
    setClosingLoading(true);
    try {
      const already = await isTimesheetClosed(companyId, m, y);
      if (already) {
        toast.addToast('info', 'Este mês já consta como fechado.');
        return;
      }
      await closeTimesheet(companyId, m, y, filterUserId);
      invalidateAfterTimesheetMonthClose(companyId);
      toast.addToast('success', 'Folha fechada com sucesso.');
      await loadEspelho();
    } catch (e) {
      console.error(e);
      toast.addToast('error', 'Não foi possível fechar a folha.');
    } finally {
      setClosingLoading(false);
    }
  };

  const renderDayBadge = (day: DayMirror, dateStr: string) => {
    if (holidayDates.has(dateStr)) {
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold border bg-green-100 text-green-800 border-green-300 dark:bg-green-900/30 dark:text-green-300">
          FERIADO
        </span>
      );
    }
    const { label, color } = getDayStatus(day);
    if (!label) return null;
    const map: Record<string, string> = {
      green: 'bg-green-100 text-green-800 border-green-300 dark:bg-green-900/30 dark:text-green-300',
      red: 'bg-red-100 text-red-800 border-red-300 dark:bg-red-900/30 dark:text-red-300',
      orange: 'bg-orange-100 text-orange-800 border-orange-300',
      purple: 'bg-purple-100 text-purple-800 border-purple-300',
      indigo: 'bg-indigo-100 text-indigo-800 border-indigo-300',
      slate: 'bg-slate-100 text-slate-700 border-slate-300',
    };
    return (
      <span
        className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-bold border ${map[color] || map.red}`}
      >
        {label}
      </span>
    );
  };

  const renderTimeCell = (time: string | null, record?: TimeRecord) => {
    const isManual = record && isManualRecord(record);
    return (
      <span
        className={`inline-flex items-center gap-1 px-2 py-1 rounded text-sm font-medium cursor-pointer ${
          isManual
            ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 border border-blue-300 dark:border-blue-700'
            : 'text-slate-700 dark:text-slate-300'
        }`}
        onClick={() => {
          if (isManual && record) {
            setSelectedManualRecord(record);
            setShowManualModal(true);
          } else if (record) {
            setRecordToEdit(record);
            setShowEditModal(true);
          }
        }}
        title={isManual ? `Batida manual: ${record?.manual_reason || 'Sem motivo'}` : 'Clique para editar'}
      >
        {time || '—'}
        {isManual && <span className="text-blue-500 font-bold">*</span>}
      </span>
    );
  };

  if (loading) return <LoadingState message="Carregando..." />;
  if (!user) return <Navigate to="/" replace />;
  if (user.role !== 'admin' && user.role !== 'hr') {
    return <Navigate to="/dashboard" replace />;
  }

  const selectedEmployee = employees.find((e) => e.id === filterUserId);

  return (
    <div className="space-y-6 print:space-y-4">
      <PageHeader title="Espelho de Ponto" />

      {/* FILTROS — layout original (departamento → colaborador → período) */}
      <section className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white/80 dark:bg-slate-900/80 shadow-sm backdrop-blur-sm print:border print:shadow-none">
        <div className="px-4 pt-4 pb-2 border-b border-slate-100 dark:border-slate-800">
          <h2 className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Filtros</h2>
        </div>
        {loadingFiltros && employees.length === 0 ? (
          <SkeletonFiltro />
        ) : (
          <div className="p-4 flex flex-wrap gap-4 items-end">
            <div className="min-w-[200px] flex-1">
              <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Departamento</label>
              <select
                value={filterDepartmentId}
                onChange={(e) => {
                  setFilterDepartmentId(e.target.value);
                  setFilterUserId('');
                }}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm"
              >
                <option value="">Todos</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="min-w-[220px] flex-1">
              <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Colaborador</label>
              <select
                value={filterUserId}
                onChange={(e) => setFilterUserId(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm"
              >
                <option value="">Selecione o colaborador</option>
                {filteredEmployees.map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.nome}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Período (início)</label>
              <input
                type="date"
                value={periodStart}
                max={todayMax}
                onChange={(e) => setPeriodStart(e.target.value)}
                className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Período (fim)</label>
              <input
                type="date"
                value={periodEnd}
                max={todayMax}
                onChange={(e) => setPeriodEnd(e.target.value)}
                className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm"
              />
            </div>
            {!periodValid && (periodStart || periodEnd) && (
              <p className="w-full text-xs text-amber-700 dark:text-amber-300">
                Informe início e fim, com início ≤ fim, e datas não posteriores a hoje.
              </p>
            )}
            {!periodStart && !periodEnd && (
              <p className="w-full text-xs text-slate-500 dark:text-slate-400">
                Selecione o período para carregar os registros do espelho.
              </p>
            )}
          </div>
        )}
      </section>

      {/* EXPORTAR E BATIDAS */}
      <section className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white/80 dark:bg-slate-900/80 shadow-sm backdrop-blur-sm print:hidden">
        <div className="px-4 pt-4 pb-2 border-b border-slate-100 dark:border-slate-800">
          <h2 className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Exportar e batidas
          </h2>
        </div>
        <div className="p-4 flex flex-wrap gap-3 items-center">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="inline-flex items-center gap-2"
            disabled={!filterUserId || !periodValid || loadingEspelho}
            onClick={handleExportPDF}
          >
            <FileDown className="w-4 h-4" />
            Exportar PDF
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="inline-flex items-center gap-2"
            disabled={!filterUserId || !periodValid || loadingEspelho}
            onClick={handleExportExcel}
          >
            <FileSpreadsheet className="w-4 h-4" />
            Exportar Excel
          </Button>
          <Button
            type="button"
            size="sm"
            className="inline-flex items-center gap-2"
            onClick={() => setShowAddModal(true)}
          >
            <Plus className="w-4 h-4" />
            Adicionar batida
          </Button>
        </div>
      </section>

      {/* FECHAMENTO MENSAL */}
      <section className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white/80 dark:bg-slate-900/80 shadow-sm backdrop-blur-sm print:hidden">
        <div className="px-4 pt-4 pb-2 border-b border-slate-100 dark:border-slate-800">
          <h2 className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Fechamento mensal
          </h2>
        </div>
        <div className="p-4 flex flex-wrap gap-4 items-end">
          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Mês a fechar</label>
            <input
              type="month"
              value={closingMonth}
              onChange={(e) => setClosingMonth(e.target.value)}
              className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm"
            />
          </div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="inline-flex items-center gap-2"
            disabled={closingLoading || !filterUserId}
            onClick={() => void handleCloseMonth()}
          >
            <Lock className="w-4 h-4" />
            {closingLoading ? 'Fechando…' : 'Fechar folha'}
          </Button>
        </div>
      </section>

      {/* Legenda */}
      <div className="flex flex-wrap gap-4 text-sm text-slate-600 dark:text-slate-400 print:text-xs">
        <span className="inline-flex items-center gap-2">
          <span className="w-3 h-3 rounded-full bg-blue-500" />
          Batida manual (*)
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="w-3 h-3 rounded-full border border-slate-400" />
          Batida normal
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-green-100 text-green-800">FOLGA</span> /
          <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-green-100 text-green-800">FERIADO</span>
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-100 text-red-800">FALTA</span>
        </span>
      </div>

      {/* Tabela */}
      {!periodValid && !periodStart && !periodEnd ? (
        <div className="rounded-2xl border border-dashed border-slate-300 dark:border-slate-600 p-12 text-center text-slate-500 dark:text-slate-400">
          Selecione o período (início e fim) para visualizar o espelho de ponto.
        </div>
      ) : !periodValid ? (
        <div className="rounded-2xl border border-dashed border-amber-200 dark:border-amber-900/50 p-12 text-center text-amber-800 dark:text-amber-200 text-sm">
          Ajuste o período: início e fim obrigatórios, início ≤ fim, e sem datas futuras.
        </div>
      ) : !filterUserId ? (
        <div className="rounded-2xl border border-dashed border-slate-300 dark:border-slate-600 p-12 text-center text-slate-500 dark:text-slate-400">
          Selecione o colaborador
        </div>
      ) : loadingEspelho ? (
        <TimesheetTableSkeleton variant="admin" />
      ) : (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-sm overflow-hidden print:border print:shadow-none">
          <div className="px-4 py-3 bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-700">
            <h3 className="font-semibold text-slate-900 dark:text-white">{selectedEmployee?.nome || 'Colaborador'}</h3>
            <p className="text-sm text-slate-500">
              {departments.find((d) => d.id === selectedEmployee?.department_id)?.name || '—'} ·{' '}
              {formatDateBR(periodStart)} a {formatDateBR(periodEnd)}
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-800/50">
                <tr>
                  <th className="px-3 py-2 text-left font-medium text-slate-600 dark:text-slate-400">Data</th>
                  <th className="px-3 py-2 text-left font-medium text-slate-600 dark:text-slate-400">Status</th>
                  <th className="px-3 py-2 text-left font-medium text-slate-600 dark:text-slate-400">Entrada</th>
                  <th className="px-3 py-2 text-left font-medium text-slate-600 dark:text-slate-400">Saída int.</th>
                  <th className="px-3 py-2 text-left font-medium text-slate-600 dark:text-slate-400">Volta int.</th>
                  <th className="px-3 py-2 text-left font-medium text-slate-600 dark:text-slate-400">Saída</th>
                  <th className="px-3 py-2 text-left font-medium text-slate-600 dark:text-slate-400">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                {periodDates.map((date) => {
                  const day = empMirror.get(date);
                  if (!day) return null;
                  const fmt = (iso: string) =>
                    new Date(iso).toLocaleTimeString('pt-BR', {
                      hour: '2-digit',
                      minute: '2-digit',
                      hour12: false,
                    });
                  const pick = (t: string | null, typ: TimeRecord['type']) =>
                    day.records.find((r) => r.type === typ && fmt(r.created_at) === t);
                  const entradaRecord = day.entradaInicio
                    ? day.records.find((r) => r.type === 'entrada' && fmt(r.created_at) === day.entradaInicio)
                    : undefined;
                  const saidaIntRecord = pick(day.saidaIntervalo, 'intervalo_saida');
                  const voltaIntRecord = pick(day.voltaIntervalo, 'intervalo_volta');
                  const saidaRecord = pick(day.saidaFinal, 'saida');
                  return (
                    <tr key={date} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40">
                      <td className="px-3 py-2 text-slate-800 dark:text-slate-200 whitespace-nowrap">
                        {formatDateBR(date)}
                      </td>
                      <td className="px-3 py-2">{renderDayBadge(day, date)}</td>
                      <td className="px-3 py-2">{renderTimeCell(day.entradaInicio, entradaRecord)}</td>
                      <td className="px-3 py-2">{renderTimeCell(day.saidaIntervalo, saidaIntRecord)}</td>
                      <td className="px-3 py-2">{renderTimeCell(day.voltaIntervalo, voltaIntRecord)}</td>
                      <td className="px-3 py-2">{renderTimeCell(day.saidaFinal, saidaRecord)}</td>
                      <td className="px-3 py-2 font-medium text-slate-700 dark:text-slate-300">
                        {day.workedMinutes > 0 ? formatMinutes(day.workedMinutes) : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <AddTimeRecordModal
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        onSubmit={handleAddRecord}
        employees={filteredEmployees}
        companyId={companyId}
      />
      <ManualRecordModal
        isOpen={showManualModal}
        onClose={() => {
          setShowManualModal(false);
          setSelectedManualRecord(null);
        }}
        reason={selectedManualRecord?.manual_reason || ''}
        timestamp={selectedManualRecord?.created_at}
        type={selectedManualRecord?.type}
      />
      <EditTimeRecordModal
        isOpen={showEditModal}
        onClose={() => {
          setShowEditModal(false);
          setRecordToEdit(null);
        }}
        record={recordToEdit}
        onSave={() => {
          setShowEditModal(false);
          setRecordToEdit(null);
          void loadEspelho();
        }}
      />
    </div>
  );
};

export default AdminTimesheet;
