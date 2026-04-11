import React, { useEffect, useState, useMemo } from 'react';
import { Navigate } from 'react-router-dom';
import { db, isSupabaseConfigured, supabase } from '../../services/supabaseClient';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { useToast } from '../../components/ToastProvider';
import PageHeader from '../../components/PageHeader';
import { LoadingState, Button } from '../../../components/UI';
import { FileDown, FileSpreadsheet, Lock, Plus } from 'lucide-react';
import { closeTimesheet } from '../../services/timeProcessingService';
import { buildDayMirrorSummary } from '../../utils/timesheetMirror';
import { extractLatLng, reverseGeocode } from '../../utils/reverseGeocode';
import { ExpandableStreetCell, ExpandableTextCell } from '../../components/ClickableFullContent';
import { AddTimeRecordModal } from '../../components/AddTimeRecordModal';
import { ManualRecordModal } from '../../components/ManualRecordModal';
import { LoggingService } from '../../../services/loggingService';
import { LogSeverity } from '../../../types';

type DaySummary = {
  date: string;
  entradaInicio: string;
  saidaIntervalo: string;
  voltaIntervalo: string;
  saidaFinal: string;
  workedHours: string;
  status: string;
  locationCoords?: { lat: number; lng: number };
  isDayOff?: boolean;
};

type TimesheetRow = {
  userId: string;
  userName: string;
  departmentName?: string;
  byDate: Map<string, DaySummary>;
  dates: string[];
};

/** Partículas comuns entre prenome e sobrenome (evita “Maria de” como nome). */
const NAME_PARTICLES = new Set([
  'de', 'da', 'do', 'das', 'dos', 'e', 'y', 'del', 'la', 'los', 'du', 'van', 'von',
]);

function normalizeParticle(w: string): string {
  return w
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
}

/**
 * Primeiro nome para a coluna, incluindo nome composto (ex.: Paulo Henrique Silva → Paulo Henrique).
 * - 2 palavras: mostra as duas (Paulo Henrique ou Nome Sobrenome curto).
 * - 3+ palavras: duas primeiras, exceto se a 2ª for partícula (Maria de Souza → Maria).
 */
function displayGivenNameForColumn(fullName: string): string {
  const t = fullName.trim();
  if (!t) return '—';
  const parts = t.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return `${parts[0]} ${parts[1]}`;
  if (NAME_PARTICLES.has(normalizeParticle(parts[1]))) {
    return parts[0];
  }
  return `${parts[0]} ${parts[1]}`;
}

/** Coordenadas da última batida do dia que tenha GPS (ordem por horário). */
function lastPunchLocationCoords(dayRecs: any[]): { lat: number; lng: number } | undefined {
  const sorted = [...dayRecs].sort(
    (a, b) => new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime(),
  );
  for (let i = sorted.length - 1; i >= 0; i--) {
    const ll = extractLatLng(sorted[i]);
    if (ll) return ll;
  }
  return undefined;
}

/** Verifica se uma data é folga para um funcionário */
function isDayOffForEmployee(date: string, employeeId: string, shiftSchedules: any[]): boolean {
  try {
    const dateObj = new Date(date);
    const dayOfWeek = dateObj.getDay(); // 0 = Sunday, 1 = Monday, etc.
    
    const schedule = shiftSchedules.find(
      (s: any) => s.employee_id === employeeId && s.day_of_week === dayOfWeek
    );
    
    return schedule?.is_day_off === true;
  } catch {
    return false;
  }
}

