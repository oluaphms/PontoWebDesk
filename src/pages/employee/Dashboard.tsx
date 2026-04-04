import React, { useEffect, useState } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import { Clock, CalendarDays, Activity, Scale, ClipboardList, LogIn, LogOut, FileEdit, FileText } from 'lucide-react';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import PageHeader from '../../components/PageHeader';
import { db, isSupabaseConfigured } from '../../services/supabaseClient';
import { Button, LoadingState } from '../../../components/UI';
import { calculateWorkedHours } from '../../utils/timeCalculations';
import { LogType, PunchMethod } from '../../../types';
import type { TimeRecord } from '../../../types';
import { useLanguage } from '../../contexts/LanguageContext';
import { i18n } from '../../../lib/i18n';

const EmployeeDashboard: React.FC = () => {
  const { user, loading } = useCurrentUser();
  const navigate = useNavigate();
  useLanguage();
  const [lastRecord, setLastRecord] = useState<{ type: string; created_at: string } | null>(null);
  const [todayRecords, setTodayRecords] = useState<any[]>([]);
  const [todayHours, setTodayHours] = useState('');
  const [monthHours, setMonthHours] = useState('');
  const [balanceHours, setBalanceHours] = useState<string>('—');
  const [bankCreditDebit, setBankCreditDebit] = useState<string>('');
  const [pendingRequests, setPendingRequests] = useState(0);
  const [scheduleName, setScheduleName] = useState<string>('—');
  const [loadingData, setLoadingData] = useState(true);

  useEffect(() => {
    if (!user || !isSupabaseConfigured) return;
    const load = async () => {
      setLoadingData(true);
      try {
        const rows = (await db.select('time_records', [{ column: 'user_id', operator: 'eq', value: user.id }], { column: 'created_at', ascending: false }, 500)) as any[];
        const today = new Date().toISOString().slice(0, 10);
        const todayList = (rows ?? []).filter((r: any) => (r.created_at || '').slice(0, 10) === today);
        const now = new Date();
        const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
        const monthList = (rows ?? []).filter((r: any) => (r.created_at || '').slice(0, 10) >= monthStart);

        setTodayRecords(todayList);
        if (todayList.length > 0) {
          setLastRecord({ type: todayList[0].type, created_at: todayList[0].created_at });
          const mapped: TimeRecord[] = todayList.map((r: any) => ({
            id: r.id,
            userId: r.user_id,
            companyId: r.company_id,
            type: r.type === 'entrada' ? LogType.IN : r.type === 'saída' ? LogType.OUT : LogType.BREAK,
            method: (r.method as PunchMethod) || PunchMethod.GPS,
            createdAt: new Date(r.created_at),
            ipAddress: '',
            deviceId: '',
            deviceInfo: { browser: '', os: '', isMobile: false, userAgent: '' },
          }));
          const worked = calculateWorkedHours(mapped, now);
          const h = Math.floor(worked);
          const m = Math.round((worked % 1) * 60);
          setTodayHours(`${h}h ${m}m`);
        } else if ((rows ?? []).length > 0) {
          setLastRecord({ type: rows[0].type, created_at: rows[0].created_at });
        } else {
          setLastRecord(null);
        }

        if (monthList.length > 0) {
          let totalMin = 0;
          const byDay = new Map<string, TimeRecord[]>();
          monthList.forEach((r: any) => {
            const day = (r.created_at || '').slice(0, 10);
            if (!byDay.has(day)) byDay.set(day, []);
            byDay.get(day)!.push({
              id: r.id,
              userId: r.user_id,
              companyId: r.company_id,
              type: r.type === 'entrada' ? LogType.IN : r.type === 'saída' ? LogType.OUT : LogType.BREAK,
              method: (r.method as PunchMethod) || PunchMethod.GPS,
              createdAt: new Date(r.created_at),
              ipAddress: '',
              deviceId: '',
              deviceInfo: { browser: '', os: '', isMobile: false, userAgent: '' },
            });
          });
          byDay.forEach((recs, day) => {
            totalMin += calculateWorkedHours(recs, new Date(day + 'T12:00:00')) * 60;
          });
          const mh = Math.floor(totalMin / 60);
          const mm = Math.round(totalMin % 60);
          setMonthHours(`${mh}h ${mm}m`);
        } else {
          setMonthHours('0h 0m');
        }

        try {
          const reqs = (await db.select('requests', [{ column: 'user_id', operator: 'eq', value: user.id }])) as any[];
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
        setLoadingData(false);
      }
    };
    load();
  }, [user?.id, user?.schedule_id]);

  const statusLabel = lastRecord?.type === 'entrada' ? i18n.t('dashboard.statusWorking') : lastRecord?.type === 'pausa' ? i18n.t('dashboard.statusBreak') : i18n.t('dashboard.statusOff');

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
              {lastRecord ? new Date(lastRecord.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '—'}
            </p>
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/50 p-6 flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-indigo-500 flex items-center justify-center text-white">
            <Clock className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Horas no mês</p>
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
          {todayRecords.map((r: any) => (
            <li key={r.id} className="flex justify-between items-center py-2 border-b border-slate-100 dark:border-slate-800 last:border-0">
              <span className="font-medium text-slate-900 dark:text-white capitalize">{r.type === 'entrada' ? i18n.t('punch.typeIn') : r.type === 'saída' ? i18n.t('punch.typeOut') : r.type === 'pausa' ? i18n.t('punch.typeBreak') : r.type}</span>
              <span className="tabular-nums text-slate-600 dark:text-slate-300">
                {new Date(r.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
};

export default EmployeeDashboard;
