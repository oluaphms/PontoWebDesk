import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import { Clock, CalendarDays, Activity, Scale, ClipboardList, LogIn, LogOut, FileEdit, FileText, CalendarClock } from 'lucide-react';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import PageHeader from '../../components/PageHeader';
import { db, isSupabaseConfigured, supabase, getSupabaseClient } from '../../services/supabaseClient';
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
  type WorkScheduleInfo,
} from '../../services/timeProcessingService';
import { recordPunchInstantIso, recordPunchInstantMs, resolvePunchOrigin } from '../../utils/punchOrigin';
import { deriveOperationalStatusFromLastPunch, EmployeeOperationalStatus } from '../../types/employeeOperationalStatus';

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
  const [loadingData, setLoadingData] = useState(true);
  const [todaySchedule, setTodaySchedule] = useState<WorkScheduleInfo | null>(null);

  const loadDashboard = useCallback(
    async (options?: { showLoading?: boolean }) => {
      const showLoading = options?.showLoading !== false;
      if (!user) return;
      if (!isSupabaseConfigured()) {
        setLoadingData(false);
        return;
      }
      if (showLoading) setLoadingData(true);
      try {
        const todayYmd = localTodayYmd();
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
          rows = (await getTimeRecordsForEmployeeDashboard(user.id)) as any[];
        } catch (error) {
          // Não interrompe o dashboard por timeout transitório do Supabase.
          console.warn('[EmployeeDashboard] time_records indisponível no momento:', error);
          rows = [];
          // Fallback local direto para evitar cards vazios quando a primeira consulta expira.
          try {
            rows =
              (await db.select(
                'time_records',
                [{ column: 'user_id', operator: 'eq', value: user.id }],
                {
                  columns: 'id, user_id, company_id, type, method, created_at, timestamp, source, origin',
                  orderBy: { column: 'created_at', ascending: false },
                  limit: 500,
                },
              )) ?? [];
          } catch (fallbackErr) {
            console.warn('[EmployeeDashboard] fallback time_records falhou:', fallbackErr);
          }
        }
        const sortedAll = [...(rows ?? [])].sort((a, b) => recordPunchInstantMs(b) - recordPunchInstantMs(a));
        const todayList = sortedAll.filter(
          (r: any) => extractLocalCalendarDateFromIso(recordPunchInstantIso(r)) === todayYmd,
        );
        const now = new Date();
        const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
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
          const bankRows = (await db.select(
            'bank_hours',
            [{ column: 'employee_id', operator: 'eq', value: user.id }],
            { column: 'date', ascending: false },
            200,
          )) as any[];
          const latest = bankRows?.[0];
          const bal = latest != null && latest.balance != null ? Number(latest.balance) : null;
          if (bal != null && !Number.isNaN(bal)) {
            const sign = bal > 0 ? '+' : '';
            setBalanceHours(`${sign}${bal.toFixed(1)}h`);
            const monthPrefix = new Date().toISOString().slice(0, 7);
            const monthMovs = (bankRows ?? []).filter((r: any) => (r.date || '').slice(0, 7) === monthPrefix);
            const credit = monthMovs.reduce((s, r) => s + Number(r.hours_added ?? 0), 0);
            const debit = monthMovs.reduce((s, r) => s + Number(r.hours_removed ?? 0), 0);
            setBankCreditDebit(`Este mês: +${credit.toFixed(1)}h crédito · −${debit.toFixed(1)}h débito`);
          } else {
            setBalanceHours('0h');
            setBankCreditDebit('Sem movimentações no banco ainda');
          }
        } catch {
          setBalanceHours('—');
          setBankCreditDebit('Indisponível');
        }

        if (user.schedule_id) {
          try {
            const sched = (await db.select('schedules', [{ column: 'id', operator: 'eq', value: user.schedule_id }])) as any[];
            if (sched?.[0]) setScheduleName(sched[0].name || '—');
          } catch {
            setScheduleName('—');
          }
        }
      } catch (e) {
        console.error(e);
      } finally {
        if (showLoading) setLoadingData(false);
      }
    },
    [user],
  );

  useEffect(() => {
    void loadDashboard({ showLoading: true });
  }, [loadDashboard]);

  useEffect(() => {
    if (!user?.id || !getSupabaseClient() || !isSupabaseConfigured()) return;
    let t: ReturnType<typeof setTimeout> | null = null;
    const channel = supabase
      .channel(`employee_dash_records_${user.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'time_records', filter: `user_id=eq.${user.id}` },
        () => {
          if (t) clearTimeout(t);
          t = setTimeout(() => {
            t = null;
            void loadDashboard({ showLoading: false });
          }, 400);
        },
      )
      .subscribe();
    return () => {
      if (t) clearTimeout(t);
      void supabase.removeChannel(channel);
    };
  }, [user?.id, loadDashboard]);

  const statusLabel = (() => {
    if (!lastRecord?.type) return i18n.t('dashboard.statusOff');
    const op = deriveOperationalStatusFromLastPunch(lastRecord.type);
    if (op === EmployeeOperationalStatus.CLOSED || op === EmployeeOperationalStatus.OFF_DUTY) {
      return i18n.t('dashboard.statusOff');
    }
    if (
      op === EmployeeOperationalStatus.WORKING ||
      op === EmployeeOperationalStatus.BREAK ||
      op === EmployeeOperationalStatus.LUNCH
    ) {
      if (!todaySchedule || !isLocalClockWithinWorkSchedule(todaySchedule)) {
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
    </div>
  );
};

export default EmployeeDashboard;
