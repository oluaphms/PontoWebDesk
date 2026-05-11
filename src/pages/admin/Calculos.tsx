import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Navigate } from 'react-router-dom';
import {
  Calculator,
  ChevronLeft,
  ChevronRight,
  Download,
  FileText,
  Filter,
  ListChecks,
  Printer,
  Search,
} from 'lucide-react';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { useToast } from '../../components/ToastProvider';
import PageHeader from '../../components/PageHeader';
import { LoadingState } from '../../../components/UI';
import { db, isSupabaseConfigured } from '../../services/supabaseClient';
import { buscarColaboradores } from '../../../services/api';
import { runCalcPeriodJob } from '../../services/adminCalcPeriodJob.service';
import {
  processEmployeeDay,
  type OvertimeResult,
  type TimeInconsistency,
} from '../../engine/timeEngine';
import {
  getEmployeeSchedule,
  isTimesheetClosed,
  type DailyProcessResult,
  type WorkScheduleInfo,
} from '../../services/timeProcessingService';

function fmtMinutos(m: number): string {
  const sign = m < 0 ? '-' : '';
  const a = Math.abs(Math.round(m));
  const h = Math.floor(a / 60);
  const min = a % 60;
  return `${sign}${h}:${String(min).padStart(2, '0')}`;
}

function formatDataPt(ymd: string): string {
  if (!ymd || ymd.length < 10) return ymd;
  const [y, mo, d] = ymd.slice(0, 10).split('-');
  return `${d}/${mo}/${y}`;
}

function nomeDiaSemana(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  if (!y || !m || !d) return '';
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString('pt-BR', { weekday: 'short' });
}

function roundMinutes(value: number, step: number): number {
  if (!step || step <= 0) return Math.round(value);
  return Math.round(value / step) * step;
}

function weekStartDate(ymd: string): string {
  const d = new Date(`${ymd}T12:00:00`);
  const day = d.getDay();
  const diff = (day + 6) % 7; // segunda-feira = 0
  d.setDate(d.getDate() - diff);
  return d.toISOString().slice(0, 10);
}

