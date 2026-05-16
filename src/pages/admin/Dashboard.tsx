import React, { useEffect, useState, memo, useCallback, lazy, Suspense } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import {
  Users,
  UserCheck,
  ClipboardList,
  UserX,
} from 'lucide-react';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import PageHeader from '../../components/PageHeader';
import { checkSupabaseConfigured } from '../../services/supabaseClient';
import { LoadingState } from '../../../components/UI';
import { useLanguage } from '../../contexts/LanguageContext';
import { i18n } from '../../../lib/i18n';
import {
  getAdminDashboardCardsQuick,
  getAdminDashboardLastRecordsOnly,
  type AdminDashboardLastRecord,
} from '../../services/dashboard.service';
import { getActiveLoginTrace, traceLoginStep } from '../../auth/authPerformanceTrace';
import { logReactRenderTraceTop10 } from '../../performance/reactRenderTrace';
import { markDashboardInteractiveIfNeeded } from '../../app/loginPerformanceBudgets';
import { opLog } from '../../utils/operationalLogger';

const DashboardLastRecordsGeoPanel = lazy(() => import('./DashboardLastRecordsGeoPanel'));
const OperationalRiskCard = lazy(() => import('../../components/dashboard/OperationalRiskCard'));
const OperationalStatusPanel = lazy(() => import('../../components/dashboard/OperationalStatusPanel'));
const OperationalAlertsPanel = lazy(() => import('../../components/dashboard/OperationalAlertsPanel'));
const OperationalTasksPanel = lazy(() => import('../../components/dashboard/OperationalTasksPanel'));
const OperationalAuditPanel = lazy(() => import('../../components/dashboard/OperationalAuditPanel'));

interface CardData {
  totalEmployees: number;
  activeEmployees: number;
  recordsToday: number;
  absentToday: number;
}