const AdminTimesheet: React.FC = () => {
  const { user, loading } = useCurrentUser();
  const toast = useToast();
  const [employees, setEmployees] = useState<{ id: string; nome: string; department_id?: string }[]>([]);
  const [departments, setDepartments] = useState<{ id: string; name: string }[]>([]);
  const [records, setRecords] = useState<any[]>([]);
  const [shiftSchedules, setShiftSchedules] = useState<any[]>([]);
  const [filterUserId, setFilterUserId] = useState<string>('');
  const [filterDept, setFilterDept] = useState<string>('');
  const [periodStart, setPeriodStart] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10));
  const [periodEnd, setPeriodEnd] = useState(() => new Date().toISOString().slice(0, 10));
  const [loadingData, setLoadingData] = useState(true);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [closeMonth, setCloseMonth] = useState(() => {
    const n = new Date();
    return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}`;
  });
  const [closing, setClosing] = useState(false);
  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({});
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [selectedManualRecord, setSelectedManualRecord] = useState<{ reason?: string; timestamp?: string; type?: string } | null>(null);

  const toggleExpandedRow = (key: string) => {
    setExpandedRows((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  useEffect(() => {
    if (!user?.companyId || !isSupabaseConfigured) return;
    const load = async () => {
      setLoadingData(true);
      try {
        // Calcular data de 30 dias atrás para limitar registros
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        const dateFilter = thirtyDaysAgo.toISOString().slice(0, 10);

        const [usersRows, recordsRows, departmentsRows, shiftsRows] = await Promise.all([
          db.select('users', [{ column: 'company_id', operator: 'eq', value: user.companyId }]) as Promise<any[]>,
          db.select('time_records', [
            { column: 'company_id', operator: 'eq', value: user.companyId },
            { column: 'created_at', operator: 'gte', value: dateFilter }
          ], { column: 'created_at', ascending: false }, 500) as Promise<any[]>,
          db.select('departments', [{ column: 'company_id', operator: 'eq', value: user.companyId }]) as Promise<any[]>,
          db.select('employee_shift_schedule', [{ column: 'company_id', operator: 'eq', value: user.companyId }]) as Promise<any[]>,
        ]);
        setEmployees((usersRows ?? []).map((u: any) => ({ id: u.id, nome: u.nome || u.email, department_id: u.department_id })));
        setRecords(recordsRows ?? []);
        setDepartments((departmentsRows ?? []).map((d: any) => ({ id: d.id, name: d.name })));
        setShiftSchedules(shiftsRows ?? []);
      } catch (e) {
        console.error(e);
      } finally {
        setLoadingData(false);
      }
    };
    load();
  }, [user?.companyId]);

  const filteredRecords = useMemo(() => {
    let list = records;
    if (filterUserId) list = list.filter((r: any) => r.user_id === filterUserId);
    if (filterDept) list = list.filter((r: any) => {
      const emp = employees.find((e) => e.id === r.user_id);
      return emp?.department_id === filterDept;
    });
    if (periodStart) list = list.filter((r: any) => (r.created_at || '').slice(0, 10) >= periodStart);
    if (periodEnd) list = list.filter((r: any) => (r.created_at || '').slice(0, 10) <= periodEnd);
    return list;
  }, [records, filterUserId, filterDept, periodStart, periodEnd, employees]);

  const buildRows = useMemo((): TimesheetRow[] => {
    const byUser = new Map<string, { userName: string; departmentId?: string; recs: any[] }>();
    const userNames = new Map<string, string>(employees.map((e) => [e.id, e.nome]));
    filteredRecords.forEach((r: any) => {
      const uid = r.user_id;
      if (!byUser.has(uid)) byUser.set(uid, { userName: userNames.get(uid) || uid.slice(0, 8), departmentId: undefined, recs: [] });
      byUser.get(uid)!.recs.push(r);
    });
    const rows: TimesheetRow[] = [];
    byUser.forEach((data, userId) => {
      const byDate = new Map<string, DaySummary>();
      const datesSet = new Set<string>();
      data.recs.sort((a: any, b: any) => (a.created_at || '').localeCompare(b.created_at || ''));
      data.recs.forEach((r: any) => {
        datesSet.add((r.created_at || '').slice(0, 10));
      });
      datesSet.forEach((d) => {
        const dayRecs = data.recs.filter((r: any) => (r.created_at || '').slice(0, 10) === d);
        const mirror = buildDayMirrorSummary(dayRecs);
        const locationCoords = lastPunchLocationCoords(dayRecs);
        const isDayOff = isDayOffForEmployee(d, userId, shiftSchedules);
        byDate.set(d, {
          date: d,
          entradaInicio: mirror.entradaInicio,
          saidaIntervalo: mirror.saidaIntervalo,
          voltaIntervalo: mirror.voltaIntervalo,
          saidaFinal: mirror.saidaFinal,
          workedHours: mirror.workedHours,
          status: mirror.status,
          locationCoords,
          isDayOff,
        });
      });
      rows.push({
        userId,
        userName: data.userName,
        departmentName: data.departmentId,
        byDate: byDate,
        dates: [...datesSet].sort(),
      });
    });
    return rows.sort((a, b) => a.userName.localeCompare(b.userName));
  }, [filteredRecords, employees, shiftSchedules]);

  const handleExportPDF = () => {
    window.print();
  };

  const handleExportExcel = async () => {
    const headers = [
      'Colaborador',
      'Data',
      'Entrada (início)',
      'Intervalo (pausa)',
      'Retorno',
      'Saída (final)',
      'Horas trabalhadas',
      'Localização',
      'Status',
    ];
    const lines = [headers.join('\t')];
    for (const row of buildRows) {
      for (const d of row.dates) {
        const sum = row.byDate.get(d);
        let locText = '—';
        if (sum?.locationCoords) {
          locText = await reverseGeocode(sum.locationCoords.lat, sum.locationCoords.lng);
        }
        lines.push(
          [
            row.userName,
            d,
            sum?.entradaInicio ?? '',
            sum?.saidaIntervalo ?? '',
            sum?.voltaIntervalo ?? '',
            sum?.saidaFinal ?? '',
            sum?.workedHours ?? '',
            locText,
            sum?.status ?? '',
          ].join('\t'),
        );
      }
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `espelho-ponto-${periodStart}-${periodEnd}.tsv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleCloseTimesheet = async () => {
    if (!user?.companyId || !confirm(`Fechar folha de ponto do mês ${closeMonth}? Isso calculará totais e marcará a folha como fechada.`)) return;
    setMessage(null);
    setClosing(true);
    try {
      const [year, month] = closeMonth.split('-').map(Number);
      const { closed, errors } = await closeTimesheet(user.companyId, month, year);
      if (errors.length > 0) {
        setMessage({ type: 'error', text: `Fechado: ${closed}. Erros: ${errors.slice(0, 3).join('; ')}${errors.length > 3 ? '...' : ''}` });
      } else {
        setMessage({ type: 'success', text: `Folha de ${closeMonth} fechada. ${closed} colaborador(es) processado(s).` });
      }
    } catch (e: any) {
      setMessage({ type: 'error', text: e?.message || 'Erro ao fechar folha.' });
    } finally {
      setClosing(false);
    }
  };

  const handleAddTimeRecord = async (data: { user_id: string; created_at: string; type: string }) => {
    if (!user || !supabase) return;
    try {
      // Chamar RPC insert_time_record_for_user com bypass de RLS
      const { data: result, error } = await supabase.rpc('insert_time_record_for_user', {
        p_user_id: data.user_id,
        p_company_id: user.companyId,
        p_type: data.type,
        p_method: 'admin',
        p_source: 'admin',
        p_timestamp: data.created_at,
        p_manual_reason: 'Batida adicionada manualmente via Espelho de Ponto',
      });

      if (error) {
        console.error('RPC error:', error);
        throw new Error(error.message || 'Erro ao chamar RPC');
      }

      const recordId = result?.record_id;

      // Registrar auditoria
      await LoggingService.log({
        severity: LogSeverity.SECURITY,
        action: 'ADMIN_ADD_TIME_RECORD',
        userId: user.id,
        userName: user.nome,
        companyId: user.companyId,
        details: {
          timeRecordId: recordId,
          employeeId: data.user_id,
          createdAt: data.created_at,
          type: data.type,
        },
      });

      // Recarregar dados com filtro de data
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const dateFilter = thirtyDaysAgo.toISOString().slice(0, 10);

      const recordsRows = (await db.select('time_records', [
        { column: 'company_id', operator: 'eq', value: user.companyId },
        { column: 'created_at', operator: 'gte', value: dateFilter }
      ], { column: 'created_at', ascending: false }, 500)) ?? [];
      
      // Debug: verificar se is_manual está sendo retornado
      console.log('Records loaded:', recordsRows.slice(0, 3).map(r => ({ 
        id: r.id, 
        is_manual: r.is_manual, 
        manual_reason: r.manual_reason,
        created_at: r.created_at 
      })));
      
      setRecords(recordsRows);

      toast.addToast('success', 'Batida adicionada com sucesso.');
    } catch (err: any) {
      console.error('Error adding time record:', err);
      toast.addToast('error', err?.message || 'Erro ao adicionar batida.');
    }
  };

  if (loading) return <LoadingState message="Carregando..." />;
  if (!user) return <Navigate to="/" replace />;

  return (
    <div className="space-y-6">
      <PageHeader title="Espelho de Ponto" />
      {message && (
        <div className={`p-4 rounded-xl ${message.type === 'success' ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300' : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300'} text-sm`}>
          {message.text}
        </div>
      )}
      <div className="flex flex-wrap gap-4 items-end p-4 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 print:hidden">
        <div>
          <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-1">Colaborador</label>
          <select value={filterUserId} onChange={(e) => setFilterUserId(e.target.value)} className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white min-w-[180px]">
            <option value="">Todos</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>{e.nome}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-1">Departamento</label>
          <select value={filterDept} onChange={(e) => setFilterDept(e.target.value)} className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white min-w-[180px]">
            <option value="">Todos</option>
            {departments.map((dept) => (
              <option key={dept.id} value={dept.id}>{dept.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-1">Período (início)</label>
          <input type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white" />
        </div>
        <div>
          <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-1">Período (fim)</label>
          <input type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white" />
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={handleExportPDF} className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800">
            <FileDown className="w-4 h-4" /> Exportar PDF
          </button>
          <button type="button" onClick={handleExportExcel} className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800">
            <FileSpreadsheet className="w-4 h-4" /> Exportar Excel
          </button>
          <button type="button" onClick={() => setIsAddModalOpen(true)} className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800">
            <Plus className="w-4 h-4" /> Adicionar Batida
          </button>
          <div className="flex items-center gap-2 ml-2 pl-2 border-l border-slate-200 dark:border-slate-700">
            <input type="month" value={closeMonth} onChange={(e) => setCloseMonth(e.target.value)} className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-sm" />
            <button type="button" onClick={handleCloseTimesheet} disabled={closing} className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50" title="Fechar folha do mês (calcula totais e marca como fechada)">
              <Lock className="w-4 h-4" /> Fechar folha
            </button>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/50 print:border-0 print:shadow-none print:bg-transparent print:overflow-visible -mx-4 px-4 sm:mx-0 sm:px-0">
        {loadingData ? (
          <div className="p-12 text-center text-slate-500">Carregando...</div>
        ) : (
          <div className="overflow-x-auto overscroll-x-contain touch-pan-x rounded-xl border border-slate-100 dark:border-slate-800 md:border-0">
          <table className="w-full text-xs sm:text-sm min-w-[860px] md:min-w-0">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-700">
                <th className="text-left px-4 py-3 font-bold text-slate-500 dark:text-slate-400">Colaborador</th>
                <th className="text-left px-4 py-3 font-bold text-slate-500 dark:text-slate-400">Data</th>
                <th className="text-left px-4 py-3 font-bold text-slate-500 dark:text-slate-400">Entrada (início)</th>
                <th className="text-left px-4 py-3 font-bold text-slate-500 dark:text-slate-400">Intervalo (pausa)</th>
                <th className="text-left px-4 py-3 font-bold text-slate-500 dark:text-slate-400">Retorno</th>
                <th className="text-left px-4 py-3 font-bold text-slate-500 dark:text-slate-400">Saída (final)</th>
                <th className="text-left px-4 py-3 font-bold text-slate-500 dark:text-slate-400">Horas trabalhadas</th>
                <th className="text-left px-4 py-3 font-bold text-slate-500 dark:text-slate-400">Localização</th>
                <th className="text-left px-4 py-3 font-bold text-slate-500 dark:text-slate-400">Status</th>
              </tr>
            </thead>
            <tbody>
              {buildRows.flatMap((row) =>
                row.dates.map((d) => {
                  const sum = row.byDate.get(d);
                  const dayRecs = filteredRecords.filter(
                    (r: any) => r.user_id === row.userId && (r.created_at || '').slice(0, 10) === d,
                  );
                  const rowKey = `${row.userId}-${d}`;
                  const isExpanded = expandedRows[rowKey] === true;
                  return (
                    <React.Fragment key={rowKey}>
                    <tr className="border-b border-slate-100 dark:border-slate-800">
                      <td
                        className="px-4 py-3 text-slate-900 dark:text-white cursor-pointer hover:text-indigo-600 dark:hover:text-indigo-300 max-w-[7rem] sm:max-w-[9rem] truncate"
                        title={
                          isExpanded
                            ? `${row.userName} — Ocultar endereços das batidas`
                            : `${row.userName} — Mostrar endereços das batidas`
                        }
                        onClick={() => toggleExpandedRow(rowKey)}
                      >
                        {displayGivenNameForColumn(row.userName)}
                      </td>
                      <td className="px-4 py-3 align-top max-w-[110px]">
                        <ExpandableTextCell label="Data" value={d} />
                      </td>
                      <td className="px-4 py-3 tabular-nums max-w-[100px] align-top">
                        <ExpandableTextCell 
                          label="Entrada (início)" 
                          value={sum?.entradaInicio || ''} 
                          empty={sum?.isDayOff ? 'FOLGA' : (sum?.hasAbsence ? 'FALTA' : '—')}
                          className={sum?.isDayOff ? 'text-green-600 dark:text-green-400 font-bold' : (sum?.hasAbsence ? 'text-red-600 dark:text-red-400 font-bold' : (sum?.hasLateEntry ? 'text-red-600 dark:text-red-400' : ''))}
                        />
                      </td>
                      <td className="px-4 py-3 tabular-nums max-w-[100px] align-top">
                        <ExpandableTextCell label="Intervalo (pausa)" value={sum?.saidaIntervalo || ''} empty="—" />
                      </td>
                      <td className="px-4 py-3 tabular-nums max-w-[100px] align-top">
                        <ExpandableTextCell label="Retorno" value={sum?.voltaIntervalo || ''} empty="—" />
                      </td>
                      <td className="px-4 py-3 tabular-nums max-w-[100px] align-top">
                        <ExpandableTextCell label="Saída (final)" value={sum?.saidaFinal || ''} empty="—" />
                      </td>
                      <td className="px-4 py-3 tabular-nums max-w-[100px] align-top">
                        <ExpandableTextCell label="Horas trabalhadas" value={sum?.workedHours || ''} empty="—" />
                      </td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-400 text-xs w-[min(100%,11rem)] max-w-[11rem] min-w-0 align-top">
                        {sum?.locationCoords ? (
                          <ExpandableStreetCell
                            lat={sum.locationCoords.lat}
                            lng={sum.locationCoords.lng}
                            previewMaxLength={32}
                          />
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="px-4 py-3 max-w-[180px] align-top">
                        <ExpandableTextCell label="Status" value={sum?.status || 'OK'} />
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr className="bg-slate-50/70 dark:bg-slate-800/30 border-b border-slate-100 dark:border-slate-800">
                        <td colSpan={9} className="px-4 py-3">
                          <div className="text-xs text-slate-600 dark:text-slate-300">
                            <p className="font-medium mb-2">Enderecos por batida do dia {d}:</p>
                            <div className="space-y-1">
                              {dayRecs
                                .slice()
                                .sort((a: any, b: any) => (a.created_at || '').localeCompare(b.created_at || ''))
                                .map((r: any) => {
                                  const ll = extractLatLng(r);
                                  const when = r.created_at
                                    ? new Date(r.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
                                    : '--:--';
                                  const isManual = r.is_manual === true;
                                  if (isManual) {
                                    console.log('Manual record found:', { id: r.id, is_manual: r.is_manual, manual_reason: r.manual_reason });
                                  }
                                  return (
                                    <div 
                                      key={r.id || `${rowKey}-${when}`} 
                                      className={`flex flex-wrap gap-2 cursor-pointer p-2 rounded transition-colors ${
                                        isManual 
                                          ? 'bg-amber-50 dark:bg-amber-900/20 hover:bg-amber-100 dark:hover:bg-amber-900/30' 
                                          : 'hover:bg-slate-100 dark:hover:bg-slate-700/30'
                                      }`}
                                      onClick={() => {
                                        if (isManual) {
                                          setSelectedManualRecord({
                                            reason: r.manual_reason,
                                            timestamp: r.created_at,
                                            type: r.type,
                                          });
                                        }
                                      }}
                                    >
                                      <span className={`font-mono ${isManual ? 'text-amber-600 dark:text-amber-400 font-bold' : 'text-slate-500'}`}>
                                        {when}{isManual ? ' ⚠' : ''}
                                      </span>
                                      <span className={`uppercase text-[11px] px-1.5 py-0.5 rounded ${
                                        isManual
                                          ? 'bg-amber-200 dark:bg-amber-800 text-amber-800 dark:text-amber-200'
                                          : 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200'
                                      }`}>
                                        {(r.type || '—').toString()}
                                      </span>
                                      <span className="text-slate-500">-</span>
                                      {ll ? (
                                        <ExpandableStreetCell lat={ll.lat} lng={ll.lng} previewMaxLength={28} />
                                      ) : (
                                        <span className="text-slate-500">Batida sem GPS</span>
                                      )}
                                    </div>
                                  );
                                })}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                    </React.Fragment>
                  );
                })
              )}
            </tbody>
          </table>
          </div>
        )}
        {!loadingData && buildRows.length === 0 && (
          <p className="p-8 text-center text-slate-500 dark:text-slate-400">Nenhum registro no período.</p>
        )}
      </div>

      <AddTimeRecordModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        onSubmit={handleAddTimeRecord}
        employees={employees}
      />

      <ManualRecordModal
        isOpen={selectedManualRecord !== null}
        onClose={() => setSelectedManualRecord(null)}
        reason={selectedManualRecord?.reason}
        timestamp={selectedManualRecord?.timestamp}
        type={selectedManualRecord?.type}
      />
    </div>
  );
};

export default AdminTimesheet;
