import { observabilityConsole } from '../../shared/logger/observabilityConsole';
import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import { Clock, CalendarDays, Activity, Scale, ClipboardList, LogIn, LogOut, FileEdit, FileText, CalendarClock } from 'lucide-react';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import PageHeader from '../../components/PageHeader';
import { db } from '../../services/supabaseClient';
import { getTimeRecordsForEmployeeDashboard } from '../../../services/timeRecords.service';
import { Button, LoadingState } from '../../../components/UI';
import { calcularHorasHojeMs, formatarTempoLegivel, localTodayYmd } from '../../utils/workedHoursToday';
import { useLanguage } from '../../contexts/LanguageContext';
import { i18n } from '../../../lib/i18n';
import { extractLocalCalendarDateFromIso, type NormalizedMirrorRecordType } from '../../utils/timesheetMirror';
import {
  inferDashboardPunchDisplayMirrorType,
  resolveEmployeeScheduleForDate,
  isLocalClockWithinWorkSchedule,
  formatScheduleTimeDisplay,
  type WorkScheduleInfo,
} from '../../services/timeProcessingService';
import { recordPunchInstantIso, recordPunchInstantMs, resolvePunchOrigin } from '../../utils/punchOrigin';
import { deriveOperationalStatusFromLastPunch, EmployeeOperationalStatus } from '../../types/employeeOperationalStatus';
import { isCompanyWideNotice } from '../../../services/notificationService';
import { NOTIFICATION_LIST_COLUMNS } from '../../services/egressSelectColumns';

function logDashboardDebug(label: string, payload: unknown): void {
  console.log(label, payload);
}

function formatSignedHours(hours: number): string {
  const safe = Number.isFinite(hours) ? hours : 0;
  const sign = safe > 0 ? '+' : '';
  return `${sign}${safe.toFixed(1)}h`;
}

function computeLedgerAvailableBalanceMinutes(rows: any[]): number {
  return (rows ?? []).reduce((acc: number, row: any) => {
    const type = String(row?.type ?? '').toUpperCase();
    const minutes = Math.max(0, Number(row?.minutes ?? 0));
    const used = Math.max(0, Number(row?.used_minutes ?? 0));
    if (type === 'CREDIT') return acc + Math.max(0, minutes - used);
    if (type === 'DEBIT') return acc - minutes;
    return acc;
  }, 0);
}

function monthEndYmd(monthPrefix: string): string {
  const [year, month] = monthPrefix.split('-').map(Number);
  if (!year || !month) return `${monthPrefix}-31`;
  const lastDay = new Date(year, month, 0).getDate();
  return `${monthPrefix}-${String(lastDay).padStart(2, '0')}`;
}

function punchTypeLabelFromMirrorNorm(norm: NormalizedMirrorRecordType): string {
  switch (norm) {
    case 'entrada':
      return i18n.t('punch.typeIn');
    case 'saida':
      return i18n.t('punch.typeOut');
    case 'intervalo_saida':
      return i18n.t('punch.typeIntervalExit');
    case 'intervalo_volta':
      return i18n.t('punch.typeIntervalReturn');
    default:
      return '—';
  }
}

