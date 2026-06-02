import { observabilityConsole } from '../../shared/logger/observabilityConsole';
import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { Navigate } from 'react-router-dom';
import { ChevronDown, ChevronRight, FileDown, MapPin, RefreshCw } from 'lucide-react';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import PageHeader from '../../components/PageHeader';
import { db, isSupabaseConfigured, supabase } from '../../services/supabaseClient';
import { fetchTimeRecordsForMirrorWindow } from '../../../services/api';
import { getNationalHolidayDatesForPeriod } from '../../engine/timeEngine';
import { LoadingState } from '../../../components/UI';
import { calendarDateForEspelhoRow, extractLocalCalendarDateFromIso } from '../../utils/calendarUtils';
import type { PendingRepPunch } from '../../services/timeAttendanceData';
import {
  buildDayMirrorSummary,
  DayMirror,
  resolveMirrorSlotRecord,
  formatMinutes,
  getDayStatus,
  isManualRecord,
  isStatusRecord,
  recordEffectiveMirrorInstant,
  type TimeRecord as MirrorTimeRecord,
  type DayScheduleWindow,
  type DayScheduleSlots,
} from '../../utils/timesheetMirror';
import { getEmployeeTimesheetScheduleContext } from '../../services/timeProcessingService';
import { extractLatLng } from '../../utils/reverseGeocode';
import { resolvePunchOrigin } from '../../utils/punchOrigin';
import { ExpandableStreetCell } from '../../components/ClickableFullContent';
import { TimesheetTableSkeleton } from '../../components/TimesheetTableSkeleton';
import { readSpecialBarsPref, SPECIAL_BARS_CHANGED } from '../../utils/timesheetLayoutPrefs';
import { invalidateAfterPunch } from '../../services/queryCache';
import { enumerateLocalCalendarDays } from '../../utils/localDateTimeToIso';
import { EditTimeRecordModal } from '../../components/EditTimeRecordModal';

