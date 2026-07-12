import { observabilityConsole } from '../../shared/logger/observabilityConsole';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { db, isSupabaseConfigured, supabase } from '../../services/supabaseClient';
import { insertAdminMirrorTimeRecord } from '../../../services/timeRecords.service';
import { buscarEspelhoAdmin, buscarFiltrosEspelhoAdmin } from '../../../services/api';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { useToast } from '../../components/ToastProvider';
import PageHeader from '../../components/PageHeader';
import { LoadingState, Button } from '../../../components/UI';
import { ChevronDown, ChevronRight, FileDown, FileSpreadsheet, Lock, Plus, RefreshCw, Unlock, Upload } from 'lucide-react';
import { AddTimeRecordModal } from '../../components/AddTimeRecordModal';
import { EditTimeRecordModal } from '../../components/EditTimeRecordModal';
import { SkeletonFiltro, TimesheetTableSkeleton } from '../../components/TimesheetTableSkeleton';
import {
  buildDayMirrorSummary,
  DayMirror,
  resolveMirrorSlotRecord,
  isEditableManualMirrorRecord,
  isManualRecord,
  isRepMirrorRecord,
  isStatusRecord,
  formatMinutes,
  getDayStatus,
  normalizeRecordTypeForMirror,
  recordEffectiveMirrorInstant,
  type DayScheduleSlots,
} from '../../utils/timesheetMirror';
import {
  expectedMinutesFromDayWindow,
  getEmployeeTimesheetScheduleContext,
  type DayExpectedWindow,
} from '../../services/timeProcessingService';
import type { DayScheduleWindow } from '../../utils/timesheetMirror';
import { recalculate_period } from '../../engine/timeEngine';
import { closeTimesheet, isTimesheetClosed, reopenTimesheet } from '../../services/timeProcessingService';
import { appendTimeAttendanceTimelineEvent } from '../../services/timeAttendanceTimeline.service';
import {
  TimeAttendanceTimelineEventType,
  TimeAttendanceTimelineSeverity,
} from '../../services/timeAttendanceTimeline.constants';
import {
  getTimeAttendanceAuditSummary,
  ALERT_THRESHOLDS,
  isRepPunchEligibleForAssistedSequenceReconciliation,
  type PendingRepPunch,
} from '../../services/timeAttendanceData';
import { RepPendingSequenceResolutionModal } from '../../components/RepPendingSequenceResolutionModal';
import { DayIssuesModal } from './timesheet/DayIssuesModal';
import { PeriodCalculationHealthSection } from './timesheet/PeriodCalculationHealthSection';
import {
  invalidateAfterPunch,
  invalidateAfterTimesheetMonthClose,
  invalidateCompanyListCaches,
} from '../../services/queryCache';
import { enumerateLocalCalendarDays } from '../../utils/localDateTimeToIso';
import { sameUserId } from '../../utils/userIdMatch';
import { resolvePunchOrigin } from '../../utils/punchOrigin';
import {
  generateProfessionalTimesheetPDF,
  convertDayMirrorToRecords,
  calculateHoursSummary,
  generateDocumentHash,
  type CompanyData,
  type EmployeeData,
} from '../../services/professionalPDF.service';
import { LoggingService } from '../../../services/loggingService';
import { LogSeverity } from '../../../types';
import {
  fetchRepPendingByDate,
  fetchTimesheetsDailyUiByDate,
  type TimesheetDailyMirrorRow,
} from '../../services/adminTimesheetData.service';
import { GeoDetailsToggle } from './timesheet/GeoDetailsToggle';
import {
  collectDayJustification,
  computeMirrorNetOvertime,
  extractAdjustmentMetaFromRequest,
  formatSignedOvertimeDisplay,
  parseTimesheetDailyOvertime,
  shouldShowMirrorOvertimeEstimate,
  type ApprovedAdjustmentJustification,
} from '../../utils/timesheetMirrorExtras';
import {
  computePeriodHealthSummary,
  deriveOperationalDisplayStatus,
  mapProcessingStatusToLabel,
  operationalBadgeVariant,
  operationalBadgeClassName,
  operationalStatusTooltip,
  type OperationalDisplayStatus,
} from '../../utils/timesheetOperationalUx';

/** Espelho: tooltip único quando a folha do período está fechada (coerente com bloqueio no banco/API). */
const TOOLTIP_PERIODO_FECHADO_HARD_LOCK =
  'Período fechado. Reabra oficialmente para editar/importar batidas.';

const WEEKDAY_LABELS = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB'] as const;

import { adminTimesheetFiltersKey } from '../../utils/adminTimesheetFilters';
function localDateKey(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Meses civis de `startYmd` a `endYmd` (YYYY-MM-DD), inclusive, em ordem cronológica. */
function civilMonthsInclusive(startYmd: string, endYmd: string): { year: number; month: number }[] {
  const a = String(startYmd).slice(0, 10);
  const b = String(endYmd).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(a) || !/^\d{4}-\d{2}-\d{2}$/.test(b) || a > b) return [];
  const sy = Number(a.slice(0, 4));
  const sm = Number(a.slice(5, 7));
  const ey = Number(b.slice(0, 4));
  const em = Number(b.slice(5, 7));
  if (!sy || !sm || !ey || !em || sm < 1 || sm > 12 || em < 1 || em > 12) return [];
  const out: { year: number; month: number }[] = [];
  let y = sy;
  let mo = sm;
  while (y < ey || (y === ey && mo <= em)) {
    out.push({ year: y, month: mo });
    if (y === ey && mo === em) break;
    mo += 1;
    if (mo > 12) {
      mo = 1;
      y += 1;
    }
  }
  return out;
}

function mergeClosedMonth(
  prev: { year: number; month: number }[],
  year: number,
  month: number,
): { year: number; month: number }[] {
  if (prev.some((x) => x.year === year && x.month === month)) return prev;
  return [...prev, { year, month }].sort((x, y) => x.year - y.year || x.month - y.month);
}

type AdminEmployee = {
  id: string;
  nome: string;
  email?: string | null;
  department_id?: string | null;
  role?: string;
  record_user_ids?: string[];
};

/** Célula sem batida (pedido de UX). */
const EMPTY_DASH = '----';
const TIMESHEET_ROW_ESTIMATED_HEIGHT = 52;
const TIMESHEET_OVERSCAN = 12;

type TimeRecord = {
  id: string;
  user_id: string;
  created_at: string;
  timestamp?: string | null;
  type: 'entrada' | 'saida' | 'intervalo_saida' | 'intervalo_volta';
  manual_reason?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  accuracy?: number | null;
  location?: unknown;
  raw_data?: unknown;
  metadata?: unknown;
  is_manual?: boolean;
  source?: string | null;
  method?: string | null;
  origin?: string | null;
  source_type?: string | null;
};

type DayIssuesModalState = {
  date: string;
  extras: string[];
  inconsistencias: string[];
  repPending: PendingRepPunch[];
} | null;