function addDays(ymd: string, days: number): string {
  const d = new Date(`${ymd}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

interface CalcDayRow {
  date: string;
  daily: DailyProcessResult & { missing_minutes: number; absence_minutes: number };
  overtime: OvertimeResult | null;
  inconsistencies: TimeInconsistency[];
  night_minutes: number;
  isHoliday: boolean;
  isDayOff: boolean;
}

interface CalcGroupRow {
  key: string;
  label: string;
  daily: DailyProcessResult & { missing_minutes: number; absence_minutes: number };
  overtime: OvertimeResult | null;
  night_minutes: number;
  inconsistencies: TimeInconsistency[];
}

/** Gera cada dia civil entre início e fim (YYYY-MM-DD), inclusive. */
function eachDayBetween(startYmd: string, endYmd: string): string[] {
  const [ys, ms, ds] = startYmd.split('-').map(Number);
  const [ye, me, de] = endYmd.split('-').map(Number);
  const out: string[] = [];
  const cur = new Date(ys, ms - 1, ds);
  const end = new Date(ye, me - 1, de);
  if (cur > end) return out;
  while (cur <= end) {
    out.push(
      `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}-${String(cur.getDate()).padStart(2, '0')}`,
    );
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

const MAX_DIAS = 120;

const AdminCalculos: React.FC = () => {
  const { user, loading } = useCurrentUser();
  const toast = useToast();
  const selectNomeRef = useRef<HTMLSelectElement>(null);
  const [employees, setEmployees] = useState<{ id: string; nome: string }[]>([]);
  const [loadingListas, setLoadingListas] = useState(true);
  const [periodStart, setPeriodStart] = useState(() =>
    new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10),
  );
  const [periodEnd, setPeriodEnd] = useState(() => new Date().toISOString().slice(0, 10));
  const [numeroFolha, setNumeroFolha] = useState('');
  const [filterUserId, setFilterUserId] = useState('');
  const [calcRows, setCalcRows] = useState<CalcDayRow[] | null>(null);
  const [loadingCalc, setLoadingCalc] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [showFiltrosExtra, setShowFiltrosExtra] = useState(false);
  const [showCalcOptions, setShowCalcOptions] = useState(false);
  const [holidayDates, setHolidayDates] = useState<Set<string>>(() => new Set());
  const [calcOptions, setCalcOptions] = useState({
    includeHolidaysAndDaysOff: true,
    useTolerance: true,
    toleranceMinutes: 10,
    enforceMinBreak: true,
    minBreakAfterHours: 6,
    minBreakMinutes: 30,
    useEmployeeSchedule: true,
    calcOvertime: true,
    includeNight: true,
    roundingMinutes: 0,
    showOnlyInconsistencies: false,
    groupBy: 'day' as 'day' | 'week' | 'month',
    exportColumns: {
      late: true,
      missing: true,
      night: true,
    },
  });

  useEffect(() => {
    if (!user?.companyId || !isSupabaseConfigured()) {
      setLoadingListas(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const [list, holidays] = await Promise.all([
          buscarColaboradores(user.companyId!),
          db
            .select('holidays', [{ column: 'company_id', operator: 'eq', value: user.companyId }])
            .catch(() =>
              db.select('feriados', [{ column: 'company_id', operator: 'eq', value: user.companyId }]).catch(() => []),
            ),
        ]);
        if (!cancelled) {
          setEmployees([...list].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')));
          const holSet = new Set(
            (holidays ?? [])
              .map((h: any) => String(h.date || h.data || '').slice(0, 10))
              .filter(Boolean),
          );
          setHolidayDates(holSet);
        }
      } catch (e) {
        console.error(e);
        if (!cancelled) toast.addToast('error', 'Não foi possível carregar colaboradores.');
      } finally {
        if (!cancelled) setLoadingListas(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.companyId, toast]);

  const empIndex = useMemo(() => {
    if (!filterUserId) return -1;
    return employees.findIndex((e) => e.id === filterUserId);
  }, [employees, filterUserId]);

  const goPrevEmp = () => {
    if (empIndex <= 0) return;
    setFilterUserId(employees[empIndex - 1].id);
    setCalcRows(null);
  };

  const goNextEmp = () => {
    if (empIndex < 0 || empIndex >= employees.length - 1) return;
    setFilterUserId(employees[empIndex + 1].id);
    setCalcRows(null);
  };

  const computeDayRow = useCallback(
    async (employeeId: string, companyId: string, dateStr: string): Promise<CalcDayRow> => {
      const day = await processEmployeeDay(employeeId, companyId, dateStr);
      const excludedDay = !calcOptions.includeHolidaysAndDaysOff && day.daily.scheduled_day_off;
      const workedMinutes = roundMinutes(day.daily.total_worked_minutes, calcOptions.roundingMinutes);
      const expected = roundMinutes(excludedDay ? 0 : day.daily.expected_minutes, calcOptions.roundingMinutes);
      const lateMinutes = roundMinutes(day.daily.late_minutes, calcOptions.roundingMinutes);
      const missingMinutes = roundMinutes(excludedDay ? 0 : day.daily.negative_minutes, calcOptions.roundingMinutes);
      const overtimeMinutes = roundMinutes(excludedDay ? 0 : day.daily.extra_minutes, calcOptions.roundingMinutes);
      const nightMinutes = roundMinutes(calcOptions.includeNight ? day.night_minutes : 0, calcOptions.roundingMinutes);
      const overtime: OvertimeResult = {
        date: dateStr,
        overtime_50_minutes: day.daily.extra_50_minutes,
        overtime_100_minutes: day.daily.extra_100_minutes,
        is_holiday_or_off: day.daily.day_type === 'HOLIDAY' || day.daily.day_type === 'SUNDAY',
      };

      const daily: DailyProcessResult & { missing_minutes: number; absence_minutes: number } = {
        ...day.daily,
        total_worked_minutes: workedMinutes,
        expected_minutes: expected,
        overtime_minutes: overtimeMinutes,
        late_minutes: lateMinutes,
        missing_minutes: missingMinutes,
        absence_minutes: day.daily.absence_minutes,
      };

      return {
        date: dateStr,
        daily,
        overtime: excludedDay ? { ...overtime, overtime_50_minutes: 0, overtime_100_minutes: 0 } : overtime,
        inconsistencies: day.inconsistencies,
        night_minutes: nightMinutes,
        isHoliday: day.daily.day_type === 'HOLIDAY',
        isDayOff: day.daily.scheduled_day_off,
      };
    },
    [
      calcOptions.includeHolidaysAndDaysOff,
      calcOptions.includeNight,
      calcOptions.roundingMinutes,
    ],
  );

  const atualizar = useCallback(async () => {
    if (!user?.companyId || !filterUserId) {
      toast.addToast('error', 'Selecione um colaborador e clique em Atualizar.');
      return;
    }
    const dias = eachDayBetween(periodStart, periodEnd);
    if (dias.length === 0) {
      toast.addToast('error', 'Período inválido.');
      return;
    }
    if (dias.length > MAX_DIAS) {
      toast.addToast('error', `Reduza o período (máximo ${MAX_DIAS} dias).`);
      return;
    }
    const ymKeys = new Set<string>();
    for (const d of dias) {
      ymKeys.add(d.slice(0, 7));
    }
    for (const ym of ymKeys) {
      const y = Number(ym.slice(0, 4));
      const mo = Number(ym.slice(5, 7));
      if (!y || !mo) continue;
      const closed = await isTimesheetClosed(user.companyId, mo, y, filterUserId);
      if (closed) {
        toast.addToast(
          'error',
          `Período fechado (${String(mo).padStart(2, '0')}/${y}). Recálculo manual não permitido.`,
        );
        return;
      }
    }
    setLoadingCalc(true);
    setCalcRows(null);
    try {
      await runCalcPeriodJob({
        employeeId: filterUserId,
        periodStart,
        periodEnd,
      });

      const persisted = (await db.select(
        'timesheets_daily',
        [
          { column: 'employee_id', operator: 'eq', value: filterUserId },
          { column: 'company_id', operator: 'eq', value: user.companyId },
          { column: 'date', operator: 'gte', value: periodStart },
          { column: 'date', operator: 'lte', value: periodEnd },
        ],
        { column: 'date', ascending: true },
        500
      )) as Array<{
        date: string;
        worked_minutes: number;
        expected_minutes: number;
        overtime_minutes: number;
        absence_minutes: number;
        night_minutes: number;
        late_minutes: number;
        raw_data?: Record<string, unknown>;
      }>;
      const byDate = new Map((persisted || []).map((r) => [r.date, r]));
      const rows: CalcDayRow[] = dias.map((d) => {
        const p = byDate.get(d);
        const extra50 = Number((p?.raw_data as any)?.extra_50_minutes ?? 0);
        const extra100 = Number((p?.raw_data as any)?.extra_100_minutes ?? 0);
        return {
          date: d,
          daily: {
            total_worked_minutes: Number(p?.worked_minutes ?? 0),
            expected_minutes: Number(p?.expected_minutes ?? 0),
            overtime_minutes: Number(p?.overtime_minutes ?? 0),
            late_minutes: Number(p?.late_minutes ?? 0),
            missing_minutes: Number((p?.raw_data as any)?.negative_minutes ?? 0),
            absence_minutes: Number(p?.absence_minutes ?? 0),
            entrada: null,
            saida: null,
            inicio_intervalo: null,
            fim_intervalo: null,
            scheduled_day_off: false,
          },
          overtime: {
            date: d,
            overtime_50_minutes: extra50,
            overtime_100_minutes: extra100,
            is_holiday_or_off: false,
          },
          inconsistencies: [],
          night_minutes: Number(p?.night_minutes ?? 0),
          isHoliday: false,
          isDayOff: false,
        };
      });
      setCalcRows(rows);
    } catch (e: any) {
      if (typeof e?.message === 'string' && e.message.toLowerCase().includes('sessão expirada')) {
        toast.addToast('error', e.message);
        return;
      }
      console.warn('[Calculos] fallback local ativado:', e);
      // Fallback importante para mobile/offline parcial: cálculo local por dia.
      try {
        const rows = await Promise.all(
          dias.map((d) => computeDayRow(filterUserId, user.companyId!, d)),
        );
        setCalcRows(rows);
        toast.addToast('warning', 'Cálculo executado em modo local neste dispositivo.');
      } catch (localErr: any) {
        console.error(localErr);
        toast.addToast('error', localErr?.message || e?.message || 'Falha ao calcular.');
      }
    } finally {
      setLoadingCalc(false);
    }
  }, [
    user?.companyId,
    filterUserId,
    periodStart,
    periodEnd,
    toast,
    computeDayRow,
  ]);

  const filteredRows = useMemo(() => {
    if (!calcRows) return null;
    if (!calcOptions.showOnlyInconsistencies) return calcRows;
    return calcRows.filter((r) => r.inconsistencies.length > 0);
  }, [calcOptions.showOnlyInconsistencies, calcRows]);

  const groupedRows = useMemo(() => {
    if (!filteredRows || calcOptions.groupBy === 'day') return null;
    const byKey = new Map<string, CalcGroupRow>();

    const ensure = (key: string, label: string) => {
      if (byKey.has(key)) return byKey.get(key)!;
      const base: CalcGroupRow = {
        key,
        label,
        daily: {
          total_worked_minutes: 0,
          expected_minutes: 0,
          overtime_minutes: 0,
          late_minutes: 0,
          missing_minutes: 0,
          absence_minutes: 0,
          scheduled_day_off: false,
          entrada: null,
          saida: null,
          inicio_intervalo: null,
          fim_intervalo: null,
        },
        overtime: {
          date: key,
          overtime_50_minutes: 0,
          overtime_100_minutes: 0,
          is_holiday_or_off: false,
        },
        night_minutes: 0,
        inconsistencies: [],
      };
      byKey.set(key, base);
      return base;
    };

    for (const row of filteredRows) {
      if (calcOptions.groupBy === 'week') {
        const start = weekStartDate(row.date);
        const end = addDays(start, 6);
        const label = `Semana ${formatDataPt(start)} a ${formatDataPt(end)}`;
        const group = ensure(start, label);
        group.daily.total_worked_minutes += row.daily.total_worked_minutes;
        group.daily.expected_minutes += row.daily.expected_minutes;
        group.daily.overtime_minutes += row.daily.overtime_minutes;
        group.daily.late_minutes += row.daily.late_minutes;
        group.daily.missing_minutes += row.daily.missing_minutes;
        group.daily.absence_minutes += row.daily.absence_minutes;
        group.night_minutes += row.night_minutes;
        group.overtime!.overtime_50_minutes += row.overtime?.overtime_50_minutes ?? 0;
        group.overtime!.overtime_100_minutes += row.overtime?.overtime_100_minutes ?? 0;
        group.inconsistencies.push(...row.inconsistencies);
      } else {
        const key = row.date.slice(0, 7);
        const [y, m] = key.split('-');
        const label = `Mês ${m}/${y}`;
        const group = ensure(key, label);
        group.daily.total_worked_minutes += row.daily.total_worked_minutes;
        group.daily.expected_minutes += row.daily.expected_minutes;
        group.daily.overtime_minutes += row.daily.overtime_minutes;
        group.daily.late_minutes += row.daily.late_minutes;
        group.daily.missing_minutes += row.daily.missing_minutes;
        group.daily.absence_minutes += row.daily.absence_minutes;
        group.night_minutes += row.night_minutes;
        group.overtime!.overtime_50_minutes += row.overtime?.overtime_50_minutes ?? 0;
        group.overtime!.overtime_100_minutes += row.overtime?.overtime_100_minutes ?? 0;
        group.inconsistencies.push(...row.inconsistencies);
      }
    }

    return Array.from(byKey.values());
  }, [filteredRows, calcOptions.groupBy]);

  const columns = useMemo(() => {
    const cols = [
      { key: 'date', label: calcOptions.groupBy === 'day' ? 'Data' : 'Período' },
      { key: 'weekday', label: 'Dia', visible: calcOptions.groupBy === 'day' },
      { key: 'entrada', label: 'Entrada', visible: calcOptions.groupBy === 'day' },
      { key: 'saida', label: 'Saída', visible: calcOptions.groupBy === 'day' },
      { key: 'worked', label: 'Trabalhadas' },
      { key: 'negative', label: 'Negativas' },
      { key: 'late', label: 'Atraso', visible: calcOptions.exportColumns.late },
      { key: 'missing', label: 'Falta', visible: calcOptions.exportColumns.missing },
      { key: 'extra50', label: 'Extra 50%' },
      { key: 'extra100', label: 'Extra 100%' },
      { key: 'night', label: 'Noturno', visible: calcOptions.exportColumns.night },
    ];
    return cols.filter((c) => c.visible !== false);
  }, [calcOptions.exportColumns.late, calcOptions.exportColumns.missing, calcOptions.exportColumns.night, calcOptions.groupBy]);

  const rowsToRender = useMemo(() => {
    if (!filteredRows) return null;
    if (calcOptions.groupBy === 'day') return filteredRows;
    return groupedRows;
  }, [filteredRows, calcOptions.groupBy, groupedRows]);

  const totalsToRender = useMemo(() => {
    if (!rowsToRender) return null;
    return rowsToRender.reduce(
      (acc, r) => {
        const row = r as CalcDayRow & CalcGroupRow;
        acc.worked += row.daily.total_worked_minutes;
        acc.negative += row.daily.missing_minutes;
        acc.late += row.daily.late_minutes;
        acc.missing += row.daily.absence_minutes;
        acc.extra50 += row.overtime?.overtime_50_minutes ?? 0;
        acc.extra100 += row.overtime?.overtime_100_minutes ?? 0;
        acc.night += row.night_minutes;
        return acc;
      },
      { worked: 0, negative: 0, late: 0, missing: 0, extra50: 0, extra100: 0, night: 0 },
    );
  }, [rowsToRender]);

  const exportarCsv = () => {
    if (!filteredRows?.length) {
      toast.addToast('error', 'Não há dados para exportar. Clique em Atualizar.');
      return;
    }
    const grouped = calcOptions.groupBy !== 'day';
    const list = grouped ? groupedRows || [] : filteredRows;
    const nome = employees.find((e) => e.id === filterUserId)?.nome ?? '';
    const headers = columns.map((c) => c.label);
    const lines = [headers.join(';')];
    const totals = list.reduce(
      (acc, r) => {
        const row = r as CalcDayRow & CalcGroupRow;
        acc.worked += row.daily.total_worked_minutes;
        acc.negative += row.daily.missing_minutes;
        acc.late += row.daily.late_minutes;
        acc.missing += row.daily.absence_minutes;
        acc.extra50 += row.overtime?.overtime_50_minutes ?? 0;
        acc.extra100 += row.overtime?.overtime_100_minutes ?? 0;
        acc.night += row.night_minutes;
        return acc;
      },
      { worked: 0, negative: 0, late: 0, missing: 0, extra50: 0, extra100: 0, night: 0 },
    );
    for (const r of list) {
      const row = r as CalcDayRow & CalcGroupRow;
      const values: Record<string, string> = {
        date: grouped ? row.label : row.date,
        weekday: grouped ? '' : nomeDiaSemana(row.date),
        entrada: grouped ? '—' : row.daily.entrada ?? '—',
        saida: grouped ? '—' : row.daily.saida ?? '—',
        worked: fmtMinutos(row.daily.total_worked_minutes),
        negative: fmtMinutos(row.daily.missing_minutes),
        late: fmtMinutos(row.daily.late_minutes),
        missing: fmtMinutos(row.daily.absence_minutes),
        extra50: fmtMinutos(row.overtime?.overtime_50_minutes ?? 0),
        extra100: fmtMinutos(row.overtime?.overtime_100_minutes ?? 0),
        night: fmtMinutos(row.night_minutes),
      };
      lines.push(columns.map((c) => values[c.key]).join(';'));
    }
    const totalsLine = columns.map((c) => {
      if (c.key === 'date') return 'Totais';
      if (c.key === 'worked') return fmtMinutos(totals.worked);
      if (c.key === 'negative') return fmtMinutos(totals.negative);
      if (c.key === 'late') return fmtMinutos(totals.late);
      if (c.key === 'missing') return fmtMinutos(totals.missing);
      if (c.key === 'extra50') return fmtMinutos(totals.extra50);
      if (c.key === 'extra100') return fmtMinutos(totals.extra100);
      if (c.key === 'night') return fmtMinutos(totals.night);
      return '';
    });
    lines.push(totalsLine.join(';'));
    const blob = new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `calculos-${nome.replace(/\s+/g, '_')}-${periodStart}_${periodEnd}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast.addToast('success', 'Exportação gerada.');
  };

  const exportarPdf = async () => {
    if (!filteredRows?.length) {
      toast.addToast('error', 'Não há dados para exportar. Clique em Atualizar.');
      return;
    }
    const grouped = calcOptions.groupBy !== 'day';
    const list = grouped ? groupedRows || [] : filteredRows;
    setExportingPdf(true);
    try {
      const nome = employees.find((e) => e.id === filterUserId)?.nome ?? '—';
      const { jsPDF } = await import('jspdf');
      const autoTable = (await import('jspdf-autotable')).default;

      const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
      const pageW = doc.internal.pageSize.getWidth();
      doc.setFontSize(14);
      doc.setFont(undefined, 'bold');
      doc.text('PontoWebDesk — Cálculos (diário)', pageW / 2, 12, { align: 'center' });
      doc.setFont(undefined, 'normal');
      doc.setFontSize(10);
      const sub = [
        `Colaborador: ${nome}`,
        `Período: ${formatDataPt(periodStart)} a ${formatDataPt(periodEnd)}`,
        numeroFolha ? `Nº folha: ${numeroFolha}` : null,
      ]
        .filter(Boolean)
        .join('  ·  ');
      doc.text(sub, pageW / 2, 19, { align: 'center' });

      const head = [columns.map((c) => c.label)];
      const totals = list.reduce(
        (acc, r) => {
          const row = r as CalcDayRow & CalcGroupRow;
          acc.worked += row.daily.total_worked_minutes;
          acc.negative += row.daily.missing_minutes;
          acc.late += row.daily.late_minutes;
          acc.missing += row.daily.absence_minutes;
          acc.extra50 += row.overtime?.overtime_50_minutes ?? 0;
          acc.extra100 += row.overtime?.overtime_100_minutes ?? 0;
          acc.night += row.night_minutes;
          return acc;
        },
        { worked: 0, negative: 0, late: 0, missing: 0, extra50: 0, extra100: 0, night: 0 },
      );
      const body = list.map((r) => {
        const row = r as CalcDayRow & CalcGroupRow;
        const values: Record<string, string> = {
          date: grouped ? row.label : formatDataPt(row.date),
          weekday: grouped ? '' : nomeDiaSemana(row.date),
          entrada: grouped ? '—' : row.daily.entrada ?? '—',
          saida: grouped ? '—' : row.daily.saida ?? '—',
          worked: fmtMinutos(row.daily.total_worked_minutes),
          negative: fmtMinutos(row.daily.missing_minutes),
          late: fmtMinutos(row.daily.late_minutes),
          missing: fmtMinutos(row.daily.absence_minutes),
          extra50: fmtMinutos(row.overtime?.overtime_50_minutes ?? 0),
          extra100: fmtMinutos(row.overtime?.overtime_100_minutes ?? 0),
          night: fmtMinutos(row.night_minutes),
        };
        return columns.map((c) => values[c.key]);
      });

      const foot = [
        columns.map((c) => {
          if (c.key === 'date') return 'Totais';
          if (c.key === 'worked') return fmtMinutos(totals.worked);
          if (c.key === 'negative') return fmtMinutos(totals.negative);
          if (c.key === 'late') return fmtMinutos(totals.late);
          if (c.key === 'missing') return fmtMinutos(totals.missing);
          if (c.key === 'extra50') return fmtMinutos(totals.extra50);
          if (c.key === 'extra100') return fmtMinutos(totals.extra100);
          if (c.key === 'night') return fmtMinutos(totals.night);
          return '';
        }),
      ];

      autoTable(doc, {
        head,
        body,
        foot,
        startY: 26,
        styles: { fontSize: 7, cellPadding: 1.2, overflow: 'linebreak' },
        headStyles: { fillColor: [79, 70, 229], fontSize: 8 },
        footStyles: { fillColor: [241, 245, 249], textColor: [15, 23, 42], fontStyle: 'bold' },
        margin: { left: 10, right: 10 },
      });

      doc.save(`calculos-${nome.replace(/\s+/g, '_')}-${periodStart}_${periodEnd}.pdf`);
      toast.addToast('success', 'PDF gerado.');
    } catch (e) {
      console.error(e);
      toast.addToast('error', 'Não foi possível gerar o PDF. Tente novamente.');
    } finally {
      setExportingPdf(false);
    }
  };

  const imprimir = () => {
    if (!calcRows?.length) {
      toast.addToast('error', 'Não há dados para imprimir. Clique em Atualizar.');
      return;
    }
    window.print();
  };

  if (loading) return <LoadingState message="Carregando..." />;
  if (!user) return <Navigate to="/" replace />;

  const inp =
    'px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-sm';

  const nomeColaborador = employees.find((e) => e.id === filterUserId)?.nome ?? '';

  return (
    <div className="calculos-report-root space-y-4 print:space-y-2">
      <div className="print:hidden">
        <PageHeader title="Cálculos" />
      </div>

      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/50 overflow-hidden print:border-0 print:shadow-none print:overflow-visible">
        {/* Só impressão / Salvar como PDF no navegador: contexto do relatório */}
        <div className="hidden print:block px-4 py-3 border-b border-slate-900 text-center">
          <p className="text-base font-bold">PontoWebDesk — Cálculos</p>
          <p className="text-sm mt-1">
            {nomeColaborador ? `Colaborador: ${nomeColaborador}` : 'Colaborador: —'}
            {' · '}
            Período: {formatDataPt(periodStart)} a {formatDataPt(periodEnd)}
            {numeroFolha ? ` · Folha: ${numeroFolha}` : ''}
          </p>
        </div>

        {/* Barra superior: ações */}
        <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-800/40 print:hidden">
          <div className="flex items-center gap-2 text-slate-800 dark:text-slate-100 font-semibold text-sm mr-2">
            <Calculator className="w-5 h-5 text-indigo-600 dark:text-indigo-400 shrink-0" aria-hidden />
            <span>Cálculos</span>
          </div>
          <button
            type="button"
            onClick={() => setShowCalcOptions((v) => !v)}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border border-slate-200 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <ListChecks className="w-4 h-4 text-rose-600" />
            Opções
          </button>
          <button
            type="button"
            onClick={() => setShowFiltrosExtra((v) => !v)}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border ${
              showFiltrosExtra
                ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/30'
                : 'border-slate-200 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            <Filter className="w-4 h-4 text-emerald-600" />
            Filtros
          </button>
          <button
            type="button"
            onClick={exportarCsv}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border border-slate-200 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <Download className="w-4 h-4 text-emerald-600" />
            CSV
          </button>
          <button
            type="button"
            onClick={() => void exportarPdf()}
            disabled={exportingPdf}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border border-slate-200 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50"
          >
            <FileText className="w-4 h-4 text-indigo-600" />
            {exportingPdf ? 'PDF…' : 'PDF'}
          </button>
          <button
            type="button"
            onClick={imprimir}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border border-slate-200 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <Printer className="w-4 h-4 text-slate-600" />
            Imprimir
          </button>
        </div>

        {/* Filtros principais (ocultos na impressão para não sair “captura da tela”) */}
        <div className="p-3 space-y-3 border-b border-slate-200 dark:border-slate-800 print:hidden">
          <div className="flex flex-col xl:flex-row flex-wrap gap-3 xl:items-end">
            <div className="flex flex-wrap items-end gap-2">
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-0.5">Período</label>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="date"
                    value={periodStart}
                    onChange={(e) => {
                      setPeriodStart(e.target.value);
                      setCalcRows(null);
                    }}
                    className={inp}
                  />
                  <span className="text-sm text-slate-500">até</span>
                  <input
                    type="date"
                    value={periodEnd}
                    onChange={(e) => {
                      setPeriodEnd(e.target.value);
                      setCalcRows(null);
                    }}
                    className={inp}
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-0.5">Nº Folha</label>
                <input
                  type="text"
                  inputMode="numeric"
                  placeholder="—"
                  value={numeroFolha}
                  onChange={(e) => setNumeroFolha(e.target.value)}
                  className={`${inp} w-24`}
                />
              </div>
              <div className="min-w-[200px] flex-1 max-w-md">
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-0.5">Nome</label>
                <select
                  ref={selectNomeRef}
                  value={filterUserId}
                  onChange={(e) => {
                    setFilterUserId(e.target.value);
                    setCalcRows(null);
                  }}
                  className={`${inp} w-full`}
                >
                  <option value="">Selecione…</option>
                  {employees.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.nome}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex-1 flex justify-end">
              <button
                type="button"
                onClick={() => void atualizar()}
                disabled={loadingCalc || !filterUserId}
                className="px-6 py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50 shadow-sm"
              >
                {loadingCalc ? 'Calculando…' : 'Atualizar'}
              </button>
            </div>
          </div>

          {showFiltrosExtra && (
            <p className="text-xs text-slate-500 dark:text-slate-400 print:hidden">
              Filtros adicionais (departamento, projeto, etc.) poderão ser incluídos nas próximas versões.
            </p>
          )}
          {showCalcOptions && (
            <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40 p-3 text-xs text-slate-700 dark:text-slate-300 space-y-3 print:hidden">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                <label className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={calcOptions.includeHolidaysAndDaysOff}
                    onChange={(e) => setCalcOptions((s) => ({ ...s, includeHolidaysAndDaysOff: e.target.checked }))}
                    className="mt-0.5"
                  />
                  <span>Incluir feriados e folgas no cálculo</span>
                </label>

                <label className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={calcOptions.useEmployeeSchedule}
                    onChange={(e) => setCalcOptions((s) => ({ ...s, useEmployeeSchedule: e.target.checked }))}
                    className="mt-0.5"
                  />
                  <span>Usar escala do colaborador</span>
                </label>

                <label className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={calcOptions.useTolerance}
                    onChange={(e) => setCalcOptions((s) => ({ ...s, useTolerance: e.target.checked }))}
                    className="mt-0.5"
                  />
                  <span>Considerar tolerância de entrada/saída</span>
                </label>

                <div className="flex items-center gap-2">
                  <span className="text-slate-600 dark:text-slate-400">Tolerância (min)</span>
                  <input
                    type="number"
                    min={0}
                    value={calcOptions.toleranceMinutes}
                    onChange={(e) => setCalcOptions((s) => ({ ...s, toleranceMinutes: Number(e.target.value || 0) }))}
                    className="w-20 px-2 py-1 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs"
                    disabled={!calcOptions.useTolerance}
                  />
                </div>

                <label className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={calcOptions.enforceMinBreak}
                    onChange={(e) => setCalcOptions((s) => ({ ...s, enforceMinBreak: e.target.checked }))}
                    className="mt-0.5"
                  />
                  <span>Aplicar regra de intervalo mínimo</span>
                </label>

                <div className="flex items-center gap-2">
                  <span className="text-slate-600 dark:text-slate-400">Após (h)</span>
                  <input
                    type="number"
                    min={0}
                    step={0.5}
                    value={calcOptions.minBreakAfterHours}
                    onChange={(e) => setCalcOptions((s) => ({ ...s, minBreakAfterHours: Number(e.target.value || 0) }))}
                    className="w-20 px-2 py-1 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs"
                    disabled={!calcOptions.enforceMinBreak}
                  />
                  <span className="text-slate-600 dark:text-slate-400">Intervalo (min)</span>
                  <input
                    type="number"
                    min={0}
                    value={calcOptions.minBreakMinutes}
                    onChange={(e) => setCalcOptions((s) => ({ ...s, minBreakMinutes: Number(e.target.value || 0) }))}
                    className="w-20 px-2 py-1 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs"
                    disabled={!calcOptions.enforceMinBreak}
                  />
                </div>

                <label className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={calcOptions.calcOvertime}
                    onChange={(e) => setCalcOptions((s) => ({ ...s, calcOvertime: e.target.checked }))}
                    className="mt-0.5"
                  />
                  <span>Calcular horas extras 50%/100%</span>
                </label>

                <label className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={calcOptions.includeNight}
                    onChange={(e) => setCalcOptions((s) => ({ ...s, includeNight: e.target.checked }))}
                    className="mt-0.5"
                  />
                  <span>Incluir adicional noturno</span>
                </label>

                <div className="flex items-center gap-2">
                  <span className="text-slate-600 dark:text-slate-400">Arredondamento</span>
                  <select
                    value={calcOptions.roundingMinutes}
                    onChange={(e) => setCalcOptions((s) => ({ ...s, roundingMinutes: Number(e.target.value) }))}
                    className="px-2 py-1 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs"
                  >
                    <option value={0}>Sem</option>
                    <option value={5}>5 min</option>
                    <option value={10}>10 min</option>
                    <option value={15}>15 min</option>
                  </select>
                </div>

                <label className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={calcOptions.showOnlyInconsistencies}
                    onChange={(e) => setCalcOptions((s) => ({ ...s, showOnlyInconsistencies: e.target.checked }))}
                    className="mt-0.5"
                  />
                  <span>Exibir apenas dias com inconsistência</span>
                </label>

                <div className="flex items-center gap-2">
                  <span className="text-slate-600 dark:text-slate-400">Agrupar por</span>
                  <select
                    value={calcOptions.groupBy}
                    onChange={(e) => setCalcOptions((s) => ({ ...s, groupBy: e.target.value as 'day' | 'week' | 'month' }))}
                    className="px-2 py-1 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs"
                  >
                    <option value="day">Dia</option>
                    <option value="week">Semana</option>
                    <option value="month">Mês</option>
                  </select>
                </div>

                <div className="flex flex-col gap-2">
                  <span className="text-slate-600 dark:text-slate-400">Colunas da exportação</span>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={calcOptions.exportColumns.late}
                      onChange={(e) =>
                        setCalcOptions((s) => ({
                          ...s,
                          exportColumns: { ...s.exportColumns, late: e.target.checked },
                        }))
                      }
                    />
                    <span>Atraso</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={calcOptions.exportColumns.missing}
                      onChange={(e) =>
                        setCalcOptions((s) => ({
                          ...s,
                          exportColumns: { ...s.exportColumns, missing: e.target.checked },
                        }))
                      }
                    />
                    <span>Falta</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={calcOptions.exportColumns.night}
                      onChange={(e) =>
                        setCalcOptions((s) => ({
                          ...s,
                          exportColumns: { ...s.exportColumns, night: e.target.checked },
                        }))
                      }
                    />
                    <span>Noturno</span>
                  </label>
                </div>
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Após ajustar as opções, clique em <strong>Atualizar</strong> para recalcular.
              </p>
            </div>
          )}
        </div>

        {/* Grade */}
        <div className="p-3 min-h-[240px] print:min-h-0">
          {loadingListas && <p className="text-sm text-slate-500 print:hidden">Carregando listas…</p>}
          {!loadingListas && loadingCalc && (
            <div className="flex items-center justify-center py-16 text-slate-500 text-sm print:hidden">
              Processando período…
            </div>
          )}
          {!loadingCalc && calcRows === null && (
            <div className="flex flex-col items-center justify-center py-16 text-center text-slate-500 dark:text-slate-400 text-sm border border-dashed border-slate-200 dark:border-slate-700 rounded-xl print:hidden">
              <Calculator className="w-10 h-10 mb-2 opacity-40" />
              <p>Selecione o colaborador, o período e clique em <strong className="text-slate-700 dark:text-slate-300">Atualizar</strong> para exibir os cálculos.</p>
            </div>
          )}
          {!loadingCalc && filteredRows && filteredRows.length === 0 && (
            <p className="text-sm text-slate-500 print:hidden">Nenhum dia no período.</p>
          )}
          {!loadingCalc && rowsToRender && rowsToRender.length > 0 && (
            <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-100 dark:bg-slate-800 text-left">
                    {columns.map((col) => (
                      <th key={col.key} className="px-2 py-2 font-semibold">
                        {col.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rowsToRender.map((r) => {
                    const row = r as CalcDayRow & CalcGroupRow;
                    const grouped = calcOptions.groupBy !== 'day';
                      const values: Record<string, string> = {
                      date: grouped ? row.label : formatDataPt(row.date),
                      weekday: grouped ? '' : nomeDiaSemana(row.date),
                      entrada: grouped ? '—' : row.daily.entrada ?? '—',
                      saida: grouped ? '—' : row.daily.saida ?? '—',
                      worked: fmtMinutos(row.daily.total_worked_minutes),
                      negative: fmtMinutos(row.daily.missing_minutes),
                      late: fmtMinutos(row.daily.late_minutes),
                      missing: fmtMinutos(row.daily.absence_minutes),
                      extra50: fmtMinutos(row.overtime?.overtime_50_minutes ?? 0),
                      extra100: fmtMinutos(row.overtime?.overtime_100_minutes ?? 0),
                      night: fmtMinutos(row.night_minutes),
                    };
                    return (
                      <tr key={row.key || row.date} className="border-t border-slate-100 dark:border-slate-800">
                        {columns.map((col) => (
                          <td key={col.key} className="px-2 py-1.5 tabular-nums whitespace-nowrap">
                            {values[col.key]}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
                {totalsToRender && (
                  <tfoot>
                    <tr className="border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 font-semibold">
                      {columns.map((col) => {
                        const value =
                          col.key === 'date'
                            ? 'Totais'
                            : col.key === 'worked'
                              ? fmtMinutos(totalsToRender.worked)
                              : col.key === 'negative'
                                  ? fmtMinutos(totalsToRender.negative)
                                  : col.key === 'late'
                                    ? fmtMinutos(totalsToRender.late)
                                    : col.key === 'missing'
                                      ? fmtMinutos(totalsToRender.missing)
                                      : col.key === 'extra50'
                                        ? fmtMinutos(totalsToRender.extra50)
                                        : col.key === 'extra100'
                                          ? fmtMinutos(totalsToRender.extra100)
                                          : col.key === 'night'
                                            ? fmtMinutos(totalsToRender.night)
                                            : '';
                        return (
                          <td key={col.key} className="px-2 py-2 tabular-nums whitespace-nowrap">
                            {value}
                          </td>
                        );
                      })}
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default AdminCalculos;