const EmployeeDashboard: React.FC = () => {
  const { user, loading } = useCurrentUser();
  const navigate = useNavigate();
  useLanguage();
  const [lastRecord, setLastRecord] = useState<{
    type: string;
    /** Instante oficial (timestamp ou created_at) */
    displayAt: string;
    originLabel: string;
  } | null>(null);
  const [todayRecords, setTodayRecords] = useState<any[]>([]);
  const [todayHours, setTodayHours] = useState('');
  const [monthHours, setMonthHours] = useState('');
  const [balanceHours, setBalanceHours] = useState<string>('—');
  const [bankCreditDebit, setBankCreditDebit] = useState<string>('');
  const [pendingRequests, setPendingRequests] = useState(0);
  const [scheduleName, setScheduleName] = useState<string>('—');
  const [companyNotices, setCompanyNotices] = useState<Array<{ id: string; title: string; body: string; createdAt: string }>>([]);
  const [nowClock, setNowClock] = useState(() => new Date());
  const [loadingData, setLoadingData] = useState(true);
  const [todaySchedule, setTodaySchedule] = useState<WorkScheduleInfo | null>(null);

  const loadDashboard = useCallback(
    async (options?: { showLoading?: boolean }) => {
      const showLoading = options?.showLoading !== false;
      if (!user) return;
      if (showLoading) setLoadingData(true);
      try {
        logDashboardDebug('USER', user);
        logDashboardDebug('EMPLOYEE', {
          id: user.id,
          employeeId: user.id,
          companyId: user.companyId,
          tenantId: user.tenantId,
          role: user.role,
        });
        const todayYmd = localTodayYmd();
        const now = new Date();
        const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
        let schedToday: WorkScheduleInfo | null = null;
        if (user.companyId) {
          try {
            const resolved = await resolveEmployeeScheduleForDate(user.id, user.companyId, todayYmd);
            schedToday = resolved.schedule;
          } catch {
            schedToday = null;
          }
        }
        setTodaySchedule(schedToday);

        let rows: any[] = [];
        try {
          rows = (await getTimeRecordsForEmployeeDashboard(user.id, user.companyId, monthStart, todayYmd)) as any[];
          logDashboardDebug('API RESPONSE', {
            endpoint: '/api/data/time_records',
            query: 'time_records por company_id e user_id, com alias users.id/employees.id resolvido por e-mail quando disponível',
            filters: [
              ...(user.companyId ? [{ column: 'company_id', operator: 'eq', value: user.companyId }] : []),
              { column: 'user_id', operator: 'eq', value: user.id },
            ],
            periodStart: monthStart,
            periodEnd: todayYmd,
            count: rows.length,
            sample: rows.slice(0, 5),
          });
        } catch (error) {
          observabilityConsole.error('[EmployeeDashboard] time_records indisponível:', error);
          rows = [];
          try {
            const fallbackFilters = [
              ...(user.companyId ? [{ column: 'company_id' as const, operator: 'eq' as const, value: user.companyId }] : []),
              { column: 'user_id' as const, operator: 'eq' as const, value: user.id },
            ];
            rows =
              (await db.select(
                'time_records',
                fallbackFilters,
                {
                  columns: 'id, user_id, company_id, type, method, created_at, timestamp, source, origin',
                  orderBy: { column: 'created_at', ascending: false },
                  limit: 500,
                },
              )) ?? [];
            logDashboardDebug('API RESPONSE', {
              endpoint: '/api/data/time_records',
              fallback: true,
              filters: fallbackFilters,
              count: rows.length,
              sample: rows.slice(0, 5),
            });
          } catch (fallbackErr) {
            observabilityConsole.error('[EmployeeDashboard] fallback time_records falhou:', fallbackErr);
          }
        }
        logDashboardDebug('TIME RECORDS', rows);
        logDashboardDebug('PUNCHES', rows);
        const sortedAll = [...(rows ?? [])].sort((a, b) => recordPunchInstantMs(b) - recordPunchInstantMs(a));
        const todayList = sortedAll.filter(
          (r: any) => extractLocalCalendarDateFromIso(recordPunchInstantIso(r)) === todayYmd,
        );
        const monthList = sortedAll.filter(
          (r: any) => extractLocalCalendarDateFromIso(recordPunchInstantIso(r)) >= monthStart,
        );

        const todaySortedAsc = [...todayList].sort((a, b) => recordPunchInstantMs(a) - recordPunchInstantMs(b));
        setTodayRecords(todaySortedAsc);
        const lastPick = sortedAll.length > 0 ? sortedAll[0] : null;
        if (lastPick) {
          setLastRecord({
            type: String(lastPick.type ?? ''),
            displayAt: recordPunchInstantIso(lastPick),
            originLabel: resolvePunchOrigin(lastPick).label,
          });
        } else {
          setLastRecord(null);
        }

        if (todaySortedAsc.length > 0) {
          setTodayHours(formatarTempoLegivel(calcularHorasHojeMs(todaySortedAsc)));
        } else {
          setTodayHours('0h 0m');
        }

        if (monthList.length > 0) {
          const byDayRaw = new Map<string, any[]>();
          monthList.forEach((r: any) => {
            const day = extractLocalCalendarDateFromIso(recordPunchInstantIso(r));
            if (!byDayRaw.has(day)) byDayRaw.set(day, []);
            byDayRaw.get(day)!.push(r);
          });
          let totalMsMonth = 0;
          byDayRaw.forEach((recs) => {
            const sorted = [...recs].sort((a, b) => recordPunchInstantMs(a) - recordPunchInstantMs(b));
            totalMsMonth += calcularHorasHojeMs(sorted);
          });
          const totalMin = Math.floor(totalMsMonth / 60000);
          const mh = Math.floor(totalMin / 60);
          const mm = totalMin % 60;
          setMonthHours(`${mh}h ${mm}m`);
        } else {
          setMonthHours('0h 0m');
        }

        try {
          const reqs = (await db.select('requests', [{ column: 'user_id', operator: 'eq', value: user.id }], {
            columns: 'id, status',
            limit: 100,
          })) as any[];
          const pending = (reqs ?? []).filter((r: any) => (r.status || '').toLowerCase() === 'pending' || (r.status || '').toLowerCase() === 'pendente');
          setPendingRequests(pending.length);
        } catch {
          setPendingRequests(0);
        }

        try {
          const monthPrefix = new Date().toISOString().slice(0, 7);
          const companyId = String(user.companyId ?? '').trim();
          const ledgerFilters = [
            { column: 'employee_id', operator: 'eq' as const, value: user.id },
            { column: 'date', operator: 'gte' as const, value: `${monthPrefix}-01` },
            { column: 'date', operator: 'lte' as const, value: monthEndYmd(monthPrefix) },
            ...(companyId ? [{ column: 'company_id' as const, operator: 'eq' as const, value: companyId }] : []),
          ];
          const ledgerRows = await db
            .select('bank_hours_ledger', ledgerFilters, { column: 'created_at', ascending: false }, 400)
            .catch(() => [] as any[]);
          if (ledgerRows?.length) {
            const creditMin = ledgerRows
              .filter((r: any) => String(r.type).toUpperCase() === 'CREDIT')
              .reduce((s: number, r: any) => s + Math.max(0, Number(r.minutes ?? 0)), 0);
            const debitMin = ledgerRows
              .filter((r: any) => String(r.type).toUpperCase() === 'DEBIT')
              .reduce((s: number, r: any) => s + Math.max(0, Number(r.minutes ?? 0)), 0);
            const bal = computeLedgerAvailableBalanceMinutes(ledgerRows) / 60;
            setBalanceHours(formatSignedHours(bal));
            setBankCreditDebit(`Este mês: +${(creditMin / 60).toFixed(1)}h crédito · −${(debitMin / 60).toFixed(1)}h débito`);
          } else {
            setBalanceHours('0h');
            setBankCreditDebit('Sem movimentações no banco ainda');
          }
          logDashboardDebug('DASHBOARD_DATA', {
            todayRecords: todaySortedAsc.length,
            lastRecord: lastPick,
            todayHours: todaySortedAsc.length > 0 ? formatarTempoLegivel(calcularHorasHojeMs(todaySortedAsc)) : '0h 0m',
            monthRecords: monthList.length,
            ledgerRows: ledgerRows?.length ?? 0,
            pendingRequests,
          });
          logDashboardDebug('TIMESHEET_DATA', {
            source: 'time_records',
            periodStart: monthStart,
            periodEnd: todayYmd,
            todayRecords: todaySortedAsc.length,
            monthRecords: monthList.length,
            ledgerRows: ledgerRows?.length ?? 0,
          });
        } catch {
          setBalanceHours('—');
          setBankCreditDebit('Indisponível');
        }

        if (user.schedule_id) {
          try {
            const sched = (await db.select('schedules', [
              ...(user.companyId ? [{ column: 'company_id' as const, operator: 'eq' as const, value: user.companyId }] : []),
              { column: 'id' as const, operator: 'eq' as const, value: user.schedule_id },
            ])) as any[];
            if (sched?.[0]) setScheduleName(sched[0].name || '—');
          } catch {
            setScheduleName('—');
          }
        } else if (user.scheduleName) {
          setScheduleName(user.scheduleName);
        }

        try {
          const notices = (await db.select(
            'notifications',
            [
              ...(user.companyId ? [{ column: 'company_id' as const, operator: 'eq' as const, value: user.companyId }] : []),
              { column: 'user_id' as const, operator: 'eq' as const, value: user.id },
              { column: 'read' as const, operator: 'eq' as const, value: false },
            ],
            {
              columns: NOTIFICATION_LIST_COLUMNS,
              orderBy: { column: 'created_at', ascending: false },
              limit: 20,
            },
          )) as Array<{ id?: string; title?: string; message?: string; metadata?: Record<string, unknown> }>;
          setCompanyNotices(
            (notices ?? [])
              .filter((n) => isCompanyWideNotice(n))
              .slice(0, 5)
              .map((n: { id?: string; title?: string; message?: string; created_at?: string }) => ({
                id: String(n.id ?? ''),
                title: String(n.title ?? 'Aviso'),
                body: String(n.message ?? ''),
                createdAt: String(n.created_at ?? ''),
              }))
              .filter((n) => n.id),
          );
        } catch {
          setCompanyNotices([]);
        }
      } catch (e) {
        observabilityConsole.error(e);
      } finally {
        if (showLoading) setLoadingData(false);
      }
    },
    [user],
  );

  useEffect(() => {
    const timer = window.setInterval(() => setNowClock(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    void loadDashboard({ showLoading: true });
  }, [loadDashboard]);

  useEffect(() => {
    if (!user?.id) return;
    const t = window.setInterval(() => {
      void loadDashboard({ showLoading: false });
    }, 15_000);
    return () => window.clearInterval(t);
  }, [user?.id, loadDashboard]);

  const statusLabel = (() => {
    const latestToday = todayRecords.length > 0 ? todayRecords[todayRecords.length - 1] : null;
    if (!latestToday?.type) return i18n.t('dashboard.statusOff');
    const op = deriveOperationalStatusFromLastPunch(String(latestToday.type));
    if (op === EmployeeOperationalStatus.CLOSED || op === EmployeeOperationalStatus.OFF_DUTY) {
      return i18n.t('dashboard.statusOff');
    }
    if (
      op === EmployeeOperationalStatus.WORKING ||
      op === EmployeeOperationalStatus.BREAK ||
      op === EmployeeOperationalStatus.LUNCH
    ) {
      if (todaySchedule && !isLocalClockWithinWorkSchedule(todaySchedule)) {
        return i18n.t('dashboard.statusOff');
      }
    }
    if (op === EmployeeOperationalStatus.WORKING) return i18n.t('dashboard.statusWorking');
    if (op === EmployeeOperationalStatus.BREAK) return i18n.t('dashboard.statusBreak');
    if (op === EmployeeOperationalStatus.LUNCH) return i18n.t('dashboard.statusLunch');
    return i18n.t('dashboard.statusOff');
  })();

  if (loading) return <LoadingState message={i18n.t('common.loading')} />;
  if (!user) return <Navigate to="/" replace />;

  return (
    <div className="space-y-8">
      <PageHeader title={i18n.t('dashboard.employeeTitle')} subtitle={i18n.t('dashboard.employeeSubtitle')} />

      <div className="rounded-2xl border border-indigo-200 dark:border-indigo-900/50 bg-gradient-to-r from-indigo-50 to-white dark:from-indigo-950/40 dark:to-slate-900/50 p-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <p className="text-xs font-bold text-indigo-600 dark:text-indigo-400 uppercase tracking-wider">Horário atual</p>
          <p className="text-3xl font-bold text-slate-900 dark:text-white tabular-nums">
            {nowClock.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </p>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
            {nowClock.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })}
          </p>
        </div>
        <div className="text-left sm:text-right">
          <p className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Próxima escala</p>
          <p className="text-lg font-bold text-slate-900 dark:text-white">{loadingData ? '—' : scheduleName}</p>
          {todaySchedule?.start_time && todaySchedule?.end_time && (
            <p className="text-sm text-slate-600 dark:text-slate-400 tabular-nums">
              Hoje: {formatScheduleTimeDisplay(todaySchedule.start_time)} –{' '}
              {formatScheduleTimeDisplay(todaySchedule.end_time)}
            </p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/50 p-6 flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-emerald-500 flex items-center justify-center text-white">
            <Activity className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">{i18n.t('dashboard.currentStatus')}</p>
            <p className="text-lg font-bold text-slate-900 dark:text-white">{statusLabel}</p>
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/50 p-6 flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-blue-500 flex items-center justify-center text-white">
            <Clock className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">{i18n.t('dashboard.lastRecord')}</p>
            <p className="text-lg font-bold text-slate-900 dark:text-white tabular-nums">
              {lastRecord
                ? new Date(lastRecord.displayAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
                : '—'}
            </p>
            {lastRecord && (
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">Origem: {lastRecord.originLabel}</p>
            )}
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/50 p-6 flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-indigo-500 flex items-center justify-center text-white">
            <Clock className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">{i18n.t('dashboard.hoursThisMonth')}</p>
            <p className="text-lg font-bold text-slate-900 dark:text-white tabular-nums">{monthHours || '0h 0m'}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => navigate('/employee/time-balance')}
          className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/50 p-6 flex items-center gap-4 text-left w-full hover:border-amber-300 dark:hover:border-amber-700 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
        >
          <div className="w-12 h-12 rounded-xl bg-amber-500 flex items-center justify-center text-white shrink-0">
            <Scale className="w-6 h-6" />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">{i18n.t('dashboard.balanceHours')}</p>
            <p className="text-lg font-bold text-slate-900 dark:text-white tabular-nums">{loadingData ? '—' : balanceHours}</p>
            {bankCreditDebit && (
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 truncate" title={bankCreditDebit}>
                {bankCreditDebit}
              </p>
            )}
            <p className="text-[10px] text-amber-700 dark:text-amber-300 mt-1 font-medium">Ver banco de horas →</p>
          </div>
        </button>
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/50 p-6 flex items-center gap-4 sm:col-span-2 lg:col-span-1">
          <div className="w-12 h-12 rounded-xl bg-violet-500 flex items-center justify-center text-white">
            <ClipboardList className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">{i18n.t('dashboard.pendingRequests')}</p>
            <p className="text-lg font-bold text-slate-900 dark:text-white tabular-nums">{loadingData ? '—' : pendingRequests}</p>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/50 p-6">
        <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-4">{i18n.t('dashboard.quickActions')}</h3>
        <div className="flex flex-wrap gap-3">
          <Button type="button" onClick={() => navigate('/employee/clock')} className="flex items-center gap-2">
            <LogIn className="w-4 h-4" />
            {i18n.t('dashboard.clockIn')}
          </Button>
          <Button type="button" variant="outline" onClick={() => navigate('/employee/clock')} className="flex items-center gap-2">
            <LogOut className="w-4 h-4" />
            {i18n.t('dashboard.clockOut')}
          </Button>
          <Button type="button" variant="outline" onClick={() => navigate('/employee/requests')} className="flex items-center gap-2">
            <FileEdit className="w-4 h-4" />
            {i18n.t('dashboard.requestAdjustment')}
          </Button>
          <Button type="button" variant="outline" onClick={() => navigate('/employee/timesheet')} className="flex items-center gap-2">
            <FileText className="w-4 h-4" />
            {i18n.t('dashboard.viewTimesheetEmployee')}
          </Button>
          <Button type="button" variant="outline" onClick={() => navigate('/employee/work-schedule')} className="flex items-center gap-2">
            <CalendarClock className="w-4 h-4" />
            {i18n.t('dashboard.myScheduleCta')}
          </Button>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/50 p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-4">
          <h3 className="text-lg font-bold text-slate-900 dark:text-white">{i18n.t('dashboard.hoursWorkedToday')}</h3>
          <Button type="button" size="sm" onClick={() => navigate('/employee/clock')}>
            {i18n.t('menu.registrarPonto')}
          </Button>
        </div>
        <p className="text-2xl font-bold text-slate-900 dark:text-white tabular-nums mb-4">{todayHours || '0h 0m'}</p>
        <ul className="space-y-2">
          {todayRecords.length === 0 && !loadingData && <li className="text-slate-500 dark:text-slate-400 text-sm">{i18n.t('dashboard.noRecordsToday')}</li>}
          {todayRecords.map((r: any, idx: number) => (
            <li key={r.id} className="flex justify-between items-center py-2 border-b border-slate-100 dark:border-slate-800 last:border-0">
              <span className="font-medium text-slate-900 dark:text-white">
                {punchTypeLabelFromMirrorNorm(inferDashboardPunchDisplayMirrorType(todayRecords, idx))}
              </span>
              <span className="tabular-nums text-slate-600 dark:text-slate-300">
                {new Date(recordPunchInstantIso(r)).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
              </span>
            </li>
          ))}
        </ul>
      </div>

      {companyNotices.length > 0 && (
        <div className="rounded-2xl border border-amber-200 dark:border-amber-900/40 bg-amber-50/60 dark:bg-amber-950/20 p-6">
          <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-4">Avisos da empresa</h3>
          <ul className="space-y-3">
            {companyNotices.map((notice) => (
              <li key={notice.id} className="rounded-xl border border-amber-100 dark:border-amber-900/30 bg-white/80 dark:bg-slate-900/40 p-4">
                <p className="font-semibold text-slate-900 dark:text-white">{notice.title}</p>
                {notice.body && <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">{notice.body}</p>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

export default EmployeeDashboard;