function DashboardSkeleton() {
  return (
    <div className="animate-pulse space-y-8">
      <div className="h-10 w-64 bg-slate-200 dark:bg-slate-800 rounded-lg" />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((k) => (
          <div key={k} className="h-28 rounded-2xl bg-slate-200 dark:bg-slate-800" />
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="h-64 rounded-2xl bg-slate-200 dark:bg-slate-800" />
        <div className="h-64 rounded-2xl bg-slate-200 dark:bg-slate-800" />
      </div>
    </div>
  );
}

const AdminDashboard: React.FC = () => {
  const { user, loading } = useCurrentUser();
  const navigate = useNavigate();
  useLanguage();
  const [cards, setCards] = useState<CardData>({
    totalEmployees: 0,
    activeEmployees: 0,
    recordsToday: 0,
    absentToday: 0,
  });
  const [lastRecords, setLastRecords] = useState<AdminDashboardLastRecord[]>([]);
  const [loadingCards, setLoadingCards] = useState(true);
  const [loadingRecords, setLoadingRecords] = useState(true);
  const [deferredHeavyInit, setDeferredHeavyInit] = useState(false);

  const goTimesheet = useCallback(() => navigate('/admin/timesheet'), [navigate]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    opLog.info('DASHBOARD DEFERRED INIT', { phase: 'schedule' });
    const run = () => {
      opLog.info('DASHBOARD DEFERRED INIT', { phase: 'run' });
      setDeferredHeavyInit(true);
    };
    const w = window;
    if ('requestIdleCallback' in w) {
      const id = w.requestIdleCallback(run, { timeout: 1200 });
      return () => w.cancelIdleCallback(id);
    }
    const t = window.setTimeout(run, 48);
    return () => window.clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!user?.companyId || !checkSupabaseConfigured()) {
      setLoadingCards(false);
      return;
    }

    let cancelled = false;
    const safety = window.setTimeout(() => setLoadingCards(false), 8000);
    setLoadingCards(true);
    void (async () => {
      try {
        const c = await getAdminDashboardCardsQuick(user.companyId);
        if (!cancelled && c) setCards(c);
        if (!cancelled && c) {
          opLog.info('DASHBOARD CRITICAL READY', { companyId: user.companyId });
          markDashboardInteractiveIfNeeded();
        }
      } catch (e) {
        console.error('Erro ao carregar cards do dashboard admin:', e);
      } finally {
        window.clearTimeout(safety);
        if (!cancelled) setLoadingCards(false);
      }
    })();
    return () => {
      cancelled = true;
      window.clearTimeout(safety);
    };
  }, [user?.companyId]);

  useEffect(() => {
    if (!user?.companyId || !checkSupabaseConfigured()) {
      setLoadingRecords(false);
      return;
    }

    let cancelled = false;
    setLoadingRecords(true);

    const run = () => {
      void (async () => {
        try {
          const lr = await getAdminDashboardLastRecordsOnly(user.companyId!);
          if (!cancelled) setLastRecords(lr);
        } catch (e) {
          console.error('Erro ao carregar últimos registros:', e);
        } finally {
          if (!cancelled) setLoadingRecords(false);
        }
      })();
    };

    if (typeof window !== 'undefined') {
      const ric = window.requestIdleCallback;
      if (typeof ric === 'function') {
        const id = ric.call(window, run, { timeout: 2400 });
        return () => {
          cancelled = true;
          window.cancelIdleCallback(id);
        };
      }
      const tid = window.setTimeout(run, 32);
      return () => {
        cancelled = true;
        window.clearTimeout(tid);
      };
    }
    return () => {
      cancelled = true;
    };
  }, [user?.companyId]);

  useEffect(() => {
    if (!user || loadingCards || loadingRecords || !deferredHeavyInit) return;
    opLog.info('DASHBOARD FULLY HYDRATED');
    traceLoginStep(getActiveLoginTrace(), 'dashboard_rendered');
    logReactRenderTraceTop10('dashboard_fully_hydrated');
  }, [user, loadingCards, loadingRecords, deferredHeavyInit]);

  if (!user && loading) return <LoadingState message={i18n.t('common.loading')} />;
  if (!user) return <Navigate to="/" replace />;

  const cardItems = [
    { label: i18n.t('dashboard.totalEmployees'), value: cards.totalEmployees, icon: Users, color: 'bg-indigo-500' },
    { label: i18n.t('dashboard.activeEmployees'), value: cards.activeEmployees, icon: UserCheck, color: 'bg-emerald-500' },
    { label: i18n.t('dashboard.recordsToday'), value: cards.recordsToday, icon: ClipboardList, color: 'bg-blue-500' },
    { label: i18n.t('dashboard.absentToday'), value: cards.absentToday, icon: UserX, color: 'bg-amber-500' },
  ];

  const showFullSkeleton = loadingCards && cards.totalEmployees === 0 && cards.recordsToday === 0;

  return (
    <div className="space-y-8">
      <PageHeader title={i18n.t('dashboard.adminTitle')} />

      {showFullSkeleton ? (
        <DashboardSkeleton />
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {cardItems.map((item) => {
              const Icon = item.icon;
              return (
                <div
                  key={item.label}
                  className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/50 p-6 flex items-center gap-4"
                >
                  <div className={`w-12 h-12 rounded-xl ${item.color} flex items-center justify-center text-white`}>
                    <Icon className="w-6 h-6" />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                      {item.label}
                    </p>
                    <p
                      className={`text-2xl font-bold text-slate-900 dark:text-white tabular-nums ${
                        loadingCards ? 'animate-pulse text-slate-400 dark:text-slate-500' : ''
                      }`}
                    >
                      {loadingCards ? '—' : item.value}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>

          {user.companyId && (
            <Suspense
              fallback={<div className="h-28 rounded-2xl bg-slate-200 dark:bg-slate-800 animate-pulse" aria-hidden />}
            >
              <OperationalRiskCard companyId={user.companyId} />
            </Suspense>
          )}

          {user.companyId && (
            <Suspense
              fallback={<div className="h-48 rounded-2xl bg-slate-200 dark:bg-slate-800 animate-pulse" aria-hidden />}
            >
              <OperationalStatusPanel companyId={user.companyId} />
            </Suspense>
          )}

          {user.companyId && (
            <Suspense
              fallback={<div className="h-48 rounded-2xl bg-slate-200 dark:bg-slate-800 animate-pulse" aria-hidden />}
            >
              <OperationalAlertsPanel companyId={user.companyId} />
            </Suspense>
          )}

          {user.companyId && (
            <Suspense
              fallback={<div className="h-48 rounded-2xl bg-slate-200 dark:bg-slate-800 animate-pulse" aria-hidden />}
            >
              <OperationalTasksPanel companyId={user.companyId} />
            </Suspense>
          )}

          {user.companyId && (
            <Suspense
              fallback={<div className="h-64 rounded-2xl bg-slate-200 dark:bg-slate-800 animate-pulse" aria-hidden />}
            >
              <OperationalAuditPanel companyId={user.companyId} />
            </Suspense>
          )}

          {loadingRecords ? (
            <div className="h-64 rounded-2xl bg-slate-200 dark:bg-slate-800 animate-pulse" aria-hidden />
          ) : (
            <Suspense
              fallback={<div className="h-64 rounded-2xl bg-slate-200 dark:bg-slate-800 animate-pulse" aria-hidden />}
            >
              <DashboardLastRecordsGeoPanel
                lastRecords={lastRecords}
                deferredHeavyInit={deferredHeavyInit}
                onNavigateTimesheet={goTimesheet}
              />
            </Suspense>
          )}
        </>
      )}
    </div>
  );
};

export default memo(AdminDashboard);