/** Data local YYYY-MM-DD (evita UTC deslocar o “hoje” no max do input). */
function localDateKey(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function localMonthStartKey(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}-01`;
}

function logTimesheetDebug(label: string, payload: unknown): void {
  console.log(label, payload);
}

function formatDateBR(dateStr: string) {
  const [y, m, day] = dateStr.split('-');
  return `${day}/${m}/${y}`;
}

const EMPTY_DASH = '----';

function localYmdStartIso(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  if (!y || !m || !d) return `${ymd}T00:00:00.000Z`;
  return new Date(y, m - 1, d, 0, 0, 0, 0).toISOString();
}

function localYmdEndIso(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  if (!y || !m || !d) return `${ymd}T23:59:59.999Z`;
  return new Date(y, m - 1, d, 23, 59, 59, 999).toISOString();
}

type DayIssuesModalState = {
  date: string;
  extras: string[];
  inconsistencias: string[];
  repPending: PendingRepPunch[];
} | null;

type PunchGeoSnapshot = {
  accuracy_meters?: number | null;
  provider?: string | null;
  captured_at?: string | null;
  street?: string | null;
  district?: string | null;
  city?: string | null;
  state?: string | null;
  postal_code?: string | null;
  formatted_address?: string | null;
  formatted?: string | null;
  geocode_snapshot?: {
    street?: string | null;
    district?: string | null;
    city?: string | null;
    state?: string | null;
    postal_code?: string | null;
    formatted_address?: string | null;
    formatted?: string | null;
  } | null;
};

function getGeoSnapshot(row: any): PunchGeoSnapshot | null {
  const raw = row?.raw_data;
  if (!raw || typeof raw !== 'object') return null;
  const snap = (raw as { geo_snapshot?: unknown }).geo_snapshot;
  if (!snap || typeof snap !== 'object') return null;
  return snap as PunchGeoSnapshot;
}

function shouldRenderStreetSeparately(formattedAddress?: string | null, street?: string | null): boolean {
  if (!street) return false;
  if (!formattedAddress) return true;
  return !formattedAddress.toLowerCase().includes(street.toLowerCase());
}

function readGeoAddress(row: any): {
  street: string | null;
  district: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  formattedAddress: string | null;
} {
  const geo = getGeoSnapshot(row);
  const nested = geo?.geocode_snapshot ?? null;
  return {
    street: nested?.street ?? geo?.street ?? null,
    district: nested?.district ?? geo?.district ?? null,
    city: nested?.city ?? geo?.city ?? null,
    state: nested?.state ?? geo?.state ?? null,
    postalCode: nested?.postal_code ?? geo?.postal_code ?? null,
    formattedAddress: nested?.formatted_address ?? nested?.formatted ?? geo?.formatted_address ?? geo?.formatted ?? null,
  };
}

const EmployeeTimesheet: React.FC = () => {
  const { user, loading } = useCurrentUser();
  /** Linhas brutas do Supabase (inclui campos de GPS para o detalhe expansível). */
  const [records, setRecords] = useState<any[]>([]);
  const [holidayDates, setHolidayDates] = useState<Set<string>>(() => new Set());
  const [periodStart, setPeriodStart] = useState(() => localMonthStartKey());
  const [periodEnd, setPeriodEnd] = useState(() => localDateKey());
  const [loadingData, setLoadingData] = useState(false);
  const todayMax = useMemo(() => localDateKey(), []);
  const [detailOpenByDate, setDetailOpenByDate] = useState<Record<string, boolean>>({});
  const [specialBarsLayout, setSpecialBarsLayout] = useState(false);
  const [scheduleWorkDays, setScheduleWorkDays] = useState<number[] | null>(null);
  const [scheduleWindowsByDow, setScheduleWindowsByDow] = useState<Record<number, DayScheduleWindow | null> | null>(
    null,
  );
  /** Força novo fetch ao clicar em «Atualizar batidas». */
  const [refreshNonce, setRefreshNonce] = useState(0);

  useEffect(() => {
    const onSynced = () => setRefreshNonce((n) => n + 1);
    window.addEventListener('pontowebdesk:web-punch-synced', onSynced as EventListener);
    return () => {
      window.removeEventListener('pontowebdesk:web-punch-synced', onSynced as EventListener);
    };
  }, []);

  /** Admin/RH: editar batidas manuais a partir do espelho (mesmo modal do admin). */
  const [recordToEdit, setRecordToEdit] = useState<{
    id: string;
    user_id: string;
    created_at: string;
    type: string;
    manual_reason?: string | null;
    source?: string | null;
    method?: string | null;
    origin?: string | null;
  } | null>(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [issuesModal, setIssuesModal] = useState<DayIssuesModalState>(null);
  const [repPendingByDate, setRepPendingByDate] = useState<Map<string, PendingRepPunch[]>>(() => new Map());

  useEffect(() => {
    const sync = () => setSpecialBarsLayout(readSpecialBarsPref());
    sync();
    window.addEventListener('storage', sync);
    window.addEventListener(SPECIAL_BARS_CHANGED, sync);
    window.addEventListener('focus', sync);
    return () => {
      window.removeEventListener('storage', sync);
      window.removeEventListener(SPECIAL_BARS_CHANGED, sync);
      window.removeEventListener('focus', sync);
    };
  }, []);

  const periodValid =
    Boolean(periodStart && periodEnd && periodStart <= periodEnd && periodEnd <= todayMax && periodStart <= todayMax);

  const companyId = user?.companyId || user?.company_id;

  useEffect(() => {
    if (!user?.id || !companyId || !isSupabaseConfigured()) {
      setScheduleWorkDays(null);
      setScheduleWindowsByDow(null);
      return;
    }
    let active = true;
    void (async () => {
      try {
        // Em tela do colaborador, evita fallback legado via `users` (query pesada sujeita a timeout).
        // Se não houver ESS, usa padrão [1..5] sem bloquear o espelho.
        const ctx = await getEmployeeTimesheetScheduleContext(user.id, companyId, {
          useLegacyUserScheduleFallback: false,
        });
        if (active) {
          setScheduleWorkDays(ctx.workDays ?? null);
          setScheduleWindowsByDow(ctx.windowByJsDow);
        }
      } catch {
        if (active) {
          setScheduleWorkDays(null);
          setScheduleWindowsByDow(null);
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [user?.id, companyId]);

  useEffect(() => {
    if (!user || !isSupabaseConfigured()) {
      setLoadingData(false);
      setRecords([]);
      setHolidayDates(new Set());
      return;
    }
    if (!periodValid) {
      setRecords([]);
      setHolidayDates(new Set());
      setLoadingData(false);
      return;
    }
    let cancelled = false;
    const load = async () => {
      setLoadingData(true);
      try {
        const startDate = periodStart;
        const endDate = periodEnd;
        logTimesheetDebug('USER', user);
        logTimesheetDebug('EMPLOYEE', {
          id: user.id,
          employeeId: user.id,
          companyId,
          tenantId: user.tenantId,
          role: user.role,
        });
        const recordFilters = [
          ...(companyId ? [{ column: 'company_id' as const, operator: 'eq' as const, value: companyId }] : []),
          { column: 'user_id' as const, operator: 'eq' as const, value: user.id },
        ];
        const rowsP = fetchTimeRecordsForMirrorWindow(
          recordFilters,
          startDate,
          endDate,
          false,
          2000
        );

        let holidayRows: any[] = [];
        if (companyId) {
          try {
            holidayRows = (await db.select('holidays', [
              { column: 'company_id', operator: 'eq', value: companyId },
            ])) as any[];
          } catch {
            holidayRows = (await db
              .select('feriados', [{ column: 'company_id', operator: 'eq', value: companyId }])
              .catch(() => [])) as any[];
          }
        }

        const [rows] = await Promise.all([rowsP]);
        logTimesheetDebug('API RESPONSE', {
          endpoint: '/api/data/time_records',
          filters: recordFilters,
          periodStart: startDate,
          periodEnd: endDate,
          count: rows?.length ?? 0,
          sample: (rows ?? []).slice(0, 5),
        });
        logTimesheetDebug('TIME RECORDS', rows ?? []);
        logTimesheetDebug('PUNCHES', rows ?? []);
        logTimesheetDebug('TIMESHEET', {
          source: 'time_records',
          endpoint: '/api/data/time_records',
          filters: recordFilters,
          periodStart: startDate,
          periodEnd: endDate,
          punches: rows?.length ?? 0,
        });
        const holSet = new Set(
          (holidayRows ?? [])
            .map((h: any) => String(h.date || h.data || '').slice(0, 10))
            .filter(Boolean),
        );
        for (const date of getNationalHolidayDatesForPeriod(startDate, endDate)) {
          holSet.add(date);
        }
        if (!cancelled) {
          setRecords(rows ?? []);
          setHolidayDates(holSet);
        }
      } catch (e) {
        observabilityConsole.error(e);
        if (!cancelled) {
          setRecords([]);
          setHolidayDates(new Set());
        }
      } finally {
        if (!cancelled) setLoadingData(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [user?.id, companyId, periodStart, periodEnd, periodValid, refreshNonce]);

  useEffect(() => {
    if (!periodValid || !user?.id || !companyId || !isSupabaseConfigured()) {
      setRepPendingByDate(new Map());
      return;
    }
    let cancelled = false;
    void (async () => {
      const start = localYmdStartIso(periodStart);
      const end = localYmdEndIso(periodEnd);
      const { data, error } = await supabase
        .from('rep_punch_logs')
        .select(
          'id,resolved_user_id,data_hora,tipo_marcacao,nsr,rep_device_id,source,promotion_error_code,promotion_error_message,promotion_attempts,promotion_status',
        )
        .eq('company_id', companyId)
        .eq('resolved_user_id', user.id)
        .is('time_record_id', null)
        .eq('ignored', false)
        .gte('data_hora', start)
        .lte('data_hora', end)
        .order('data_hora', { ascending: true });
      if (cancelled) return;
      if (error) {
        observabilityConsole.warn('[Espelho colaborador] rep_punch_logs pendentes:', error.message);
        setRepPendingByDate(new Map());
        return;
      }
      const byDate = new Map<string, PendingRepPunch[]>();
      for (const row of data ?? []) {
        const r = row as Record<string, unknown>;
        const dh = String(r.data_hora ?? '');
        if (!dh) continue;
        const day = extractLocalCalendarDateFromIso(dh);
        if (day < periodStart.slice(0, 10) || day > periodEnd.slice(0, 10)) continue;
        const uid = String(r.resolved_user_id ?? '').trim();
        if (!uid) continue;
        const p: PendingRepPunch = {
          id: String(r.id ?? ''),
          resolved_user_id: uid,
          data_hora: dh,
          tipo_marcacao: r.tipo_marcacao != null ? String(r.tipo_marcacao) : null,
          nsr: typeof r.nsr === 'number' ? r.nsr : r.nsr != null ? Number(r.nsr) : null,
          rep_device_id: r.rep_device_id != null ? String(r.rep_device_id) : null,
          source: r.source != null ? String(r.source) : null,
          promotion_error_code: r.promotion_error_code != null ? String(r.promotion_error_code) : null,
          promotion_error_message: r.promotion_error_message != null ? String(r.promotion_error_message) : null,
          promotion_attempts: typeof r.promotion_attempts === 'number' ? r.promotion_attempts : null,
          promotion_status: r.promotion_status != null ? String(r.promotion_status) : null,
        };
        if (!byDate.has(day)) byDate.set(day, []);
        byDate.get(day)!.push(p);
      }
      setRepPendingByDate(byDate);
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id, companyId, periodStart, periodEnd, periodValid, refreshNonce]);

  useEffect(() => {
    if (!issuesModal) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIssuesModal(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [issuesModal]);

  const mirrorRecords = useMemo((): MirrorTimeRecord[] => {
    return (records ?? []).map((r: any) => ({
      id: r.id,
      user_id: r.user_id,
      created_at: r.created_at,
      timestamp: r.timestamp ?? null,
      type: r.type,
      manual_reason: r.manual_reason ?? null,
      latitude: r.latitude ?? null,
      longitude: r.longitude ?? null,
      is_manual: r.is_manual,
      source: r.source ?? null,
      method: r.method ?? null,
    }));
  }, [records]);

  const expectedWindowForYmd = useCallback(
    (dateStr: string): DayScheduleWindow | null | undefined => {
      if (!scheduleWindowsByDow) return undefined;
      const dow = new Date(`${dateStr}T12:00:00`).getDay();
      return scheduleWindowsByDow[dow];
    },
    [scheduleWindowsByDow],
  );

  /** Mesmo cálculo do espelho admin (`AdminTimesheet`). */
  const empMirror = useMemo(() => {
    if (!periodValid) return new Map<string, DayMirror>();
    const scheduleByDay = (date: string): DayScheduleSlots | null => {
      const win = expectedWindowForYmd(date);
      if (!win) return null;
      const [eh = '08', em = '00'] = String(win.entrada || '08:00').split(':');
      const [sh = '17', sm = '00'] = String(win.saida || '17:00').split(':');
      return {
        entrada: `${String(eh).padStart(2, '0')}:${String(em).padStart(2, '0')}`,
        saida_intervalo: win.saida_intervalo || '12:00',
        volta_intervalo: win.volta_intervalo || '14:00',
        saida_final: `${String(sh).padStart(2, '0')}:${String(sm).padStart(2, '0')}`,
        toleranceMin: win.toleranceMin ?? 60,
      };
    };
    return buildDayMirrorSummary(mirrorRecords, periodStart, periodEnd, { scheduleByDay });
  }, [mirrorRecords, periodStart, periodEnd, periodValid, expectedWindowForYmd]);

  const periodDates = useMemo(() => {
    if (!periodValid) return [];
    return enumerateLocalCalendarDays(periodStart, periodEnd);
  }, [periodStart, periodEnd, periodValid]);

  const recordsByDate = useMemo(() => {
    if (!periodValid) return new Map<string, any[]>();
    const byDay = new Map<string, any[]>();
    records.forEach((r: any) => {
      const mr = {
        id: r.id,
        user_id: r.user_id,
        created_at: r.created_at,
        timestamp: r.timestamp ?? null,
        type: r.type,
      } as MirrorTimeRecord;
      const d = calendarDateForEspelhoRow(mr, periodStart, periodEnd);
      if (!d) return;
      if (!byDay.has(d)) byDay.set(d, []);
      byDay.get(d)!.push(r);
    });
    byDay.forEach((arr, dayKey) => {
      arr.sort(
        (a, b) =>
          new Date(recordEffectiveMirrorInstant(a as MirrorTimeRecord, dayKey)).getTime() -
          new Date(recordEffectiveMirrorInstant(b as MirrorTimeRecord, dayKey)).getTime(),
      );
    });
    return byDay;
  }, [records, periodValid, periodStart, periodEnd]);

  const toggleDayDetail = (dateKey: string) => {
    setDetailOpenByDate((prev) => ({ ...prev, [dateKey]: !prev[dateKey] }));
  };

  const canEditManualAsHr = user?.role === 'admin' || user?.role === 'hr';

  const openEditManualRecord = useCallback(
    (mirror: MirrorTimeRecord | undefined) => {
      if (!mirror?.id || !isManualRecord(mirror)) return;
      const full = records.find((r: any) => String(r?.id) === String(mirror.id));
      if (!full) return;
      const ts = full.timestamp != null && String(full.timestamp).trim() !== '' ? full.timestamp : full.created_at;
      const created_at = typeof ts === 'string' ? ts : new Date(ts).toISOString();
      setRecordToEdit({
        id: String(full.id),
        user_id: String(full.user_id),
        created_at,
        type: String(full.type ?? ''),
        manual_reason: full.manual_reason ?? null,
        source: full.source ?? null,
        method: full.method ?? null,
        origin: full.origin ?? null,
      });
      setShowEditModal(true);
    },
    [records, canEditManualAsHr],
  );

  const renderTimeCell = (time: string | null, record?: MirrorTimeRecord) => {
    const isManual = record && isManualRecord(record);
    const display = time != null && String(time).trim() !== '' ? String(time).trim() : EMPTY_DASH;
    const clickableManual = Boolean(isManual && record?.id);
    return (
      <span
        role={clickableManual ? 'button' : undefined}
        tabIndex={clickableManual ? 0 : undefined}
        onClick={(e) => {
          e.stopPropagation();
          if (clickableManual) openEditManualRecord(record);
        }}
        onKeyDown={(e) => {
          if (!clickableManual) return;
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            openEditManualRecord(record);
          }
        }}
        className={`inline-flex items-center gap-1 px-2 py-1 rounded text-sm font-medium ${
          isManual
            ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 border border-blue-300 dark:border-blue-700'
            : display === EMPTY_DASH
              ? 'text-slate-400 dark:text-slate-500'
              : 'text-slate-700 dark:text-slate-300'
        } ${clickableManual ? 'cursor-pointer hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/50' : ''}`}
        title={
          isManual
            ? canEditManualAsHr
              ? `Batida manual: ${record?.manual_reason || 'Sem motivo'} — clique para editar`
              : `Batida manual: ${record?.manual_reason || 'Sem motivo'} — clique para visualizar`
            : undefined
        }
      >
        {display}
        {isManual && <span className="text-blue-500 font-bold">*</span>}
      </span>
    );
  };

  const exportPDF = () => window.print();

  if (loading) return <LoadingState message="Carregando..." />;
  if (!user) return <Navigate to="/" replace />;

  return (
    <div className={`space-y-6${specialBarsLayout ? ' timesheet-special-bars' : ''}`}>
      <PageHeader title="Espelho de Ponto" />

      <div className="flex flex-wrap gap-4 items-end p-4 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 print:hidden">
        <div>
          <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-1">Período (início)</label>
          <input
            type="date"
            value={periodStart}
            max={todayMax}
            onChange={(e) => setPeriodStart(e.target.value)}
            className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
          />
        </div>
        <div>
          <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-1">Período (fim)</label>
          <input
            type="date"
            value={periodEnd}
            max={todayMax}
            onChange={(e) => setPeriodEnd(e.target.value)}
            className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
          />
        </div>
        <button
          type="button"
          onClick={() => {
            if (user?.id && companyId) invalidateAfterPunch(user.id, companyId);
            setRefreshNonce((n) => n + 1);
          }}
          disabled={!periodValid || loadingData}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed"
          title="Recarrega batidas do servidor (ex.: após o admin importar do relógio)"
        >
          <RefreshCw className={`w-4 h-4 ${loadingData ? 'animate-spin' : ''}`} aria-hidden />
          Atualizar batidas
        </button>
        <button
          type="button"
          onClick={exportPDF}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
        >
          <FileDown className="w-4 h-4" /> Exportar PDF
        </button>
      </div>

      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/50 overflow-x-auto print:border-0 print:shadow-none print:bg-transparent print:overflow-visible">
        {!periodValid && (periodStart || periodEnd) && (
          <p className="p-6 text-center text-amber-700 dark:text-amber-300 text-sm">
            Ajuste o período: informe início e fim, com início ≤ fim, e datas não posteriores a hoje.
          </p>
        )}
        {loadingData && periodValid ? (
          <div className="p-4 sm:p-6 min-h-[min(45vh,380px)]">
            <TimesheetTableSkeleton variant="employee" />
          </div>
        ) : periodValid && !loadingData ? (
          <>
            <div className="flex flex-wrap gap-4 px-4 pt-3 pb-2 text-xs text-slate-500 dark:text-slate-400 print:hidden">
              <span className="inline-flex items-center gap-2">
                <span className="text-blue-500 font-bold">*</span> batida manual
              </span>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-700">
                  <th className="text-left px-3 py-2 font-medium text-slate-600 dark:text-slate-400">Data</th>
                  <th className="text-left px-3 py-2 font-medium text-slate-600 dark:text-slate-400">Entrada</th>
                  <th className="text-left px-3 py-2 font-medium text-slate-600 dark:text-slate-400">Saída int.</th>
                  <th className="text-left px-3 py-2 font-medium text-slate-600 dark:text-slate-400">Volta int.</th>
                  <th className="text-left px-3 py-2 font-medium text-slate-600 dark:text-slate-400">Saída</th>
                  <th className="text-left px-3 py-2 font-medium text-slate-600 dark:text-slate-400">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                {periodDates.map((date) => {
                  const day = empMirror.get(date);
                  if (!day) return null;
                  const hasRealRecords = day.records.some((r) => !isStatusRecord(r));
                  const dayStatus = getDayStatus(
                    day,
                    scheduleWorkDays ?? undefined,
                    expectedWindowForYmd(date),
                    holidayDates,
                  );
                  let dataNote: 'Folga' | 'Falta' | 'Feriado' | null = null;
                  if (holidayDates.has(date)) dataNote = 'Feriado';
                  else if (dayStatus.status === 'folga') dataNote = 'Folga';
                  else if (dayStatus.status === 'falta') dataNote = 'Falta';
                  const dayRecs = recordsByDate.get(date) ?? [];
                  const fmt = (iso: string) =>
                    new Date(iso).toLocaleTimeString('pt-BR', {
                      hour: '2-digit',
                      minute: '2-digit',
                      hour12: false,
                    });
                  const recordIsoForDay = (r: MirrorTimeRecord) => recordEffectiveMirrorInstant(r, date);
                  const fmtRecord = (r: MirrorTimeRecord) => fmt(recordIsoForDay(r));
                  const entradaRecord = resolveMirrorSlotRecord(day, 'entrada', 'entrada');
                  const saidaIntRecord = resolveMirrorSlotRecord(day, 'saida_intervalo', 'intervalo_saida');
                  const voltaIntRecord = resolveMirrorSlotRecord(day, 'volta_intervalo', 'intervalo_volta');
                  const saidaRecord = resolveMirrorSlotRecord(day, 'saida_final', 'saida');
                  const withGps = dayRecs.filter((r: any) => extractLatLng(r));
                  const repWithoutGpsCount = dayRecs.filter((r: any) => {
                    const origin = resolvePunchOrigin(r);
                    return origin.kind === 'rep' && !extractLatLng(r);
                  }).length;

                  const renderMirrorSlot = (t: string | null, rec?: MirrorTimeRecord) => {
                    const hasTime = t != null && String(t).trim() !== '';
                    if (hasTime) return renderTimeCell(t, rec);
                    if (dataNote === 'Falta') {
                      return (
                        <span className="inline-flex px-2 py-1 rounded text-sm font-semibold text-red-600 dark:text-red-400">
                          Falta
                        </span>
                      );
                    }
                    if (dataNote === 'Folga') {
                      return (
                        <span className="inline-flex px-2 py-1 rounded text-sm font-semibold text-emerald-600 dark:text-emerald-400">
                          Folga
                        </span>
                      );
                    }
                    if (dataNote === 'Feriado') {
                      return (
                        <span className="inline-flex px-2 py-1 rounded text-sm font-semibold text-amber-700 dark:text-amber-300">
                          Feriado
                        </span>
                      );
                    }
                    return renderTimeCell(null, undefined);
                  };

                  return (
                    <React.Fragment key={date}>
                      <tr className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40">
                        <td className="px-3 py-2 text-slate-800 dark:text-slate-200 whitespace-nowrap align-top">
                          <div className="flex flex-col gap-0.5">
                            {dayRecs.length > 0 ? (
                              <button
                                type="button"
                                onClick={() => toggleDayDetail(date)}
                                className="inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-lg px-1 -mx-1 py-0.5 text-left transition-colors hover:bg-indigo-50 dark:hover:bg-indigo-950/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/50"
                                aria-expanded={detailOpenByDate[date] === true}
                                title="Clique para localização por batida"
                              >
                                {detailOpenByDate[date] ? (
                                  <ChevronDown className="w-4 h-4 shrink-0 text-slate-500 dark:text-slate-400" aria-hidden />
                                ) : (
                                  <ChevronRight className="w-4 h-4 shrink-0 text-slate-500 dark:text-slate-400" aria-hidden />
                                )}
                                <span className="tabular-nums">{formatDateBR(date)}</span>
                              </button>
                            ) : (
                              <span className="tabular-nums">{formatDateBR(date)}</span>
                            )}
                            {dataNote && (
                              <span
                                className={`text-xs font-semibold pl-0 ${
                                  dataNote === 'Falta'
                                    ? 'text-red-600 dark:text-red-400'
                                    : dataNote === 'Folga'
                                      ? 'text-emerald-600 dark:text-emerald-400'
                                      : dataNote === 'Feriado'
                                        ? 'text-amber-700 dark:text-amber-300'
                                        : 'text-slate-500 dark:text-slate-400'
                                }`}
                              >
                                {dataNote}
                              </span>
                            )}
                            {(() => {
                              const rp = repPendingByDate.get(date);
                              if (!rp?.length) return null;
                              return (
                                <span
                                  className="text-xs font-semibold text-amber-800 dark:text-amber-200"
                                  title="Batidas no REP ainda sem linha no espelho — não entram no total até consolidar."
                                >
                                  REP pendente: {rp.length} batida(s)
                                </span>
                              );
                            })()}
                          </div>
                        </td>
                        <td className="px-3 py-2 align-top">
                          {renderMirrorSlot(hasRealRecords ? day.entradaInicio : null, hasRealRecords ? entradaRecord : undefined)}
                        </td>
                        <td className="px-3 py-2 align-top">
                          {renderMirrorSlot(hasRealRecords ? day.saidaIntervalo : null, hasRealRecords ? saidaIntRecord : undefined)}
                        </td>
                        <td className="px-3 py-2 align-top">
                          {renderMirrorSlot(hasRealRecords ? day.voltaIntervalo : null, hasRealRecords ? voltaIntRecord : undefined)}
                        </td>
                        <td className="px-3 py-2 align-top">
                          {renderMirrorSlot(hasRealRecords ? day.saidaFinal : null, hasRealRecords ? saidaRecord : undefined)}
                        </td>
                        <td className="px-3 py-2 font-medium text-slate-700 dark:text-slate-300 align-top">
                          {hasRealRecords && day.workedMinutes > 0 ? formatMinutes(day.workedMinutes) : EMPTY_DASH}
                        </td>
                      </tr>
                      {dayRecs.length > 0 && detailOpenByDate[date] === true && (
                        <tr className="bg-slate-50/80 dark:bg-slate-800/40 print:bg-transparent">
                          <td colSpan={6} className="px-3 py-3">
                            <p className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">
                              Localização por batida — {formatDateBR(date)}
                              {withGps.length > 0 ? (
                                <span className="ml-2 inline-flex items-center gap-1 font-normal normal-case text-slate-600 dark:text-slate-300">
                                  <MapPin className="w-3.5 h-3.5 text-indigo-500" aria-hidden />
                                  {withGps.length} com GPS
                                </span>
                              ) : repWithoutGpsCount === dayRecs.length && dayRecs.length > 0 ? (
                                <span className="ml-2 font-normal normal-case text-slate-500">GPS não se aplica às batidas do relógio (REP)</span>
                              ) : (
                                <span className="ml-2 font-normal normal-case text-slate-500">Sem GPS nas batidas</span>
                              )}
                            </p>
                            <div className="space-y-2">
                              {dayRecs.map((r: any) => {
                                const ll = extractLatLng(r);
                                const geoSnap = getGeoSnapshot(r);
                                const geoAddress = readGeoAddress(r);
                                const accuracy = Number(
                                  geoSnap?.accuracy_meters ?? r?.accuracy ?? Number.NaN,
                                );
                                const provider = String(
                                  geoSnap?.provider || r?.method || 'desconhecido',
                                ).toLowerCase();
                                const capturedAt = String(
                                  geoSnap?.captured_at || r?.timestamp || r?.created_at || '',
                                ).trim();
                                const whenIso = recordEffectiveMirrorInstant(r as MirrorTimeRecord, date);
                                const when = whenIso
                                  ? new Date(whenIso).toLocaleTimeString('pt-BR', {
                                      hour: '2-digit',
                                      minute: '2-digit',
                                    })
                                  : '—';
                                return (
                                  <div
                                    key={r.id || `${date}-${when}-${r.type}`}
                                    className="flex flex-wrap items-start gap-x-3 gap-y-1 text-xs"
                                  >
                                    <span className="font-mono tabular-nums text-slate-600 dark:text-slate-400 shrink-0">
                                      {when}
                                    </span>
                                    <span className="uppercase text-[10px] px-2 py-0.5 rounded-md bg-slate-200/90 dark:bg-slate-700 text-slate-800 dark:text-slate-100 shrink-0">
                                      {(r.type || '—').toString()}
                                    </span>
                                    <span className="text-[10px] px-2 py-0.5 rounded-md bg-indigo-100/90 dark:bg-indigo-900/40 text-indigo-800 dark:text-indigo-200 shrink-0">
                                      {resolvePunchOrigin(r).label}
                                    </span>
                                    <div className="min-w-0 flex-1 basis-[min(100%,18rem)] max-w-xl">
                                      {ll ? (
                                        <div className="space-y-1">
                                          {geoAddress.formattedAddress ? (
                                            <div className="text-[10px] text-slate-600 dark:text-slate-300 break-words">
                                              <span className="font-semibold">Endereço:</span> {geoAddress.formattedAddress}
                                            </div>
                                          ) : (
                                            <ExpandableStreetCell lat={ll.lat} lng={ll.lng} previewMaxLength={28} />
                                          )}
                                          {(!geoAddress.formattedAddress ||
                                            shouldRenderStreetSeparately(geoAddress.formattedAddress, geoAddress.street)) &&
                                            geoAddress.street && (
                                              <div className="text-[10px] text-slate-500 dark:text-slate-400 break-words">
                                                <span className="font-semibold">Rua:</span> {geoAddress.street}
                                              </div>
                                            )}
                                          {geoAddress.district && (
                                            <div className="text-[10px] text-slate-500 dark:text-slate-400 break-words">
                                              <span className="font-semibold">Bairro:</span> {geoAddress.district}
                                            </div>
                                          )}
                                          {geoAddress.postalCode && (
                                            <div className="text-[10px] text-slate-500 dark:text-slate-400 break-words">
                                              <span className="font-semibold">CEP:</span> {geoAddress.postalCode}
                                            </div>
                                          )}
                                          {(geoAddress.city || geoAddress.state) && (
                                            <div className="text-[10px] text-slate-500 dark:text-slate-400 break-words">
                                              <span className="font-semibold">Cidade/UF:</span> {geoAddress.city ?? ''}
                                              {geoAddress.state ? `/${geoAddress.state}` : ''}
                                            </div>
                                          )}
                                          <div className="text-[10px] text-slate-500 dark:text-slate-400 tabular-nums">
                                            GPS: {ll.lat.toFixed(6)}, {ll.lng.toFixed(6)}
                                          </div>
                                          <div className="flex flex-wrap gap-1 text-[10px]">
                                            <span className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200">
                                              Precisao: {Number.isFinite(accuracy) ? `${Math.round(accuracy)}m` : 'N/D'}
                                            </span>
                                            <span className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200">
                                              Provider: {provider}
                                            </span>
                                            {capturedAt && (
                                              <span className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200">
                                                Captura: {new Date(capturedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                                              </span>
                                            )}
                                            {Number.isFinite(accuracy) && accuracy > 300 && (
                                              <span className="px-1.5 py-0.5 rounded bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300">
                                                Baixa precisao GPS
                                              </span>
                                            )}
                                            {Number.isFinite(accuracy) && accuracy > 100 && accuracy <= 300 && (
                                              <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
                                                Localizacao aproximada
                                              </span>
                                            )}
                                          </div>
                                        </div>
                                      ) : resolvePunchOrigin(r).kind === 'rep' ? (
                                        <span className="text-slate-500 dark:text-slate-400">GPS não se aplica (Relógio REP)</span>
                                      ) : (
                                        <span className="text-slate-500 dark:text-slate-400">Batida sem GPS</span>
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </>
        ) : null}
        {!loadingData && !periodValid && !periodStart && !periodEnd && (
          <p className="p-8 text-center text-slate-500 dark:text-slate-400">
            Selecione o período (início e fim) para visualizar o espelho de ponto.
          </p>
        )}
      </div>
      {periodValid && !loadingData && (() => {
        const daysWithIssues = periodDates
          .map((date) => ({ date, day: empMirror.get(date) }))
          .filter(
            (x) =>
              x.day &&
              (x.day.batidasExtra.length > 0 ||
                x.day.inconsistencias.length > 0 ||
                (repPendingByDate.get(x.date)?.length ?? 0) > 0),
          );
        if (daysWithIssues.length === 0) return null;
        return (
          <section className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white/80 dark:bg-slate-900/80 shadow-sm p-4">
            <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100 mb-3">
              Ocorrências (extras e inconsistências)
            </h3>
            <div className="space-y-2">
              {daysWithIssues.map(({ date, day }) => {
                if (!day) return null;
                const fmt = (iso: string) =>
                  new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', hour12: false });
                const fmtRecord = (r: MirrorTimeRecord) => fmt(recordEffectiveMirrorInstant(r, date));
                const issueLabel = (r: MirrorTimeRecord) => `${fmtRecord(r)} · ${resolvePunchOrigin(r).label}`;
                const extraLabels = day.batidasExtra.map(issueLabel);
                const inconsistLabels = day.inconsistencias.map(issueLabel);
                const repPend = repPendingByDate.get(date) ?? [];
                return (
                  <div key={`issue-${date}`} className="rounded-xl border border-slate-200 dark:border-slate-700 p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-slate-700 dark:text-slate-200">{formatDateBR(date)}</span>
                      {extraLabels.length > 0 && (
                        <span className="inline-flex px-2 py-0.5 rounded text-[10px] font-semibold bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300">
                          Extra: {extraLabels.length}
                        </span>
                      )}
                      {inconsistLabels.length > 0 && (
                        <span className="inline-flex px-2 py-0.5 rounded text-[10px] font-semibold bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">
                          Incons.: {inconsistLabels.length}
                        </span>
                      )}
                      {repPend.length > 0 && (
                        <span className="inline-flex px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
                          REP pend.: {repPend.length}
                        </span>
                      )}
                      <button
                        type="button"
                        className="text-xs font-semibold text-indigo-600 dark:text-indigo-300 hover:underline"
                        onClick={() =>
                          setIssuesModal({
                            date,
                            extras: extraLabels,
                            inconsistencias: inconsistLabels,
                            repPending: repPend,
                          })
                        }
                      >
                        Ver lista completa
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        );
      })()}

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
          if (user?.id && companyId) invalidateAfterPunch(user.id, companyId);
          setRefreshNonce((n) => n + 1);
        }}
        readOnly={!canEditManualAsHr}
      />
      {issuesModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
          onClick={() => setIssuesModal(null)}
        >
          <div
            className="w-full max-w-2xl rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
              <h3 className="font-semibold text-slate-900 dark:text-slate-100">
                Detalhes de extras/inconsistências - {formatDateBR(issuesModal.date)}
              </h3>
              <button
                type="button"
                className="text-sm text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
                onClick={() => setIssuesModal(null)}
              >
                Fechar
              </button>
            </div>
            <div className="p-4 space-y-4 max-h-[70vh] overflow-auto">
              <div>
                <h4 className="text-sm font-semibold text-purple-700 dark:text-purple-300 mb-1">
                  Batidas extras ({issuesModal.extras.length})
                </h4>
                {issuesModal.extras.length === 0 ? (
                  <p className="text-sm text-slate-500 dark:text-slate-400">Nenhuma batida extra.</p>
                ) : (
                  <ul className="space-y-1 text-sm text-slate-700 dark:text-slate-300">
                    {issuesModal.extras.map((item, idx) => (
                      <li key={`extra-${idx}`}>- {item}</li>
                    ))}
                  </ul>
                )}
              </div>
              <div>
                <h4 className="text-sm font-semibold text-rose-700 dark:text-rose-300 mb-1">
                  Inconsistências ({issuesModal.inconsistencias.length})
                </h4>
                {issuesModal.inconsistencias.length === 0 ? (
                  <p className="text-sm text-slate-500 dark:text-slate-400">Nenhuma inconsistência.</p>
                ) : (
                  <ul className="space-y-1 text-sm text-slate-700 dark:text-slate-300">
                    {issuesModal.inconsistencias.map((item, idx) => (
                      <li key={`incons-${idx}`}>- {item}</li>
                    ))}
                  </ul>
                )}
              </div>
              <div>
                <h4 className="text-sm font-semibold text-amber-800 dark:text-amber-200 mb-1">
                  Batidas REP pendentes ({issuesModal.repPending.length})
                </h4>
                <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">
                  Registos no REP ainda sem time_record no espelho — não entram no total até consolidar.
                </p>
                {issuesModal.repPending.length === 0 ? (
                  <p className="text-sm text-slate-500 dark:text-slate-400">Nenhuma batida REP pendente neste dia.</p>
                ) : (
                  <ul className="space-y-2 text-sm text-slate-700 dark:text-slate-300">
                    {issuesModal.repPending.map((p) => (
                      <li key={p.id} className="border-t border-slate-200 dark:border-slate-700 first:border-0 first:pt-0 pt-2">
                        <div className="flex flex-wrap gap-x-2 gap-y-0.5">
                          <span className="font-mono text-xs">
                            {new Date(p.data_hora).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
                          </span>
                          {p.nsr != null && <span className="text-xs text-slate-500">NSR {String(p.nsr)}</span>}
                          <span className="text-xs text-slate-500">{p.source ?? '—'}</span>
                          <span className="text-xs">{p.tipo_marcacao ?? '—'}</span>
                        </div>
                        {(p.promotion_error_code || p.promotion_error_message) && (
                          <p className="text-xs text-rose-600 dark:text-rose-400 mt-0.5">
                            {p.promotion_error_code ? `${p.promotion_error_code}: ` : ''}
                            {p.promotion_error_message ?? ''}
                          </p>
                        )}
                        {p.promotion_attempts != null && (
                          <p className="text-[11px] text-slate-500 mt-0.5">Tentativas: {p.promotion_attempts}</p>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default EmployeeTimesheet;
