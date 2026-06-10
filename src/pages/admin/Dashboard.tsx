import { observabilityConsole } from '../../shared/logger/observabilityConsole';
import React, { useEffect, useState, memo, useCallback, lazy, Suspense } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import {
  Users,
  UserCheck,
  ClipboardList,
  UserX,
  CheckCircle2,
  Circle,
} from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import PageHeader from '../../components/PageHeader';
import { Button, LoadingState } from '../../../components/UI';
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
import { explainDashboardMetric, type DashboardMetricId } from '../../help/helpExplainMetrics';
import {
  fetchTenantOnboardingStatus,
  hasTenantOnboardingGaps,
  type TenantOnboardingStatus,
} from '../../services/tenantOnboardingStatus.service';

const DashboardLastRecordsGeoPanel = lazy(() => import('./DashboardLastRecordsGeoPanel'));
interface CardData {
  totalEmployees: number;
  activeEmployees: number;
  recordsToday: number;
  absentToday: number;
}

const ONBOARDING_STEPS = [
  { key: 'departments', label: 'Cadastrar departamentos', route: '/admin/departments' },
  { key: 'schedules', label: 'Cadastrar escalas', route: '/admin/schedules' },
  { key: 'journeys', label: 'Cadastrar jornadas', route: '/admin/colaborador-jornada' },
  { key: 'employees', label: 'Cadastrar colaboradores', route: '/admin/employees' },
  { key: 'bankRules', label: 'Configurar banco de horas', route: '/admin/settings' },
  { key: 'holidays', label: 'Configurar feriados', route: '/admin/feriados' },
] as const;

function FirstAccessOnboardingCard({
  status,
  onNavigate,
}: {
  status: TenantOnboardingStatus;
  onNavigate: (route: string) => void;
}) {
  const nextStep = ONBOARDING_STEPS.find((step) => status[step.key] === 0);
  return (
    <section className="rounded-2xl border border-indigo-200 dark:border-indigo-900/60 bg-indigo-50/80 dark:bg-indigo-950/30 p-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-indigo-600 dark:text-indigo-300">
            Primeiro acesso
          </p>
          <h2 className="mt-1 text-2xl font-bold text-slate-900 dark:text-white">Bem-vindo ao PontoWebDesk</h2>
          <p className="mt-2 max-w-2xl text-sm text-slate-600 dark:text-slate-300">
            Complete a configuração inicial da empresa. Todos os itens abaixo são consultados com o
            `company_id` da sua sessão.
          </p>
        </div>
        {nextStep && (
          <Button type="button" size="sm" onClick={() => onNavigate(nextStep.route)}>
            Continuar configuração
          </Button>
        )}
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {ONBOARDING_STEPS.map((step) => {
          const done = status[step.key] > 0;
          const Icon = done ? CheckCircle2 : Circle;
          return (
            <button
              key={step.key}
              type="button"
              onClick={() => onNavigate(step.route)}
              className="flex items-center gap-3 rounded-xl border border-white/70 dark:border-slate-800 bg-white/80 dark:bg-slate-900/60 px-4 py-3 text-left transition hover:border-indigo-300 dark:hover:border-indigo-700"
            >
              <Icon className={`h-5 w-5 ${done ? 'text-emerald-500' : 'text-slate-400'}`} />
              <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">{step.label}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
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
  const { user, loading } = useAuth();
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
  const [onboardingStatus, setOnboardingStatus] = useState<TenantOnboardingStatus | null>(null);

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
    if (!user?.companyId) {
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
        observabilityConsole.error('Erro ao carregar cards do dashboard admin:', e);
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
    if (!user?.companyId) {
      setOnboardingStatus(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const status = await fetchTenantOnboardingStatus(user.companyId);
        if (!cancelled) setOnboardingStatus(status);
      } catch (e) {
        observabilityConsole.error('Erro ao carregar onboarding do tenant:', e);
        if (!cancelled) setOnboardingStatus(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.companyId]);

  useEffect(() => {
    if (!user?.companyId) {
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
          observabilityConsole.error('Erro ao carregar últimos registros:', e);
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

  const cardItems: {
    label: string;
    value: number;
    icon: typeof Users;
    color: string;
    metricId: DashboardMetricId;
  }[] = [
    {
      label: i18n.t('dashboard.totalEmployees'),
      value: cards.totalEmployees,
      icon: Users,
      color: 'bg-indigo-500',
      metricId: 'totalEmployees',
    },
    {
      label: i18n.t('dashboard.activeEmployees'),
      value: cards.activeEmployees,
      icon: UserCheck,
      color: 'bg-emerald-500',
      metricId: 'activeEmployees',
    },
    {
      label: i18n.t('dashboard.recordsToday'),
      value: cards.recordsToday,
      icon: ClipboardList,
      color: 'bg-blue-500',
      metricId: 'recordsToday',
    },
    {
      label: i18n.t('dashboard.absentToday'),
      value: cards.absentToday,
      icon: UserX,
      color: 'bg-amber-500',
      metricId: 'absentToday',
    },
  ];

  const showFullSkeleton = loadingCards && cards.totalEmployees === 0 && cards.recordsToday === 0;
  const showOnboarding = hasTenantOnboardingGaps(onboardingStatus);

  return (
    <div className="space-y-8">
      <PageHeader title={i18n.t('dashboard.adminTitle')} />

      {showOnboarding && onboardingStatus && (
        <FirstAccessOnboardingCard status={onboardingStatus} onNavigate={(route) => navigate(route)} />
      )}

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
                    <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1 leading-snug max-w-[200px]">
                      {explainDashboardMetric(item.metricId)}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>


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
