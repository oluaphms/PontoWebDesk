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
  hasAbsence?: boolean;
  hasLateEntry?: boolean;
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
    // Usar apenas a data sem timezone (YYYY-MM-DD)
    const parts = date.split('-');
    if (parts.length !== 3) return false;
    
    const year = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10) - 1; // JavaScript months are 0-indexed
    const day = parseInt(parts[2], 10);
    
    // Criar data em UTC para evitar problemas de timezone
    const dateObj = new Date(Date.UTC(year, month, day));
    const dayOfWeek = dateObj.getUTCDay(); // 0 = Sunday, 1 = Monday, etc.
    
    const schedule = shiftSchedules.find(
      (s: any) => s.employee_id === employeeId && s.day_of_week === dayOfWeek
    );
    
    return schedule?.is_day_off === true;
  } catch (e) {
    console.warn('Error checking day off:', e);
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
        // Calcular data de 7 dias atrás (em vez de 30) para melhor performance
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        const dateFilter = sevenDaysAgo.toISOString().slice(0, 10);

        const [usersRows, recordsRows, departmentsRows, shiftsRows] = await Promise.all([
          db.select('users', [{ column: 'company_id', operator: 'eq', value: user.companyId }]) as Promise<any[]>,
          db.select('time_records', [
            { column: 'company_id', operator: 'eq', value: user.companyId },
            { column: 'created_at', operator: 'gte', value: dateFilter }
          ], { column: 'created_at', ascending: false }, 1000) as Promise<any[]>,
          db.select('departments', [{ column: 'company_id', operator: 'eq', value: user.companyId }]) as Promise<any[]>,
          db.select('employee_shift_schedule', [{ column: 'company_id', operator: 'eq', value: user.companyId }]) as Promise<any[]>,
        ]);
        
        setEmployees((usersRows ?? []).map((u: any) => ({ id: u.id, nome: u.nome || u.email, department_id: u.department_id })));
        setRecords(recordsRows ?? []);
        setDepartments((departmentsRows ?? []).map((d: any) => ({ id: d.id, name: d.name })));
        
        // Debug: verificar dados de shift schedule
        console.log('Shift schedules loaded:', shiftsRows?.length || 0, 'records');
        if (shiftsRows && shiftsRows.length > 0) {
          console.log('Sample shift schedule:', shiftsRows[0]);
        }
        
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
      
      // Agrupar por data sem ordenar (mais rápido)
      data.recs.forEach((r: any) => {
        datesSet.add((r.created_at || '').slice(0, 10));
      });
      
      // Adicionar datas de folga do período mesmo sem registros
      if (periodStart && periodEnd && shiftSchedules.length > 0) {
        const start = new Date(periodStart);
        const end = new Date(periodEnd);
        
        for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
          const dateStr = d.toISOString().slice(0, 10);
          if (isDayOffForEmployee(dateStr, userId, shiftSchedules)) {
            datesSet.add(dateStr);
          }
        }
      }
      
      // Processar datas em ordem
      const sortedDates = Array.from(datesSet).sort();
      sortedDates.forEach((d) => {
        const dayRecs = data.recs.filter((r: any) => (r.created_at || '').slice(0, 10) === d);
        const mirror = buildDayMirrorSummary(dayRecs);
        const locationCoords = lastPunchLocationCoords(dayRecs);
        const isDayOff = isDayOffForEmployee(d, userId, shiftSchedules);
        
        // Debug: log para verificar isDayOff
        if (isDayOff) {
          console.log(`Day off detected for ${userId} on ${d}`);
        }
        
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
          hasAbsence: mirror.hasAbsence,
          hasLateEntry: mirror.hasLateEntry,
        });
      });
      
      rows.push({
        userId,
        userName: data.userName,
        departmentName: data.departmentId,
        byDate: byDate,
        dates: sortedDates,
      });
    });
    
    return rows.sort((a, b) => a.userName.localeCompare(b.userName));
  }, [filteredRecords, employees, shiftSchedules, periodStart, periodEnd]);

  const handleExportPDF = async () => {
    try {
      const { jsPDF } = await import('jspdf');
      const AutoTable = (await import('jspdf-autotable')).default;

      const pdf = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a4',
      });

      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      let currentY = 15;

      // ===== CABEÇALHO =====
      pdf.setFontSize(14);
      pdf.setFont(undefined, 'bold');
      pdf.text('ESPELHO DE PONTO', pageWidth / 2, currentY, { align: 'center' });
      currentY += 8;

      // Período
      pdf.setFontSize(10);
      pdf.setFont(undefined, 'normal');
      const periodText = `Período: ${new Date(periodStart).toLocaleDateString('pt-BR')} a ${new Date(periodEnd).toLocaleDateString('pt-BR')}`;
      pdf.text(periodText, pageWidth / 2, currentY, { align: 'center' });
      currentY += 10;

      // ===== DADOS DO COLABORADOR (por cada um) =====
      // Agrupar por colaborador
      const byEmployee = new Map<string, any>();
      for (const row of buildRows) {
        if (!byEmployee.has(row.userId)) {
          byEmployee.set(row.userId, {
            name: row.userName,
            dates: row.dates,
            byDate: row.byDate,
            userId: row.userId,
          });
        }
      }

      // Processar cada colaborador
      for (const [, empData] of byEmployee) {
        // Verificar se precisa de nova página
        if (currentY > pageHeight - 80) {
          pdf.addPage();
          currentY = 15;
        }

        // Dados do colaborador
        pdf.setFontSize(11);
        pdf.setFont(undefined, 'bold');
        pdf.text(`Colaborador: ${empData.name}`, 15, currentY);
        currentY += 6;

        pdf.setFontSize(9);
        pdf.setFont(undefined, 'normal');
        
        // Buscar dados adicionais do colaborador
        const empInfo = employees.find((e: any) => e.id === empData.userId);
        if (empInfo?.cargo) {
          pdf.text(`Cargo: ${empInfo.cargo}`, 15, currentY);
          currentY += 5;
        }
        if (empInfo?.department_id) {
          const dept = departments.find((d: any) => d.id === empInfo.department_id);
          if (dept) {
            pdf.text(`Departamento: ${dept.name}`, 15, currentY);
            currentY += 5;
          }
        }

        currentY += 3;

        // ===== TABELA DE PONTO =====
        const tableData: any[] = [];
        let totalHours = 0;
        let totalExtra = 0;
        let daysWorked = 0;
        let absences = 0;

        for (const d of empData.dates) {
          const sum = empData.byDate.get(d);
          
          // Formatar data
          const dateObj = new Date(d + 'T00:00:00');
          const dateFormatted = dateObj.toLocaleDateString('pt-BR');

          // Determinar ocorrência
          let occurrence = 'OK';
          if (sum?.isDayOff) {
            occurrence = 'Folga';
          } else if (sum?.hasAbsence) {
            occurrence = 'Falta';
            absences++;
          } else if (sum?.hasLateEntry) {
            occurrence = 'Atraso';
          }

          // Extrair horas
          const entrada = sum?.entradaInicio || '—';
          const saidaIntervalo = sum?.saidaIntervalo || '—';
          const retorno = sum?.voltaIntervalo || '—';
          const saida = sum?.saidaFinal || '—';
          const horas = sum?.workedHours || '—';

          // Contar horas para total
          if (horas !== '—' && !sum?.isDayOff) {
            try {
              const [h, m] = horas.split(':').map(Number);
              totalHours += h + (m / 60);
              daysWorked++;
            } catch {
              // ignorar
            }
          }

          tableData.push([
            dateFormatted,
            entrada,
            saidaIntervalo,
            retorno,
            saida,
            horas,
            occurrence,
          ]);
        }

        // Adicionar tabela
        AutoTable(pdf, {
          head: [['Data', 'Entrada', 'Pausa', 'Retorno', 'Saída', 'Horas', 'Ocorrência']],
          body: tableData,
          startY: currentY,
          margin: { left: 10, right: 10, top: 10, bottom: 50 },
          styles: {
            fontSize: 8,
            cellPadding: 2,
            overflow: 'linebreak',
            halign: 'center',
            valign: 'middle',
          },
          headStyles: {
            fillColor: [51, 65, 85],
            textColor: [255, 255, 255],
            fontStyle: 'bold',
            fontSize: 8,
            halign: 'center',
          },
          alternateRowStyles: {
            fillColor: [245, 245, 245],
          },
          columnStyles: {
            0: { cellWidth: 20, halign: 'center' },
            1: { cellWidth: 15, halign: 'center' },
            2: { cellWidth: 15, halign: 'center' },
            3: { cellWidth: 15, halign: 'center' },
            4: { cellWidth: 15, halign: 'center' },
            5: { cellWidth: 15, halign: 'center' },
            6: { cellWidth: 20, halign: 'center' },
          },
          didDrawPage: () => {
            // Nada aqui por enquanto
          },
        });

        currentY = (pdf as any).lastAutoTable.finalY + 10;

        // ===== RESUMO FINAL =====
        pdf.setFontSize(9);
        pdf.setFont(undefined, 'bold');
        
        const totalHoursFormatted = Math.floor(totalHours) + ':' + String(Math.round((totalHours % 1) * 60)).padStart(2, '0');
        pdf.text(`Total de Horas: ${totalHoursFormatted}`, 15, currentY);
        currentY += 5;
        
        pdf.text(`Dias Trabalhados: ${daysWorked}`, 15, currentY);
        currentY += 5;
        
        pdf.text(`Faltas: ${absences}`, 15, currentY);
        currentY += 8;

        // ===== ASSINATURA =====
        pdf.setFont(undefined, 'normal');
        pdf.setFontSize(8);
        
        // Linha de assinatura do funcionário
        pdf.line(15, currentY + 15, 50, currentY + 15);
        pdf.text('Funcionário', 32.5, currentY + 18, { align: 'center' });
        pdf.text('Data: ___/___/_____', 32.5, currentY + 22, { align: 'center' });

        // Linha de assinatura do RH
        pdf.line(pageWidth - 50, currentY + 15, pageWidth - 15, currentY + 15);
        pdf.text('RH / Responsável', pageWidth - 32.5, currentY + 18, { align: 'center' });
        pdf.text('Data: ___/___/_____', pageWidth - 32.5, currentY + 22, { align: 'center' });

        // Adicionar página se houver mais colaboradores
        if (byEmployee.size > 1 && Array.from(byEmployee.keys()).indexOf(empData.userId) < byEmployee.size - 1) {
          pdf.addPage();
          currentY = 15;
        }
      }

      // Download
      pdf.save(`espelho-ponto-${periodStart}-${periodEnd}.pdf`);
    } catch (error) {
      console.error('Erro ao exportar PDF:', error);
      alert('Erro ao exportar PDF. Tente novamente.');
    }
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
    
    // Cache de geocodificação para evitar requisições duplicadas
    const geocodeCache = new Map<string, string>();
    
    for (const row of buildRows) {
      for (const d of row.dates) {
        const sum = row.byDate.get(d);
        let locText = '—';
        
        // Usar cache para evitar múltiplas requisições
        if (sum?.locationCoords) {
          const cacheKey = `${sum.locationCoords.lat.toFixed(5)},${sum.locationCoords.lng.toFixed(5)}`;
          if (geocodeCache.has(cacheKey)) {
            locText = geocodeCache.get(cacheKey)!;
          } else {
            try {
              locText = await reverseGeocode(sum.locationCoords.lat, sum.locationCoords.lng);
              geocodeCache.set(cacheKey, locText);
            } catch {
              locText = '—';
            }
          }
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
                      <td className="px-4 py-3 align-top whitespace-nowrap">
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
                                      className={`flex items-center gap-3 cursor-pointer p-2 rounded transition-colors whitespace-nowrap overflow-x-auto ${
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
                                      <span className={`font-mono flex-shrink-0 ${isManual ? 'text-amber-600 dark:text-amber-400 font-bold' : 'text-slate-500'}`}>
                                        {when}{isManual ? ' ⚠' : ''}
                                      </span>
                                      <span className={`uppercase text-[11px] px-1.5 py-0.5 rounded flex-shrink-0 ${
                                        isManual
                                          ? 'bg-amber-200 dark:bg-amber-800 text-amber-800 dark:text-amber-200'
                                          : 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200'
                                      }`}>
                                        {(r.type || '—').toString()}
                                      </span>
                                      <span className="text-slate-500 flex-shrink-0">-</span>
                                      {ll ? (
                                        <ExpandableStreetCell lat={ll.lat} lng={ll.lng} previewMaxLength={28} />
                                      ) : (
                                        <span className="text-slate-500 flex-shrink-0">Batida sem GPS</span>
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