const AdminTimesheet: React.FC = () => {
  const { user, loading } = useCurrentUser();
  const toast = useToast();
  const location = useLocation();

  const [employees, setEmployees] = useState<AdminEmployee[]>([]);
  const [departments, setDepartments] = useState<{ id: string; name: string }[]>([]);
  const [records, setRecords] = useState<TimeRecord[]>([]);
  const [holidays, setHolidays] = useState<{ id: string; date: string; name: string }[]>([]);
  const [loadingEspelho, setLoadingEspelho] = useState(false);
  const [recalculatingEspelho, setRecalculatingEspelho] = useState(false);
  const [loadingFiltros, setLoadingFiltros] = useState(false);
  const [scheduleWorkDays, setScheduleWorkDays] = useState<number[] | null>(null);
  const [scheduleWindowsByDow, setScheduleWindowsByDow] = useState<Record<number, DayScheduleWindow | null> | null>(
    null,
  );

  const [filterUserId, setFilterUserId] = useState('');
  const [filterDepartmentId, setFilterDepartmentId] = useState('');
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');
  const [recordTypeFilter, setRecordTypeFilter] = useState<'all' | 'manual' | 'normal'>('all');
  const todayMax = useMemo(() => localDateKey(), []);

  const periodValid =
    Boolean(periodStart && periodEnd && periodStart <= periodEnd && periodEnd <= todayMax && periodStart <= todayMax);

  const companyId = user?.companyId || user?.company_id;

  const [closingMonth, setClosingMonth] = useState(() => {
    const n = new Date();
    return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}`;
  });
  const [closingLoading, setClosingLoading] = useState(false);
  const [reopenLoading, setReopenLoading] = useState(false);
  /** Meses civis no intervalo do espelho que têm fecho oficial (pode ser >1; ex. abr–mai com só mai fechado). */
  const [closedMonthsInView, setClosedMonthsInView] = useState<{ year: number; month: number }[]>([]);
  const periodClosedLock = closedMonthsInView.length > 0;

  /** Linhas `timesheets_daily` do período (UX auditoria / badges). */
  const [dailyCalcUiByDate, setDailyCalcUiByDate] = useState<Map<string, TimesheetDailyMirrorRow>>(
    () => new Map(),
  );
  const [approvedAdjustments, setApprovedAdjustments] = useState<ApprovedAdjustmentJustification[]>([]);
  /** Admin: permite fechar apesar de inconsistent/error operacional no período. */
  const [adminCloseOverride, setAdminCloseOverride] = useState(false);

  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [recordToEdit, setRecordToEdit] = useState<TimeRecord | null>(null);
  const [issuesModal, setIssuesModal] = useState<DayIssuesModalState>(null);
  const [detailOpenByDate, setDetailOpenByDate] = useState<Record<string, boolean>>({});
  const [timesheetScrollTop, setTimesheetScrollTop] = useState(0);
  const timesheetScrollRef = useRef<HTMLDivElement | null>(null);

  /** Evita `loadEspelho` com período vazio antes de ler sessionStorage (caso típico: novo login → batidas “sumiam”). */
  const [filtersHydrated, setFiltersHydrated] = useState(false);

  /** Batidas REP com colaborador resolvido ainda sem `time_record` no período (reconciliação de sequência). */
  const [repPendingReconciliationCount, setRepPendingReconciliationCount] = useState<number | null>(null);
  const [repPendingByDate, setRepPendingByDate] = useState<Map<string, PendingRepPunch[]>>(() => new Map());
  const [repSeqModalDate, setRepSeqModalDate] = useState<string | null>(null);
  const [repSeqRefreshKey, setRepSeqRefreshKey] = useState(0);

  const holidayDates = useMemo(() => new Set(holidays.map((h) => h.date).filter(Boolean)), [holidays]);

  const expectedWindowForYmd = useCallback(
    (dateStr: string): DayScheduleWindow | null | undefined => {
      if (!scheduleWindowsByDow) return undefined;
      const dow = new Date(`${dateStr}T12:00:00`).getDay();
      return scheduleWindowsByDow[dow];
    },
    [scheduleWindowsByDow],
  );

  useEffect(() => {
    if (!filterUserId || !companyId || !isSupabaseConfigured()) {
      setScheduleWorkDays(null);
      setScheduleWindowsByDow(null);
      return;
    }
    let active = true;
    (async () => {
      const ctx = await getEmployeeTimesheetScheduleContext(filterUserId, companyId);
      if (active) {
        setScheduleWorkDays(ctx.workDays?.length ? ctx.workDays : null);
        setScheduleWindowsByDow(ctx.windowByJsDow);
      }
    })();
    return () => {
      active = false;
    };
  }, [filterUserId, companyId]);

  /** Catálogo (colaboradores + departamentos) — não depende do período; evita selects vazios. */
  const loadFiltrosEspelho = useCallback(async () => {
    if (!companyId || !isSupabaseConfigured()) return;
    setLoadingFiltros(true);
    try {
      const f = await buscarFiltrosEspelhoAdmin(companyId);
      setEmployees(f.employees);
      setDepartments(f.departments);
    } catch (e) {
      observabilityConsole.error(e);
      toast.addToast('error', 'Não foi possível carregar colaboradores e departamentos.');
    } finally {
      setLoadingFiltros(false);
    }
  }, [companyId, toast]);

  useEffect(() => {
    void loadFiltrosEspelho();
  }, [loadFiltrosEspelho]);

  /** Restaura período/colaborador após sair e voltar ao sistema (estado React começa vazio). */
  useEffect(() => {
    if (!user?.id) {
      setFiltersHydrated(false);
      return;
    }
    try {
      const params = new URLSearchParams(window.location.search);
      const qUser = (params.get('user_id') || params.get('user'))?.trim() ?? '';
      const qDate = params.get('date');
      const hasUserDeepLink = qUser.length > 0;
      const hasDateDeepLink =
        typeof qDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(qDate);

      if (hasUserDeepLink) {
        setFilterUserId(qUser);
        if (hasDateDeepLink) {
          const y = Number(qDate.slice(0, 4));
          const m = Number(qDate.slice(5, 7));
          if (Number.isFinite(y) && Number.isFinite(m) && m >= 1 && m <= 12) {
            const start = `${qDate.slice(0, 4)}-${qDate.slice(5, 7)}-01`;
            const lastDay = new Date(y, m, 0).getDate();
            const end = `${qDate.slice(0, 4)}-${qDate.slice(5, 7)}-${String(lastDay).padStart(2, '0')}`;
            setPeriodStart(start);
            setPeriodEnd(end);
          }
        }
        try {
          const u = new URL(window.location.href);
          u.searchParams.delete('user_id');
          u.searchParams.delete('user');
          u.searchParams.delete('date');
          window.history.replaceState({}, '', `${u.pathname}${u.search}${u.hash}`);
        } catch (error) {
          void error;
        }
      } else {
        const raw = sessionStorage.getItem(adminTimesheetFiltersKey(user.id));
        if (raw) {
          const s = JSON.parse(raw) as {
            periodStart?: string;
            periodEnd?: string;
            filterUserId?: string;
            filterDepartmentId?: string;
          };
          if (typeof s.periodStart === 'string' && s.periodStart) setPeriodStart(s.periodStart);
          if (typeof s.periodEnd === 'string' && s.periodEnd) setPeriodEnd(s.periodEnd);
          if (typeof s.filterUserId === 'string') setFilterUserId(s.filterUserId);
          if (typeof s.filterDepartmentId === 'string') setFilterDepartmentId(s.filterDepartmentId);
        }
      }
    } catch (error) {
      void error;
    }
    setFiltersHydrated(true);
  }, [user?.id]);

  /** Deep link de colaborador enquanto a página já está montada (ex.: busca do cabeçalho). */
  useEffect(() => {
    if (!user?.id || !filtersHydrated) return;
    const params = new URLSearchParams(location.search);
    const qUser = (params.get('user_id') || params.get('user'))?.trim();
    if (!qUser) return;

    setFilterUserId(qUser);
    try {
      const u = new URL(window.location.href);
      u.searchParams.delete('user_id');
      u.searchParams.delete('user');
      window.history.replaceState({}, '', `${u.pathname}${u.search}${u.hash}`);
    } catch (error) {
      void error;
    }
  }, [location.search, user?.id, filtersHydrated]);

  /** Alinha “mês a fechar” com o início do período visível (mês civil único). */
  useEffect(() => {
    if (!periodValid || !periodStart || periodStart.length < 7) return;
    setClosingMonth(periodStart.slice(0, 7));
  }, [periodValid, periodStart]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (
        !companyId ||
        !filterUserId ||
        !periodValid ||
        !periodStart ||
        periodStart.length < 10 ||
        !periodEnd ||
        periodEnd.length < 10
      ) {
        if (!cancelled) setClosedMonthsInView([]);
        return;
      }
      const start = periodStart.slice(0, 10);
      const end = periodEnd.slice(0, 10);
      const months = civilMonthsInclusive(start, end);
      if (months.length === 0) {
        if (!cancelled) setClosedMonthsInView([]);
        return;
      }
      try {
        const flags = await Promise.all(
          months.map(({ year, month }) => isTimesheetClosed(companyId, month, year, filterUserId)),
        );
        if (cancelled) return;
        const closed = months.filter((_, i) => flags[i]);
        setClosedMonthsInView(closed);
      } catch (error) {
        void error;
        if (!cancelled) setClosedMonthsInView([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [companyId, filterUserId, periodStart, periodEnd, periodValid]);

  /** Persiste filtros para o próximo acesso. */
  useEffect(() => {
    if (!user?.id || !filtersHydrated) return;
    try {
      sessionStorage.setItem(
        adminTimesheetFiltersKey(user.id),
        JSON.stringify({
          periodStart,
          periodEnd,
          filterUserId,
          filterDepartmentId,
        }),
      );
    } catch (error) {
      void error;
    }
  }, [user?.id, filtersHydrated, periodStart, periodEnd, filterUserId, filterDepartmentId]);

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
      const data = await buscarEspelhoAdmin(companyId, periodStart, periodEnd, filterUserId);
      setEmployees(data.employees ?? []);
      setDepartments(data.departments ?? []);
      setRecords((data.records ?? []) as TimeRecord[]);
      setHolidays(data.holidays ?? []);
    } catch (e) {
      observabilityConsole.error(e);
      toast.addToast('error', 'Não foi possível carregar o espelho de ponto.');
    } finally {
      setLoadingEspelho(false);
    }
  }, [companyId, filterUserId, periodStart, periodEnd, periodValid, toast]);

  useEffect(() => {
    if (!filtersHydrated) return;
    void loadEspelho();
  }, [loadEspelho, filtersHydrated]);

  useEffect(() => {
    if (!filtersHydrated || !periodValid || !filterUserId || !companyId || !isSupabaseConfigured()) {
      setRepPendingReconciliationCount(null);
      setRepPendingByDate(new Map());
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const { byDate, count } = await fetchRepPendingByDate(supabase, {
          companyId,
          employeeId: filterUserId,
          periodStart,
          periodEnd,
        });
        if (cancelled) return;
        setRepPendingByDate(byDate);
        setRepPendingReconciliationCount(count);
      } catch (error) {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : String(error);
        setRepPendingReconciliationCount(null);
        setRepPendingByDate(new Map());
        observabilityConsole.warn('[Espelho] rep_punch_logs pendentes:', message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [filtersHydrated, periodValid, filterUserId, companyId, periodStart, periodEnd, repSeqRefreshKey]);

  const filteredEmployees = useMemo(() => {
    return employees.filter((emp) => {
      if (filterDepartmentId && emp.department_id !== filterDepartmentId) return false;
      return true;
    });
  }, [employees, filterDepartmentId]);

  const selectedRecordUserIds = useMemo(() => {
    if (!filterUserId) return [];
    const selected = employees.find((employee) => sameUserId(employee.id, filterUserId));
    const ids = selected?.record_user_ids?.length ? selected.record_user_ids : [filterUserId];
    return ids.filter(Boolean);
  }, [employees, filterUserId]);

  const displayRecords = useMemo(() => {
    if (!filterUserId) return [];
    const byUser = records.filter((r) => selectedRecordUserIds.some((id) => sameUserId(r.user_id, id)));
    if (recordTypeFilter === 'all') return byUser;
    if (recordTypeFilter === 'manual') return byUser.filter((r) => isManualRecord(r));
    return byUser.filter((r) => !isManualRecord(r));
  }, [records, filterUserId, selectedRecordUserIds, recordTypeFilter]);

  const empMirror = useMemo(() => {
    if (!periodValid) return new Map<string, DayMirror>();
    const scheduleByDay = (date: string): DayScheduleSlots | null => {
      const win = expectedWindowForYmd(date);
      if (!win) return null;
      const [eh = '08', em = '00'] = String(win.entrada || '08:00').split(':');
      const [sh = '17', sm = '00'] = String(win.saida || '17:00').split(':');
      const entrada = `${String(eh).padStart(2, '0')}:${String(em).padStart(2, '0')}`;
      const saida_final = `${String(sh).padStart(2, '0')}:${String(sm).padStart(2, '0')}`;
      const saida_intervalo = win.saida_intervalo || '12:00';
      const volta_intervalo = win.volta_intervalo || '14:00';
      return {
        entrada,
        saida_intervalo,
        volta_intervalo,
        saida_final,
        toleranceMin: win.toleranceMin ?? 60,
      };
    };
    return buildDayMirrorSummary(displayRecords, periodStart, periodEnd, { scheduleByDay });
  }, [displayRecords, periodStart, periodEnd, periodValid, expectedWindowForYmd]);

  const periodDates = useMemo(() => {
    if (!periodValid) return [];
    return enumerateLocalCalendarDays(periodStart, periodEnd);
  }, [periodStart, periodEnd, periodValid]);

  useEffect(() => {
    setAdminCloseOverride(false);
  }, [periodStart, periodEnd, filterUserId]);

  const refreshDailyCalc = useCallback(async () => {
    if (!filtersHydrated || !periodValid || !filterUserId || !companyId || !isSupabaseConfigured()) {
      setDailyCalcUiByDate(new Map());
      return;
    }
    const map = await fetchTimesheetsDailyUiByDate(supabase, {
      companyId,
      employeeId: filterUserId,
      periodStart,
      periodEnd,
    });
    setDailyCalcUiByDate(map);
  }, [filtersHydrated, periodValid, filterUserId, companyId, periodStart, periodEnd]);

  useEffect(() => {
    if (!filtersHydrated || !periodValid || !filterUserId || !companyId || !isSupabaseConfigured()) {
      setDailyCalcUiByDate(new Map());
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        await refreshDailyCalc();
      } catch (error) {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : String(error);
        observabilityConsole.warn('[Espelho] timesheets_daily:', message);
        setDailyCalcUiByDate(new Map());
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [filtersHydrated, periodValid, filterUserId, companyId, periodStart, periodEnd, refreshDailyCalc]);

  const handleRefreshEspelho = useCallback(async () => {
    if (!companyId || !periodValid || !filterUserId || !isSupabaseConfigured()) return;
    invalidateCompanyListCaches(companyId);
    setRecalculatingEspelho(true);
    try {
      await loadEspelho();
      await recalculate_period(filterUserId, companyId, periodStart, periodEnd);
      await refreshDailyCalc();
      toast.addToast('success', 'Batidas atualizadas e cálculos do período recalculados.');
    } catch (error) {
      observabilityConsole.error('[Espelho] atualizar + recalcular:', error);
      try {
        await refreshDailyCalc();
      } catch {
        /* mantém mapa anterior */
      }
      const message = error instanceof Error ? error.message : 'Falha ao recalcular o período.';
      toast.addToast(
        'error',
        message.length > 180 ? `${message.slice(0, 177)}…` : message,
      );
    } finally {
      setRecalculatingEspelho(false);
    }
  }, [
    companyId,
    periodValid,
    filterUserId,
    periodStart,
    periodEnd,
    loadEspelho,
    refreshDailyCalc,
    toast,
  ]);

  useEffect(() => {
    if (!filtersHydrated || !periodValid || !filterUserId || !companyId || !isSupabaseConfigured()) {
      setApprovedAdjustments([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const rows = (await db.select('requests', [
          { column: 'user_id', operator: 'eq', value: filterUserId },
          { column: 'company_id', operator: 'eq', value: companyId },
          { column: 'status', operator: 'eq', value: 'approved' },
          { column: 'type', operator: 'eq', value: 'adjustment' },
        ])) as Record<string, unknown>[];
        if (cancelled) return;
        const parsed = rows
          .map((row) => extractAdjustmentMetaFromRequest(row))
          .filter((item): item is ApprovedAdjustmentJustification => item != null)
          .filter((item) => item.adjustment_date >= periodStart && item.adjustment_date <= periodEnd);
        setApprovedAdjustments(parsed);
      } catch {
        if (!cancelled) setApprovedAdjustments([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [filtersHydrated, periodValid, filterUserId, companyId, periodStart, periodEnd]);

  const operationalStatusesForPeriod = useMemo(() => {
    const list: OperationalDisplayStatus[] = [];
    for (const d of periodDates) {
      const ui = dailyCalcUiByDate.get(d);
      if (!ui) continue;
      list.push(
        deriveOperationalDisplayStatus({
          processing_status: ui.processing_status,
          replay_status: ui.replay_status,
          has_drift: ui.has_drift,
        }),
      );
    }
    return list;
  }, [periodDates, dailyCalcUiByDate]);

  const periodHealthSummary = useMemo(
    () => computePeriodHealthSummary(operationalStatusesForPeriod),
    [operationalStatusesForPeriod],
  );

  const periodOperationalBlocked = useMemo(
    () => operationalStatusesForPeriod.some((s) => s === 'inconsistent' || s === 'error'),
    [operationalStatusesForPeriod],
  );

  const periodHasDrift = useMemo(
    () => periodDates.some((d) => dailyCalcUiByDate.get(d)?.has_drift),
    [periodDates, dailyCalcUiByDate],
  );

  const closeBlockedByOperational = Boolean(
    periodOperationalBlocked && !(user?.role === 'admin' && adminCloseOverride),
  );

  /** Só o mês em «Mês a fechar» — pode haver outro mês fechado no mesmo intervalo (ex. mai fech., abr aberto). */
  const closingMonthIsClosed = useMemo(() => {
    const parts = closingMonth.split('-').map(Number);
    const yy = parts[0];
    const mo = parts[1];
    if (!yy || !mo) return false;
    return closedMonthsInView.some((x) => x.year === yy && x.month === mo);
  }, [closingMonth, closedMonthsInView]);

  const formatDateBR = (dateStr: string) => {
    const [y, m, day] = dateStr.split('-');
    return `${day}/${m}/${y}`;
  };

  const formatWeekdayBR = (dateStr: string) => {
    const [y, m, day] = dateStr.split('-').map(Number);
    if (!y || !m || !day) return '';
    return WEEKDAY_LABELS[new Date(y, m - 1, day).getDay()] ?? '';
  };

  const renderWeekdayCell = (dateStr: string) => {
    const weekday = formatWeekdayBR(dateStr);
    return weekday ? (
      <span className="inline-flex min-w-9 justify-center rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-600 dark:bg-slate-800 dark:text-slate-300">
        {weekday}
      </span>
    ) : (
      EMPTY_DASH
    );
  };

  const handleAddRecord = async (data: {
    user_id: string;
    created_at: string;
    type: string;
    manual_reason?: string;
    mirror_date_ymd?: string;
    latitude?: number;
    longitude?: number;
  }) => {
    const cid = String(companyId ?? '').trim();
    if (!cid) return;
    if (periodClosedLock) {
      toast.addToast('error', 'Período fechado. Não é possível incluir batidas.');
      return;
    }

    const buildMergeRow = (id: string, createdIso: string): TimeRecord => ({
      id,
      user_id: data.user_id,
      created_at: createdIso,
      type: data.type as TimeRecord['type'],
      manual_reason: data.manual_reason,
      latitude: data.latitude,
      longitude: data.longitude,
      is_manual: true,
    });

    const isMonotonicBlockError = (msg: string): boolean =>
      msg.includes('SQL MONOTONIC BLOCK') || msg.includes('last_event_at regression');

    try {
      const { id: mergeId, createdAt: mergeCreated } = await insertAdminMirrorTimeRecord(
        { ...data },
        cid,
      );
      const mergeRow = buildMergeRow(mergeId, mergeCreated);

      toast.addToast('success', 'Batida adicionada com sucesso.');
      await LoggingService.log({
        severity: LogSeverity.SECURITY,
        action: 'ADMIN_ADD_TIME_RECORD',
        userId: user?.id,
        userName: user?.nome,
        companyId: cid,
        details: {
          employeeId: data.user_id,
          recordId: mergeId,
          type: data.type,
          created_at: data.created_at,
          source: 'admin_timesheet',
        },
      });
      setShowAddModal(false);
      await loadEspelho();
      if (mergeRow && mergeId) {
        setRecords((prev) => {
          if (prev.some((r) => r.id === mergeId)) return prev;
          return [...prev, mergeRow!].sort(
            (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
          );
        });
      }
      invalidateAfterPunch(data.user_id, cid);
    } catch (err) {
      observabilityConsole.error('[TIME RECORD ERROR]', err);
      const msg = err instanceof Error ? err.message : 'Erro ao adicionar batida.';
      if (isMonotonicBlockError(msg)) {
        const confirmed = window.confirm(
          'Esta batida e anterior a ultima registrada. Deseja inserir mesmo assim?',
        );
        if (confirmed) {
          try {
            const { id: mergeId, createdAt: mergeCreated } = await insertAdminMirrorTimeRecord(
              { ...data },
              cid,
              { allowOutOfOrder: true, rpcSource: 'manual_out_of_order' },
            );
            const mergeRow = buildMergeRow(mergeId, mergeCreated);
            toast.addToast('success', 'Batida retroativa adicionada com sucesso.');
            setShowAddModal(false);
            await loadEspelho();
            if (mergeRow && mergeId) {
              setRecords((prev) => {
                if (prev.some((r) => r.id === mergeId)) return prev;
                return [...prev, mergeRow!].sort(
                  (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
                );
              });
            }
            invalidateAfterPunch(data.user_id, cid);
            return;
          } catch (retryErr) {
            const retryMsg =
              retryErr instanceof Error ? retryErr.message : 'Erro ao inserir batida retroativa.';
            toast.addToast('error', retryMsg.length > 180 ? `${retryMsg.slice(0, 177)}…` : retryMsg);
            return;
          }
        }
      }
      toast.addToast('error', msg.length > 180 ? `${msg.slice(0, 177)}…` : msg);
    }
  };

  const handleExportCSV = () => {
    if (!filterUserId || !periodValid) return;
    const emp = employees.find((e) => e.id === filterUserId);
    const rows: string[] = [
      'Data,Colaborador,Entrada,Saída Intervalo,Volta Intervalo,Saída,Horas trabalhadas',
    ];
    for (const date of periodDates) {
      const day = empMirror.get(date);
      if (!day) continue;
      const dash = (v: string | null | undefined) => (v != null && String(v).trim() !== '' ? v : EMPTY_DASH);
      rows.push(
        [
          formatDateBR(date),
          emp?.nome || '',
          dash(day.entradaInicio),
          dash(day.saidaIntervalo),
          dash(day.voltaIntervalo),
          dash(day.saidaFinal),
          day.workedMinutes > 0 ? formatMinutes(day.workedMinutes) : EMPTY_DASH,
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

  const handleExportPDF = async () => {
    if (!filterUserId || !periodValid) {
      toast.addToast('error', 'Selecione um colaborador e período válido.');
      return;
    }

    try {
      setLoadingEspelho(true);

      const employee = employees.find(e => e.id === filterUserId);
      const dept = departments.find(d => d.id === employee?.department_id);

      // Dados da empresa
      const companyData: CompanyData = {
        nome: user?.nome || user?.company_name || 'Empresa',
        cnpj: user?.company_cnpj,
        endereco: user?.company_address,
      };

      // Dados do funcionário
      const employeeData: EmployeeData = {
        id: filterUserId,
        nome: employee?.nome || 'Funcionário',
        cpf: employee?.cpf,
        pis: employee?.pis,
        matricula: employee?.matricula || employee?.id,
        cargo: employee?.role || employee?.cargo,
        departamento: dept?.name || employee?.department_id,
      };

      // Converter espelho para registros profissionais
      const records = convertDayMirrorToRecords(empMirror, filterUserId);

      // Calcular resumo de horas
      const summary = calculateHoursSummary(records);

      // Gerar hash do documento
      const hashDocumento = generateDocumentHash(records, companyData, employeeData);

      // Gerar PDF profissional
      await generateProfessionalTimesheetPDF({
        company: companyData,
        employee: employeeData,
        periodo: {
          inicio: periodStart,
          fim: periodEnd,
        },
        records,
        summary,
        hashDocumento,
        versaoSistema: '1.4.0',
        dataGeracao: new Date().toLocaleString('pt-BR'),
        emitidoPor: user?.nome || 'Sistema',
      });

      toast.addToast('success', 'PDF profissional exportado com sucesso!');
    } catch (err) {
      observabilityConsole.error('Erro ao gerar PDF:', err);
      toast.addToast('error', 'Erro ao gerar PDF profissional. Tente novamente.');
    } finally {
      setLoadingEspelho(false);
    }
  };

  const handleCloseMonth = async () => {
    if (!companyId || !filterUserId) {
      toast.addToast('error', 'Selecione um colaborador para fechar a folha.');
      return;
    }
    if (!periodValid) {
      toast.addToast('error', 'Defina o período completo do espelho (início e fim).');
      return;
    }
    if (closingMonth !== periodStart.slice(0, 7)) {
      toast.addToast(
        'error',
        'Período exibido diferente do período de fechamento. Ajuste os filtros do espelho ou o mês a fechar.',
      );
      return;
    }
    const [y, m] = closingMonth.split('-').map(Number);
    if (!y || !m) return;
    try {
      const auditPreClose = await getTimeAttendanceAuditSummary(companyId, {
        start: periodStart.slice(0, 10),
        end: periodEnd.slice(0, 10),
      });
      if (auditPreClose) {
        const blockDup = auditPreClose.duplicate_count >= ALERT_THRESHOLDS.duplicate;
        const blockErr = auditPreClose.error_count >= ALERT_THRESHOLDS.error;
        const blockInc = auditPreClose.inconsistent_count >= 1;
        if (blockInc) {
          toast.addToast(
            'error',
            'Existem dias inconsistentes na auditoria de jornada. Resolva os incidentes antes do fechamento do período.',
          );
          return;
        }
        if (blockDup || blockErr) {
          toast.addToast(
            'error',
            'Fechamento bloqueado: há duplicidade de dia ou erro de processamento no período do espelho. Corrija em Auditoria — Jornada antes de fechar a folha.',
          );
          return;
        }
      }
    } catch (preErr) {
      observabilityConsole.warn('[TIME ATTENDANCE AUDIT] pré-fechamento indisponível', preErr);
    }
    setClosingLoading(true);
    try {
      const already = await isTimesheetClosed(companyId, m, y, filterUserId);
      if (already) {
        toast.addToast('info', 'Este mês já consta como fechado.');
        setClosedMonthsInView((prev) => mergeClosedMonth(prev, y, m));
        return;
      }
      observabilityConsole.log('[FECHAMENTO INPUT]', {
        totalDays: periodDates.length,
        registros: displayRecords.length,
        calculos: 'recalculate_month via timeEngine.closeTimesheet',
        periodStart,
        periodEnd,
        closingMonth,
      });
      const result = await closeTimesheet(companyId, m, y, filterUserId, user?.id, {
        periodStart,
        periodEnd,
        closingMonthYm: closingMonth,
      });
      if (!result) {
        observabilityConsole.warn('[FECHAMENTO IGNORADO - JÁ EXISTE]');
        toast.addToast('info', 'Este mês já consta como fechado.');
        setClosedMonthsInView((prev) => mergeClosedMonth(prev, y, m));
        return;
      }
      invalidateAfterTimesheetMonthClose(companyId);
      await LoggingService.log({
        severity: LogSeverity.SECURITY,
        action: 'TIMESHEET_CLOSE',
        userId: user?.id,
        userName: user?.nome,
        companyId,
        details: {
          employeeId: filterUserId,
          month: m,
          year: y,
          periodStart,
          periodEnd,
          totals: result.totals,
          saldo_banco_final: result.saldo_banco_final,
          snapshot_id: result.snapshot?.id,
          closure_id: result.closure?.id,
        },
      });
      observabilityConsole.log('[FECHAMENTO TOTAIS]', result.totals);
      observabilityConsole.log('[FECHAMENTO BH]', {
        credited: result.totals?.banco_credito_minutes,
        debited: result.totals?.banco_debito_minutes,
        saldo_final: result.saldo_banco_final,
      });
      setClosedMonthsInView((prev) => mergeClosedMonth(prev, y, m));
      toast.addToast('success', 'Folha fechada com sucesso.');
      await loadEspelho();
    } catch (e) {
      observabilityConsole.error(e);
      const msg = e instanceof Error ? e.message : 'Não foi possível fechar a folha.';
      toast.addToast('error', msg);
    } finally {
      setClosingLoading(false);
    }
  };

  const handleReopenMonth = async () => {
    if (!companyId || !filterUserId) {
      toast.addToast('error', 'Selecione um colaborador.');
      return;
    }
    if (!periodClosedLock) {
      toast.addToast('info', 'Este período não está fechado; não há nada a reabrir.');
      return;
    }
    if (!periodValid || !periodStart || !periodEnd) {
      toast.addToast('error', 'Defina o período completo do espelho.');
      return;
    }
    const target = closedMonthsInView[closedMonthsInView.length - 1];
    if (!target) {
      toast.addToast('info', 'Nenhum mês fechado no intervalo visível do espelho.');
      return;
    }
    const { year: y, month: m } = target;
    const empNome = employees.find((e) => e.id === filterUserId)?.nome || filterUserId;
    const ok = window.confirm(
      `Reabrir oficialmente o fechamento de ${String(m).padStart(2, '0')}/${y} para «${empNome}»?\n\n` +
        '(É o mês civil mais recente no período que ainda está fechado; se houver mais de um, reabra de novo para o anterior.)\n\n' +
        'Serão removidos o registo de fecho e o snapshot consolidado desse mês. Volta a ser possível editar batidas, importar REP e consolidar a fila sem PERIODO_FECHADO para esse mês.\n\n' +
        'Confirme apenas se tiver autorização (RH / administrador).'
    );
    if (!ok) return;
    setReopenLoading(true);
    try {
      await reopenTimesheet({
        companyId,
        employeeId: filterUserId,
        month: m,
        year: y,
        client: supabase,
      });
      void appendTimeAttendanceTimelineEvent({
        companyId,
        employeeId: filterUserId,
        date: `${y}-${String(m).padStart(2, '0')}-01`,
        eventType: TimeAttendanceTimelineEventType.TIMESHEET_REOPENED,
        eventSeverity: TimeAttendanceTimelineSeverity.medium,
        sourceModule: 'Timesheet.handleReopenMonth',
        payload: {
          year: y,
          month: m,
          actor: user?.id ?? null,
          closure_reason: 'manual_reopen',
        },
        createdBy: user?.id ?? null,
        supabaseClient: supabase,
      });
      await LoggingService.log({
        severity: LogSeverity.SECURITY,
        action: 'TIMESHEET_REOPEN',
        userId: user?.id,
        userName: user?.nome,
        companyId,
        details: {
          employeeId: filterUserId,
          employeeName: empNome,
          month: m,
          year: y,
          closingMonthYm: `${y}-${String(m).padStart(2, '0')}`,
        },
      });
      invalidateAfterTimesheetMonthClose(companyId);
      setClosedMonthsInView((prev) => prev.filter((x) => !(x.year === y && x.month === m)));
      toast.addToast('success', `Mês ${String(m).padStart(2, '0')}/${y} reaberto. Pode editar o espelho e sincronizar o relógio.`);
      await loadEspelho();
    } catch (e) {
      observabilityConsole.error(e);
      const msg = e instanceof Error ? e.message : 'Não foi possível reabrir o mês.';
      toast.addToast('error', msg);
    } finally {
      setReopenLoading(false);
    }
  };

  const hasExpandedDetails = useMemo(
    () => Object.values(detailOpenByDate).some(Boolean),
    [detailOpenByDate],
  );
  const virtualRowsEnabled = !hasExpandedDetails;

  const timesheetVirtualWindow = useMemo(() => {
    const total = periodDates.length;
    if (!virtualRowsEnabled || total === 0) {
      return {
        start: 0,
        end: total,
        topSpacerHeight: 0,
        bottomSpacerHeight: 0,
      };
    }
    const viewportHeight = 700;
    const start = Math.max(0, Math.floor(timesheetScrollTop / TIMESHEET_ROW_ESTIMATED_HEIGHT) - TIMESHEET_OVERSCAN);
    const visibleCount = Math.ceil(viewportHeight / TIMESHEET_ROW_ESTIMATED_HEIGHT) + TIMESHEET_OVERSCAN * 2;
    const end = Math.min(total, start + visibleCount);
    return {
      start,
      end,
      topSpacerHeight: start * TIMESHEET_ROW_ESTIMATED_HEIGHT,
      bottomSpacerHeight: Math.max(0, (total - end) * TIMESHEET_ROW_ESTIMATED_HEIGHT),
    };
  }, [periodDates.length, timesheetScrollTop, virtualRowsEnabled]);

  const periodDatesForRender = useMemo(() => {
    if (!virtualRowsEnabled) return periodDates;
    return periodDates.slice(timesheetVirtualWindow.start, timesheetVirtualWindow.end);
  }, [periodDates, timesheetVirtualWindow.end, timesheetVirtualWindow.start, virtualRowsEnabled]);

  const handleTimesheetScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    if (!virtualRowsEnabled) return;
    setTimesheetScrollTop(e.currentTarget.scrollTop);
  }, [virtualRowsEnabled]);

  useEffect(() => {
    setTimesheetScrollTop(0);
    if (timesheetScrollRef.current) timesheetScrollRef.current.scrollTop = 0;
  }, [periodStart, periodEnd, filterUserId, recordTypeFilter, virtualRowsEnabled]);

  const renderTimeCell = (time: string | null, record?: TimeRecord) => {
    const isManual = !!(record && isManualRecord(record));
    const fromRep = !!(record && isRepMirrorRecord(record));
    const display = time != null && String(time).trim() !== '' ? String(time).trim() : EMPTY_DASH;
    const isEmpty = display === EMPTY_DASH;
    const clickable = !!(record && isEditableManualMirrorRecord(record) && !periodClosedLock);
    const content = (
      <>
        {display}
        {isManual && <span className="text-blue-500 font-bold">*</span>}
        {fromRep && !isManual && (
          <span
            className="text-[10px] font-semibold uppercase tracking-wide text-emerald-600 dark:text-emerald-400"
            aria-hidden
          >
            REP
          </span>
        )}
      </>
    );
    const title = isEmpty
      ? 'Sem batida'
      : isManual
        ? periodClosedLock
          ? `Batida manual: ${record?.manual_reason || 'Sem motivo'}. ${TOOLTIP_PERIODO_FECHADO_HARD_LOCK} Origem: ${resolvePunchOrigin(record!).label}`
          : `Batida manual: ${record?.manual_reason || 'Sem motivo'}. Clique para editar. · Origem: ${resolvePunchOrigin(record!).label}`
        : `${fromRep ? 'Batida do registrador (REP / relógio)' : 'Batida pelo app/dispositivo'}. Não editável no espelho. · Origem: ${record ? resolvePunchOrigin(record).label : '—'}`;
    const className = `inline-flex items-center gap-1 px-2 py-1 rounded text-sm font-medium w-full text-left ${
      clickable
        ? 'cursor-pointer hover:ring-2 hover:ring-indigo-300 dark:hover:ring-indigo-700'
        : isEmpty
          ? 'cursor-default text-slate-400 dark:text-slate-500'
          : 'cursor-default text-slate-700 dark:text-slate-300'
    } ${
      isManual
        ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 border border-blue-300 dark:border-blue-700'
        : ''
    }`;
    if (clickable && record) {
      return (
        <button
          type="button"
          className={className}
          onClick={() => {
            const ts = (record.timestamp && String(record.timestamp).trim()) || record.created_at;
            setRecordToEdit({ ...record, created_at: ts });
            setShowEditModal(true);
          }}
          title={title}
        >
          {content}
        </button>
      );
    }
    return (
      <span
        className={className}
        title={title}
      >
        {content}
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
      <PageHeader title="Espelho de Ponto" helpSlug="espelho-de-ponto" helpSection="como-funciona" />

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
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="inline-flex items-center gap-2 shrink-0"
              disabled={!periodValid || loadingEspelho || recalculatingEspelho || !companyId || !filterUserId}
              title="Recarrega batidas e recalcula hora extra / banco de horas do período (útil após REP, reconciliação ou ajuste manual)"
              onClick={() => {
                void handleRefreshEspelho();
              }}
            >
              <RefreshCw
                className={`w-4 h-4 ${loadingEspelho || recalculatingEspelho ? 'animate-spin' : ''}`}
                aria-hidden
              />
              Atualizar batidas
            </Button>
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
            disabled={periodClosedLock || !filterUserId || !periodValid}
            title={
              periodClosedLock
                ? `${TOOLTIP_PERIODO_FECHADO_HARD_LOCK} Não é possível adicionar batidas.`
                : undefined
            }
            onClick={() => setShowAddModal(true)}
          >
            <Plus className="w-4 h-4" />
            Adicionar batida
          </Button>
          {periodClosedLock ? (
            <span
              className="inline-flex items-center justify-center gap-2 font-bold rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 px-4 py-2 text-xs cursor-not-allowed select-none opacity-70"
              title={`${TOOLTIP_PERIODO_FECHADO_HARD_LOCK} Importação REP bloqueada.`}
              role="presentation"
            >
              <Upload className="w-4 h-4 shrink-0" aria-hidden />
              Importar arquivo REP
            </span>
          ) : (
            <Link
              to={
                filterUserId
                  ? `/admin/import-rep?forceUserId=${encodeURIComponent(filterUserId)}`
                  : '/admin/import-rep'
              }
              className="inline-flex items-center justify-center gap-2 font-bold rounded-2xl transition-all active:scale-[0.98] border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-700 px-4 py-2 text-xs"
              title={
                filterUserId
                  ? 'Envie um AFD/TXT do relógio e atribua as batidas a este colaborador (quando o PIS do arquivo não casa com o cadastro)'
                  : 'Importar arquivo AFD ou TXT das marcações'
              }
            >
              <Upload className="w-4 h-4" aria-hidden />
              Importar arquivo REP
            </Link>
          )}
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
              title={
                closingMonthIsClosed
                  ? TOOLTIP_PERIODO_FECHADO_HARD_LOCK
                  : 'Sincronizado com o primeiro dia do período do espelho.'
              }
              onChange={(e) => setClosingMonth(e.target.value)}
              className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm disabled:opacity-70"
              disabled={closingMonthIsClosed}
            />
          </div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="inline-flex items-center gap-2"
            disabled={
              closingLoading ||
              !filterUserId ||
              !periodValid ||
              closingMonthIsClosed ||
              closeBlockedByOperational
            }
            title={
              closingMonthIsClosed
                ? 'Este mês civil já está fechado para o colaborador.'
                : closeBlockedByOperational
                  ? 'Há dias com divergência ou erro de cálculo (replay). Corrija ou use override de administrador.'
                  : !periodValid
                    ? 'Defina o período completo no espelho.'
                    : undefined
            }
            onClick={() => void handleCloseMonth()}
          >
            <Lock className="w-4 h-4" />
            {closingLoading ? 'Fechando…' : 'Fechar folha'}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="inline-flex items-center gap-2 border-amber-300 text-amber-900 dark:border-amber-700 dark:text-amber-100 hover:bg-amber-50 dark:hover:bg-amber-950/40"
            disabled={
              reopenLoading ||
              closingLoading ||
              !filterUserId ||
              !periodValid ||
              !periodClosedLock ||
              !/^\d{4}-\d{2}-\d{2}$/.test(String(periodStart).slice(0, 10)) ||
              !/^\d{4}-\d{2}-\d{2}$/.test(String(periodEnd).slice(0, 10))
            }
            title={
              !periodClosedLock
                ? 'Só disponível quando existir pelo menos um mês civil fechado no intervalo do espelho (início a fim).'
                : 'Remove fecho e snapshot do mês civil mais recente ainda fechado nesse intervalo (auditoria registada).'
            }
            onClick={() => void handleReopenMonth()}
          >
            <Unlock className="w-4 h-4" aria-hidden />
            {reopenLoading ? 'Reabrindo…' : 'Reabrir mês'}
          </Button>
          {periodOperationalBlocked && user?.role !== 'admin' && (
            <p className="w-full text-sm text-red-700 dark:text-red-300 mt-2">
              Fechamento bloqueado: existe divergência ou erro de cálculo em pelo menos um dia do período.
              Solicite um administrador para analisar ou aplicar override.
            </p>
          )}
          {periodOperationalBlocked && user?.role === 'admin' && (
            <label className="flex items-start gap-2 text-sm text-amber-900 dark:text-amber-100 mt-2 max-w-xl cursor-pointer">
              <input
                type="checkbox"
                className="mt-1 rounded border-slate-300"
                checked={adminCloseOverride}
                onChange={(e) => setAdminCloseOverride(e.target.checked)}
              />
              <span>
                Permitir fechar a folha mesmo com divergência ou erro de cálculo no período (override
                administrativo — use apenas após validação explícita).
              </span>
            </label>
          )}
        </div>
      </section>

      <PeriodCalculationHealthSection
        periodValid={periodValid}
        filterUserId={filterUserId}
        hasOperationalStatuses={operationalStatusesForPeriod.length > 0}
        periodHealthSummary={periodHealthSummary}
        periodDatesCount={periodDates.length}
        periodHasDrift={periodHasDrift}
        repPendingReconciliationCount={repPendingReconciliationCount}
      />

      {/* Legenda + filtro de batidas */}
      <div className="flex flex-wrap gap-3 text-sm text-slate-600 dark:text-slate-400 print:text-xs">
        <button
          type="button"
          onClick={() => setRecordTypeFilter('manual')}
          className={`inline-flex items-center gap-2 rounded-xl px-3 py-2.5 text-left text-sm font-medium transition-colors ${
            recordTypeFilter === 'manual'
              ? 'bg-indigo-600 text-white'
              : 'bg-slate-50 dark:bg-slate-800/70 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700'
          }`}
        >
          <span className="w-3 h-3 rounded-full bg-blue-500" />
          Batida manual (*)
        </button>
        <button
          type="button"
          onClick={() => setRecordTypeFilter('normal')}
          className={`inline-flex items-center gap-2 rounded-xl px-3 py-2.5 text-left text-sm font-medium transition-colors ${
            recordTypeFilter === 'normal'
              ? 'bg-indigo-600 text-white'
              : 'bg-slate-50 dark:bg-slate-800/70 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700'
          }`}
        >
          <span className="w-3 h-3 rounded-full border border-slate-400" />
          Batida normal
        </button>
        <button
          type="button"
          onClick={() => setRecordTypeFilter('all')}
          className={`inline-flex items-center gap-2 rounded-xl px-3 py-2.5 text-left text-sm font-medium transition-colors ${
            recordTypeFilter === 'all'
              ? 'bg-indigo-600 text-white'
              : 'bg-slate-50 dark:bg-slate-800/70 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700'
          }`}
        >
          Mostrar todas
        </button>
        <div className="w-full border-t border-slate-200 dark:border-slate-700 pt-3 mt-1 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-slate-600 dark:text-slate-400">
          <span className="font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">
            Estado do cálculo (persistido)
          </span>
          <span className="inline-flex items-center gap-2" title={operationalStatusTooltip('ok')}>
            <span className={`inline-block w-2.5 h-2.5 rounded-full shrink-0 ${operationalBadgeClassName('green')}`} />
            {mapProcessingStatusToLabel('ok')}
          </span>
          <span className="inline-flex items-center gap-2" title={operationalStatusTooltip('fallback_schedule')}>
            <span className={`inline-block w-2.5 h-2.5 rounded-full shrink-0 ${operationalBadgeClassName('yellow')}`} />
            {mapProcessingStatusToLabel('fallback_schedule')}
          </span>
          <span className="inline-flex items-center gap-2" title={operationalStatusTooltip('drift')}>
            <span className={`inline-block w-2.5 h-2.5 rounded-full shrink-0 ${operationalBadgeClassName('blue')}`} />
            {mapProcessingStatusToLabel('drift')}
          </span>
          <span className="inline-flex items-center gap-2" title={operationalStatusTooltip('inconsistent')}>
            <span className={`inline-block w-2.5 h-2.5 rounded-full shrink-0 ${operationalBadgeClassName('red')}`} />
            {mapProcessingStatusToLabel('inconsistent')}
          </span>
        </div>
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
        <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-sm overflow-visible print:border print:shadow-none">
          <div className="px-4 py-3 bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-700">
            <h3 className="font-semibold text-slate-900 dark:text-white">{selectedEmployee?.nome || 'Colaborador'}</h3>
            <p className="text-sm text-slate-500">
              {departments.find((d) => d.id === selectedEmployee?.department_id)?.name || '—'} ·{' '}
              {formatDateBR(periodStart)} a {formatDateBR(periodEnd)}
            </p>
          </div>
          <div
            ref={timesheetScrollRef}
            className="overflow-auto max-h-[72vh]"
            onScroll={handleTimesheetScroll}
          >
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-800/50">
                <tr>
                  <th className="px-3 py-2 text-left font-medium text-slate-600 dark:text-slate-400">Dia</th>
                  <th className="px-3 py-2 text-left font-medium text-slate-600 dark:text-slate-400">Data</th>
                  <th className="px-3 py-2 text-left font-medium text-slate-600 dark:text-slate-400">Entrada</th>
                  <th className="px-3 py-2 text-left font-medium text-slate-600 dark:text-slate-400">Saída int.</th>
                  <th className="px-3 py-2 text-left font-medium text-slate-600 dark:text-slate-400">Volta int.</th>
                  <th className="px-3 py-2 text-left font-medium text-slate-600 dark:text-slate-400">Saída</th>
                  <th className="px-3 py-2 text-left font-medium text-slate-600 dark:text-slate-400">Total</th>
                  <th className="px-3 py-2 text-left font-medium text-slate-600 dark:text-slate-400">Hora Extra</th>
                  <th className="px-3 py-2 text-left font-medium text-slate-600 dark:text-slate-400">Justificativa</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                {virtualRowsEnabled && timesheetVirtualWindow.topSpacerHeight > 0 && (
                  <tr aria-hidden>
                    <td colSpan={9} className="p-0 border-0" style={{ height: timesheetVirtualWindow.topSpacerHeight }} />
                  </tr>
                )}
                {periodDatesForRender.map((date) => {
                  const day = empMirror.get(date);
                  if (!day) return null;
                  const hasRealRecords = day.records.some((r) => !isStatusRecord(r));
                  const dayStatus = getDayStatus(
                    day,
                    scheduleWorkDays ?? undefined,
                    expectedWindowForYmd(date),
                    holidayDates,
                  );
                  let dataNote: 'Folga' | 'Falta' | 'Feriado' | 'Inconsistente' | null = null;
                  if (holidayDates.has(date)) dataNote = 'Feriado';
                  else if (dayStatus.status === 'folga') dataNote = 'Folga';
                  else if (dayStatus.status === 'falta') dataNote = 'Falta';
                  const fmt = (iso: string) =>
                    new Date(iso).toLocaleTimeString('pt-BR', {
                      hour: '2-digit',
                      minute: '2-digit',
                      hour12: false,
                    });
                  const hhmmToMin = (hhmm: string | null | undefined): number | null => {
                    if (!hhmm || !/^\d{2}:\d{2}$/.test(hhmm)) return null;
                    const [h, m] = hhmm.split(':').map((v) => Number(v));
                    if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
                    return h * 60 + m;
                  };
                  const recordIsoForDay = (r: TimeRecord) => recordEffectiveMirrorInstant(r, date);
                  const fmtRecord = (r: TimeRecord) => fmt(recordIsoForDay(r));
                  const entradaRecord = resolveMirrorSlotRecord(day, 'entrada', 'entrada');
                  const saidaIntRecord = resolveMirrorSlotRecord(day, 'saida_intervalo', 'intervalo_saida');
                  let voltaIntRecord = resolveMirrorSlotRecord(day, 'volta_intervalo', 'intervalo_volta');
                  const saidaRecord = resolveMirrorSlotRecord(day, 'saida_final', 'saida');
                  let voltaSlotTime = day.voltaIntervalo;

                  const hasSlotAssignmentMap =
                    !!day.slotRecordIds && Object.values(day.slotRecordIds).some((id) => Boolean(id));

                  // Fallback visual (apenas legado sem mapa 1:1): evita duplicar batidas quando `slotRecordIds` existe.
                  if (!hasSlotAssignmentMap && !voltaSlotTime && day.saidaIntervalo) {
                    const startMin = hhmmToMin(day.saidaIntervalo);
                    const endMin = hhmmToMin(day.saidaFinal);
                    const hasRecord = (r?: TimeRecord) => !!r?.id;
                    const takenIds = new Set<string>(
                      [entradaRecord, saidaIntRecord, voltaIntRecord, saidaRecord]
                        .filter(hasRecord)
                        .map((r) => r!.id),
                    );
                    const candidates = day.records
                      .filter((r) => !isStatusRecord(r))
                      .filter((r) => !takenIds.has(r.id))
                      .map((r) => ({ rec: r, time: fmtRecord(r), min: hhmmToMin(fmtRecord(r)) }))
                      .filter((x) => x.min != null && (startMin == null || x.min > startMin))
                      .filter((x) => endMin == null || x.min < endMin)
                      .sort((a, b) => (a.min ?? 0) - (b.min ?? 0));
                    if (candidates.length > 0) {
                      voltaIntRecord = candidates[0]!.rec;
                      voltaSlotTime = candidates[0]!.time;
                    }
                  }
                  // Fallback visual para dias inconsistentes (sem `slotRecordIds` do motor atual).
                  const occupiedTimes = new Set<string>(
                    [day.entradaInicio, day.saidaIntervalo, voltaSlotTime, day.saidaFinal]
                      .filter((x): x is string => !!x && String(x).trim() !== ''),
                  );
                  const inconsistentTimes = !hasSlotAssignmentMap
                    ? day.inconsistencias
                        .map((r) => fmtRecord(r))
                        .filter((t) => !occupiedTimes.has(t))
                    : [];
                  const uniqueInconsistentTimes = [...new Set(inconsistentTimes)];
                  let fallbackIdx = 0;
                  const nextFallbackTime = (): string | null => {
                    if (hasSlotAssignmentMap) return null;
                    if (fallbackIdx >= uniqueInconsistentTimes.length) return null;
                    const t = uniqueInconsistentTimes[fallbackIdx]!;
                    fallbackIdx += 1;
                    return String(t);
                  };
                  const pickInconsistentRecord = (time: string | null): TimeRecord | undefined => {
                    if (!time) return undefined;
                    return day.inconsistencias.find((r) => fmtRecord(r) === time);
                  };
                  const pickDisplayedRecord = (
                    time: string | null,
                    expectedType: 'entrada' | 'intervalo_saida' | 'intervalo_volta' | 'saida',
                  ): TimeRecord | undefined => {
                    if (!time) return undefined;
                    const candidates = day.records
                      .filter((r) => !isStatusRecord(r))
                      .filter((r) => fmtRecord(r) === time);
                    return (
                      candidates.find((r) => isEditableManualMirrorRecord(r) && normalizeRecordTypeForMirror(r.type) === expectedType) ||
                      candidates.find((r) => normalizeRecordTypeForMirror(r.type) === expectedType) ||
                      candidates.find((r) => isEditableManualMirrorRecord(r)) ||
                      candidates[0]
                    );
                  };
                  const entradaSlotTime = day.entradaInicio || nextFallbackTime();
                  const saidaIntSlotTime = day.saidaIntervalo || nextFallbackTime();
                  const voltaIntSlotTime = voltaSlotTime || nextFallbackTime();
                  const saidaFinalSlotTime = day.saidaFinal || nextFallbackTime();
                  const entradaSlotRecord =
                    entradaRecord || pickDisplayedRecord(entradaSlotTime, 'entrada') || pickInconsistentRecord(entradaSlotTime);
                  const saidaIntSlotRecord =
                    saidaIntRecord || pickDisplayedRecord(saidaIntSlotTime, 'intervalo_saida') || pickInconsistentRecord(saidaIntSlotTime);
                  const voltaIntSlotRecord =
                    voltaIntRecord || pickDisplayedRecord(voltaIntSlotTime, 'intervalo_volta') || pickInconsistentRecord(voltaIntSlotTime);
                  const saidaFinalSlotRecord =
                    saidaRecord || pickDisplayedRecord(saidaFinalSlotTime, 'saida') || pickInconsistentRecord(saidaFinalSlotTime);
                  let fallbackWorkedMinutes = 0;
                  if (hasRealRecords && day.workedMinutes <= 0) {
                    const start = hhmmToMin(entradaSlotTime);
                    const end = hhmmToMin(saidaFinalSlotTime);
                    if (start != null && end != null && end > start) {
                      fallbackWorkedMinutes = end - start;
                      const intStart = hhmmToMin(saidaIntSlotTime);
                      const intEnd = hhmmToMin(voltaIntSlotTime);
                      if (
                        intStart != null &&
                        intEnd != null &&
                        intEnd > intStart &&
                        intStart >= start &&
                        intEnd <= end
                      ) {
                        fallbackWorkedMinutes -= (intEnd - intStart);
                      }
                      if (fallbackWorkedMinutes < 0) fallbackWorkedMinutes = 0;
                    }
                  }
                  const hasInconsistentOnly =
                    hasRealRecords &&
                    !day.entradaInicio &&
                    !day.saidaIntervalo &&
                    !voltaSlotTime &&
                    !day.saidaFinal &&
                    day.inconsistencias.length > 0;
                  if (!dataNote && hasInconsistentOnly) dataNote = 'Inconsistente';
                  const renderMirrorSlot = (t: string | null, rec?: TimeRecord) => {
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
                    if (dataNote === 'Inconsistente') {
                      return (
                        <span className="inline-flex px-2 py-1 rounded text-sm font-semibold text-rose-700 dark:text-rose-300">
                          Inconsist.
                        </span>
                      );
                    }
                    return renderTimeCell(null, undefined);
                  };
                  const dayRecs = day.records.filter((r) => !isStatusRecord(r));
                  const extraIds = new Set(day.batidasExtra.map((r) => r.id));
                  const showPunchTimes =
                    dataNote !== 'Folga' && dataNote !== 'Falta';
                  return (
                    <React.Fragment key={date}>
                    <tr
                      className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40"
                      style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 52px' }}
                    >
                      <td className="px-3 py-2 text-slate-800 dark:text-slate-200 whitespace-nowrap align-top">
                        {renderWeekdayCell(date)}
                      </td>
                      <td className="px-3 py-2 text-slate-800 dark:text-slate-200 whitespace-nowrap align-top">
                        <div className="flex items-center gap-2 flex-wrap">
                          {dayRecs.length > 0 ? (
                            <button
                              type="button"
                              className="inline-flex items-center gap-1.5 hover:underline"
                              onClick={() =>
                                setDetailOpenByDate((prev) => ({
                                  ...prev,
                                  [date]: !prev[date],
                                }))
                              }
                            >
                              {detailOpenByDate[date] ? (
                                <ChevronDown className="w-4 h-4 shrink-0 text-slate-500 dark:text-slate-400" aria-hidden />
                              ) : (
                                <ChevronRight className="w-4 h-4 shrink-0 text-slate-500 dark:text-slate-400" aria-hidden />
                              )}
                              {formatDateBR(date)}
                            </button>
                          ) : (
                            formatDateBR(date)
                          )}
                          {dailyCalcUiByDate.has(date) &&
                            (() => {
                              const ui = dailyCalcUiByDate.get(date)!;
                              const op = deriveOperationalDisplayStatus(ui);
                              const variant = operationalBadgeVariant(op);
                              const tip = `${mapProcessingStatusToLabel(op)} — ${operationalStatusTooltip(op)}`;
                              return (
                                <span
                                  className={`inline-block w-2.5 h-2.5 rounded-full shrink-0 ${operationalBadgeClassName(variant)}`}
                                  title={tip}
                                  aria-label={tip}
                                  role="img"
                                />
                              );
                            })()}
                        </div>
                        {(() => {
                          const rp = repPendingByDate.get(date);
                          if (!rp?.length) return null;
                          const canAssist = rp.some((p) => isRepPunchEligibleForAssistedSequenceReconciliation(p));
                          return (
                            <div className="mt-0.5 space-y-1">
                              <div
                                className="text-xs font-semibold text-amber-800 dark:text-amber-200"
                                title="Batidas recebidas no REP com colaborador identificado, ainda sem time_record no espelho. Não entram no total oficial do motor até a consolidação."
                              >
                                REP pendente: {rp.length} batida(s)
                              </div>
                              {canAssist ? (
                                <button
                                  type="button"
                                  className="text-[11px] font-semibold text-indigo-600 dark:text-indigo-300 hover:underline print:hidden"
                                  onClick={() => setRepSeqModalDate(date)}
                                >
                                  Reconciliação assistida
                                </button>
                              ) : null}
                            </div>
                          );
                        })()}
                      </td>
                      <td className="px-3 py-2">
                        {renderMirrorSlot(showPunchTimes && hasRealRecords ? entradaSlotTime : null, showPunchTimes && hasRealRecords ? entradaSlotRecord : undefined)}
                      </td>
                      <td className="px-3 py-2">
                        {renderMirrorSlot(showPunchTimes && hasRealRecords ? saidaIntSlotTime : null, showPunchTimes && hasRealRecords ? saidaIntSlotRecord : undefined)}
                      </td>
                      <td className="px-3 py-2">
                        {renderMirrorSlot(showPunchTimes && hasRealRecords ? voltaIntSlotTime : null, showPunchTimes && hasRealRecords ? voltaIntSlotRecord : undefined)}
                      </td>
                      <td className="px-3 py-2">
                        {renderMirrorSlot(showPunchTimes && hasRealRecords ? saidaFinalSlotTime : null, showPunchTimes && hasRealRecords ? saidaFinalSlotRecord : undefined)}
                      </td>
                      <td className="px-3 py-2 font-medium text-slate-700 dark:text-slate-300">
                        {hasRealRecords && day.workedMinutes > 0
                          ? formatMinutes(day.workedMinutes)
                          : hasRealRecords && fallbackWorkedMinutes > 0
                            ? (
                              <span
                                className="inline-flex items-center gap-1.5"
                                title="Total estimado com base nas batidas visíveis do dia (não é fechamento oficial)."
                              >
                                <span>{formatMinutes(fallbackWorkedMinutes)}</span>
                                <span className="inline-flex px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                                  Estimado
                                </span>
                              </span>
                            )
                            : hasInconsistentOnly
                              ? 'Ver ocorrências'
                              : EMPTY_DASH}
                      </td>
                      <td className="px-3 py-2 font-medium text-slate-700 dark:text-slate-300 align-top tabular-nums">
                        {(() => {
                          const dailyRow = dailyCalcUiByDate.get(date);
                          const scheduleWin = expectedWindowForYmd(date) as DayExpectedWindow | null | undefined;
                          const expectedMin =
                            scheduleWin && dayStatus.status !== 'folga' && !holidayDates.has(date)
                              ? expectedMinutesFromDayWindow(scheduleWin)
                              : 0;
                          const persisted = dailyRow
                            ? parseTimesheetDailyOvertime(dailyRow)
                            : { overtimeMinutes: 0, negativeMinutes: 0 };
                          const repPendingCount = repPendingByDate.get(date) ?? 0;
                          const useMirrorEstimate =
                            hasRealRecords &&
                            !dataNote &&
                            shouldShowMirrorOvertimeEstimate({
                              hasDrift: dailyRow?.has_drift,
                              hasRepPending: repPendingCount > 0,
                              mirrorWorkedMinutes: day.workedMinutes,
                              expectedMinutes: expectedMin,
                              persistedOvertimeMinutes: persisted.overtimeMinutes,
                              persistedNegativeMinutes: persisted.negativeMinutes,
                              persistedWorkedMinutes: dailyRow?.worked_minutes ?? null,
                            });
                          if (useMirrorEstimate && expectedMin > 0) {
                            const mirrorOt = computeMirrorNetOvertime(day.workedMinutes, expectedMin);
                            const display = formatSignedOvertimeDisplay(
                              mirrorOt.overtimeMinutes,
                              mirrorOt.negativeMinutes,
                            );
                            return (
                              <span
                                className="inline-flex items-center gap-1.5"
                                title="Hora extra estimada pelo espelho (cálculo persistido desatualizado — use Atualizar batidas para recalcular)."
                              >
                                <span>{display === '-' ? EMPTY_DASH : display}</span>
                                <span className="inline-flex px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                                  Estimado
                                </span>
                              </span>
                            );
                          }
                          if (!dailyRow) return EMPTY_DASH;
                          return formatSignedOvertimeDisplay(
                            persisted.overtimeMinutes,
                            persisted.negativeMinutes,
                          );
                        })()}
                      </td>
                      <td className="px-3 py-2 text-slate-600 dark:text-slate-300 align-top text-xs max-w-[220px]">
                        <span className="line-clamp-3" title={collectDayJustification(day, approvedAdjustments)}>
                          {collectDayJustification(day, approvedAdjustments)}
                        </span>
                      </td>
                    </tr>
                    {dayRecs.length > 0 && detailOpenByDate[date] === true && (
                      <tr className="bg-slate-50/80 dark:bg-slate-800/40 print:bg-transparent">
                        <td colSpan={9} className="px-3 py-3">
                          <div className="space-y-2">
                            {dayRecs.map((r) => {
                              const whenIso = recordEffectiveMirrorInstant(r, date);
                              const when = whenIso
                                ? new Date(whenIso).toLocaleTimeString('pt-BR', {
                                    hour: '2-digit',
                                    minute: '2-digit',
                                  })
                                : '—';
                              const origin = resolvePunchOrigin(r);
                              return (
                                <div key={r.id} className="flex flex-wrap items-start gap-x-3 gap-y-1 text-xs">
                                  <span className="font-mono tabular-nums text-slate-600 dark:text-slate-400 shrink-0">{when}</span>
                                  <span className="uppercase text-[10px] px-2 py-0.5 rounded-md bg-slate-200/90 dark:bg-slate-700 text-slate-800 dark:text-slate-100 shrink-0">
                                    {(r.type || '—').toString()}
                                  </span>
                                  {extraIds.has(r.id) ? (
                                    <span className="text-[10px] px-2 py-0.5 rounded-md bg-purple-100 dark:bg-purple-900/40 text-purple-800 dark:text-purple-200 shrink-0">
                                      Extra (5ª+)
                                    </span>
                                  ) : null}
                                  <span className="text-[10px] px-2 py-0.5 rounded-md bg-indigo-100/90 dark:bg-indigo-900/40 text-indigo-800 dark:text-indigo-200 shrink-0">
                                    {origin.label}
                                  </span>
                                  <div className="min-w-0 flex-1 basis-[min(100%,22rem)] max-w-2xl">
                                    <GeoDetailsToggle
                                      record={r}
                                      notApplicable={origin.kind === 'rep'}
                                    />
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
                {virtualRowsEnabled && timesheetVirtualWindow.bottomSpacerHeight > 0 && (
                  <tr aria-hidden>
                    <td colSpan={9} className="p-0 border-0" style={{ height: timesheetVirtualWindow.bottomSpacerHeight }} />
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {periodValid && filterUserId && !loadingEspelho && (() => {
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
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
              * No total diário, valores com asterisco indicam cálculo estimado a partir das batidas visíveis.
            </p>
            <div className="space-y-2">
              {daysWithIssues.map(({ date, day }) => {
                if (!day) return null;
                const fmt = (iso: string) =>
                  new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', hour12: false });
                const fmtRecord = (r: TimeRecord) => fmt(recordEffectiveMirrorInstant(r, date));
                const issueLabel = (r: TimeRecord) => `${fmtRecord(r)} · ${resolvePunchOrigin(r).label}`;
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
                      {repPend.some((p) => isRepPunchEligibleForAssistedSequenceReconciliation(p)) ? (
                        <button
                          type="button"
                          className="text-xs font-semibold text-amber-800 dark:text-amber-200 hover:underline"
                          onClick={() => setRepSeqModalDate(date)}
                        >
                          Reconciliação assistida
                        </button>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        );
      })()}

      <AddTimeRecordModal
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        onSubmit={handleAddRecord}
        employees={filteredEmployees}
        companyId={companyId}
      />
      <EditTimeRecordModal
        isOpen={showEditModal}
        readOnly={periodClosedLock}
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
        onUpdated={({ recordId, userId, date, time, type }) => {
          void LoggingService.log({
            severity: LogSeverity.SECURITY,
            action: 'ADMIN_UPDATE_TIME_RECORD',
            userId: user?.id,
            userName: user?.nome,
            companyId: companyId || '',
            details: {
              recordId,
              employeeId: userId,
              date,
              time,
              type,
              source: 'admin_timesheet',
            },
          });
        }}
        onDeleted={({ recordId, userId }) => {
          void LoggingService.log({
            severity: LogSeverity.WARN,
            action: 'ADMIN_DELETE_TIME_RECORD',
            userId: user?.id,
            userName: user?.nome,
            companyId: companyId || '',
            details: {
              recordId,
              employeeId: userId,
              source: 'admin_timesheet',
            },
          });
        }}
      />
      <DayIssuesModal state={issuesModal} onClose={() => setIssuesModal(null)} />
      {repSeqModalDate && filterUserId && companyId && user?.id ? (
        <RepPendingSequenceResolutionModal
          open
          onClose={() => setRepSeqModalDate(null)}
          companyId={companyId}
          employeeId={filterUserId}
          employeeName={selectedEmployee?.nome}
          dateYmd={repSeqModalDate}
          pendingPunches={repPendingByDate.get(repSeqModalDate) ?? []}
          reviewedByUserId={user.id}
          onCompleted={() => {
            void loadEspelho();
            setRepSeqRefreshKey((k) => k + 1);
          }}
        />
      ) : null}
    </div>
  );
};

export default AdminTimesheet;
