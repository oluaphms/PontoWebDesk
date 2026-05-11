import React, { useState, useCallback, useMemo, useEffect, useRef, useReducer, Profiler } from 'react';
import { flushSync } from 'react-dom';
import { Routes, Route, Navigate, useLocation, useNavigate, Outlet } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from './src/lib/queryClient';
import { AppInitializer } from './src/components/AppInitializer';
import { User, LogType, DailySummary, PunchMethod, Company } from './types';
import Layout from './components/Layout';
import Clock from './components/Clock';
import PunchModal from './components/PunchModal';
import Onboarding from './components/Onboarding';
import { Button, Badge, LoadingState, SuccessOverlay, Input } from './components/UI';
import RouteLoadingFallback from './src/components/RouteLoadingFallback';
import AppErrorBoundary from './components/ErrorBoundary';
import { getWorkInsights } from './services/geminiService';
import { isAiDashboardInsightsAutoEnabled } from './services/geminiEnv';
import { PontoService, getRecordCreatedAtDate } from './services/pontoService';
import { useRecords } from './src/hooks/useRecords';
import { authService } from './services/authService';
import { queryCache } from './src/services/queryCache';
import { beginPostLoginRequestBudgetWindow } from './src/performance/requestBudget';
import { installMobileClockDriftGuard } from './src/performance/mobileClockDriftGuard';
import { clearTenantScopedCaches } from './src/domain/operational/cache/tenantCacheIsolation';
import {
  checkSupabaseConfigured,
  testSupabaseConnection,
  resetSession,
  clearLocalAuthSession,
  clearCurrentUserFromAllStorages,
} from './services/supabaseClient';
import { getSupabaseClient } from './src/lib/supabaseClient';
import { checkSupabaseConnection } from './src/services/checkSupabaseConnection';
import { logSupabaseError } from './src/services/errorLogger';
import { validateLogin } from './lib/validationSchemas';
import {
  startReminderCheck,
  stopReminderCheck,
  getReminderConfig,
} from './services/pushReminderService';
import { ThemeService } from './services/themeService';
import {
  ScanLine,
  ShieldCheck,
  Crown,
  AlertTriangle,
  Clock as ClockIcon,
  CalendarDays,
  Sparkles,
  Building2,
  Lock,
  Settings,
  ExternalLink,
  Sun,
  Moon,
  Camera,
  Keyboard,
  MapPin,
  UserCog,
} from 'lucide-react';
import ForgotPasswordModal from './src/components/auth/ForgotPasswordModal';
import RoleGuard from './src/components/auth/RoleGuard';
import ProtectedRoute from './src/components/auth/ProtectedRoute';
import { PresentationPanel } from './src/components/auth/PresentationPanel';
import { LoginCard, type LoginRole } from './src/components/auth/LoginCard';
import SchemaGuardBadge from './src/components/dev/SchemaGuardBadge';
import { useSettings, SettingsProvider } from './src/contexts/SettingsContext';
import { useLanguage } from './src/contexts/LanguageContext';
import { i18n } from './lib/i18n';
import { useSessionTimeout } from './src/hooks/useSessionTimeout';
import { readCachedUser } from './src/hooks/useCurrentUser';
import { withTimeout } from './src/utils/withTimeout';
import {
  authFlowReducer,
  initialAuthFlowState,
  isAuthFlowBusy,
} from './src/auth/authFlowReducer';
import {
  createLoginTrace,
  traceLoginStep,
  finalizeLoginTrace,
  getActiveLoginTrace,
  getSlowestLoginStep,
} from './src/auth/authPerformanceTrace';
import { pushCriticalLoginPath, popCriticalLoginPath, scheduleDeferredBootstrap } from './src/auth/authBootstrapPriority';
import { requestAuthNavigation, resetAuthNavigationCoordinator } from './src/auth/navigationCoordinator';
import {
  beginHydration,
  createHydrationOwner,
  endHydration,
  isHydrationOwnerActive,
  withHydrationTimeout,
  getActiveHydrationOwnerToken,
} from './src/auth/authHydrationCoordinator';
import { logAuthWatchdogDump } from './src/auth/authWatchdog';
import { measureSupabaseAsync } from './src/auth/supabaseAuthLatency';
import { setLongTaskPipelineContext } from './src/performance/longTaskMonitor';
import { createReactProfilerOnRender } from './src/performance/reactRenderTrace';
import { useEffectStormProbe } from './src/performance/reactEffectStorm';
import { useDeferredPortalChrome } from './src/hooks/useDeferredPortalChrome';
import { SMARTPONTO_PROFILE_ENRICHED_EVENT } from './src/app/appShellBootstrap';
import { markLoginSubmitStarted, markLoginUiComplete, markFirstRouteIfNeeded } from './src/app/loginPerformanceBudgets';
import AdminLayout from './src/layouts/AdminLayout';
import EmployeeLayout from './src/layouts/EmployeeLayout';
import {
  AbsencesPage,
  AcceptInviteRoute,
  AdminAjuda,
  AdminMetricasProduto,
  AdminArquivarCalculos,
  AdminAusencias,
  AdminBankHours,
  AdminCartaoPonto,
  AdminCidades,
  AdminColunasMix,
  AdminCompany,
  AdminDashboard,
  AdminEmployees,
  AdminEstruturas,
  AdminEstadosCivis,
  AdminEventos,
  AdminPreFolha,
  AdminFeriados,
  AdminFiscalizacao,
  AdminImportRep,
  AdminRepUnresolvedPunches,
  AdminJobTitles,
  AdminJustificativas,
  AdminLancamentoEventos,
  AdminMonitoring,
  AdminMotivoDemissao,
  AdminPontoDiario,
  AdminReports,
  ReportReadPage,
  AdminRepDevices,
  AdminSchedules,
  AdminSecurity,
  AdminSettings,
  AdminShifts,
  AdminColaboradorJornada,
  AdminTimesheet,
  AdminCalculos,
  CompanyPage,
  DepartmentsPage,
  EmployeeClockIn,
  EmployeeDashboard,
  EmployeeMonitoring,
  EmployeeProfile,
  EmployeeSettings,
  EmployeeTimesheet,
  EmployeesPage,
  ImportEmployees,
  MyWorkSchedule,
  ProfileViewLazy,
  RealTimeInsightsPage,
  ReportBankHours,
  ReportInconsistencies,
  ReportOvertime,
  ReportSecurity,
  ReportsPage,
  ReportWorkHours,
  RequestsPage,
  ResetPasswordRoute,
  SchedulesPage,
  SettingsPage,
  TimeAttendancePage,
  TimeAttendanceAuditPage,
  GeolocationAuditPage,
  OperationalGeoPlaybackPage,
  TimeAttendanceTimelinePage,
  OperationalIncidentsPage,
  OperationalRecoveryPage,
  OperationalHealthCheckPage,
  OperationalObservabilityPage,
  ProductionControlCenterPage,
  OperationalLoadReportPage,
  RepOperationsCenterPage,
  TimeBalancePage,
  TimeClockPage,
  TimeRecordsPage,
  AdminArquivosFiscais,
} from './src/routes/portalLazyPages';

const isAdminRole = (role: User['role'] | undefined): boolean => role === 'admin' || role === 'hr';
const isRoleAllowedForSelectedLogin = (
  selectedRole: LoginRole,
  userRole: User['role'] | undefined,
): boolean => {
  if (selectedRole === 'admin') return isAdminRole(userRole);
  if (selectedRole === 'employee') return !isAdminRole(userRole);
  return true;
};
const getRoleMismatchMessageForLogin = (_selectedRole: LoginRole): string => 'Acesso negado';

function ConfigSupabaseScreen() {
  const isVercel = typeof window !== 'undefined' && /vercel\.app/i.test(window.location.hostname);
  return (
    <div className="min-h-screen gradient-bg flex flex-col items-center justify-center p-6 text-center">
      <div className="glass-card rounded-2xl p-8 max-w-lg w-full space-y-4">
        <div className="w-14 h-14 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center mx-auto">
          <Settings className="w-7 h-7 text-amber-600 dark:text-amber-400" />
        </div>
        <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">
          {i18n.t('app.configTitle')}
        </h1>
        <p className="text-slate-600 dark:text-slate-400 text-sm">
          {i18n.t('app.configDescription')}
        </p>
        {isVercel ? (
          <div className="text-left bg-slate-100 dark:bg-slate-800/50 rounded-xl p-4 text-sm space-y-2">
            <p className="font-medium text-slate-800 dark:text-slate-200">Na Vercel:</p>
            <ol className="list-decimal list-inside space-y-1 text-slate-600 dark:text-slate-400">
              <li>Project → <strong>Settings</strong> → <strong>Environment Variables</strong></li>
              <li>Adicione <code className="bg-slate-200 dark:bg-slate-700 px-1 rounded">VITE_SUPABASE_URL</code> (URL do projeto Supabase)</li>
              <li>Adicione <code className="bg-slate-200 dark:bg-slate-700 px-1 rounded">VITE_SUPABASE_ANON_KEY</code> (chave anon)</li>
              <li><strong>Redeploy</strong> o projeto (Deployments → ⋯ → Redeploy)</li>
            </ol>
            <a
              href="https://vercel.com/docs/environment-variables"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-indigo-600 dark:text-indigo-400 hover:underline mt-2"
            >
              Docs Vercel <ExternalLink className="w-4 h-4" />
            </a>
          </div>
        ) : (
          <div className="text-left bg-slate-100 dark:bg-slate-800/50 rounded-xl p-4 text-sm space-y-2">
            <p className="font-medium text-slate-800 dark:text-slate-200">Localmente:</p>
            <p className="text-slate-600 dark:text-slate-400">
              Crie <code className="bg-slate-200 dark:bg-slate-700 px-1 rounded">.env.local</code> na raiz do projeto com:
            </p>
            <pre className="bg-slate-800 text-slate-100 p-3 rounded-lg text-xs overflow-x-auto text-left">
              {`VITE_SUPABASE_URL=https://seu-projeto.supabase.co
VITE_SUPABASE_ANON_KEY=sua-chave-anon`}
            </pre>
            <p className="text-slate-600 dark:text-slate-400">
              Veja <strong>CONFIGURAR_SUPABASE.md</strong> para detalhes.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

const AppMain: React.FC = () => {
  const [user, setUser] = useState<User | null>(() => readCachedUser());
  const [activeTab, setActiveTab] = useState('dashboard');
  const [insights, setInsights] = useState<{ insight: string, score: number } | null>(null);
  /** Evita múltiplas chamadas à API quando `fetchInsights` é recriado ou o efeito reexecuta. */
  const insightsAutoFetchDoneRef = useRef(false);
  const [punchType, setPunchType] = useState<LogType | null>(null);
  const [showMethodSelection, setShowMethodSelection] = useState(false);
  const [pendingPunchType, setPendingPunchType] = useState<LogType | null>(null);
  const [selectedMethod, setSelectedMethod] = useState<PunchMethod | null>(null);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [showCelebration, setShowCelebration] = useState(false);
  /** Só bloqueia splash quando há cache de sessão a validar — login pode renderizar logo (sem “Protegendo…” longo). */
  const [isInitialLoading, setIsInitialLoading] = useState(() => {
    if (!checkSupabaseConfigured()) return false;
    // Só mostrar loading inicial se usuário marcou "lembrar-me"
    const rememberMe = typeof window !== 'undefined' && localStorage.getItem('pontowebdesk_remember_me') === 'true';
    return rememberMe && readCachedUser() != null;
  });
  const [company, setCompany] = useState<Company | null>(null);
  const [routeLoadAttempt, setRouteLoadAttempt] = useState(0);

  // Filtros do histórico
  const [historyMethodFilter, setHistoryMethodFilter] = useState<'all' | PunchMethod>('all');
  const [historyTypeFilter, setHistoryTypeFilter] = useState<'all' | LogType>('all');
  const [historyDateFilter, setHistoryDateFilter] = useState<string>('');

  // Timer visual de jornada
  const [todayProgress, setTodayProgress] = useState<number>(0);
  const [todayLabel, setTodayLabel] = useState<string>('00h 00m de 00h 00m');

  // Login State
  const [authFlow, dispatchAuthFlow] = useReducer(authFlowReducer, initialAuthFlowState);
  const isLoggingIn = isAuthFlowBusy(authFlow);
  const [loginError, setLoginError] = useState<string | null>(null);

  // Conexão Supabase (fallback quando servidor pausado/rede lenta)
  const [connectionUnavailable, setConnectionUnavailable] = useState(false);
  const [connectionIssueMessage, setConnectionIssueMessage] = useState<string | null>(null);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [isResettingSession, setIsResettingSession] = useState(false);
  const [accountSwitchLogoutBusy, setAccountSwitchLogoutBusy] = useState(false);
  const pendingLoginRoleRef = useRef<LoginRole>(null);
  const roleMismatchHandlingRef = useRef(false);
  const loginAttemptSeqRef = useRef(0);
  const activeLoginAttemptIdRef = useRef<number | null>(null);
  const loginStartedAtRef = useRef<number | null>(null);
  const sessionRecoveryLockRef = useRef(false);
  const activeAuthPipelineRef = useRef<{ pipelineId: number; startedAt: number; eventType: string } | null>(null);
  const authPipelineSeqRef = useRef(0);
  const alreadyAuthenticatedRef = useRef(false);
  const authEffectRunCountRef = useRef<Record<string, number>>({});
  const authWatchdogDumpAtRef = useRef<number | null>(null);

  // Theme State (para tela de login) — alinhado a ThemeService (chave `theme` + legado)
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    if (typeof window === 'undefined') return 'dark';
    const saved = ThemeService.readStoredTheme();
    if (saved === 'light' || saved === 'dark') return saved;
    return ThemeService.getSystemTheme();
  });

  const { records, isLoading: isPunching, error, setError, addRecord } = useRecords(user?.id, user?.companyId);
  /** Chrome operacional (badges/polling leve no layout) só após idle — reduz cascata pós setUser. */
  const portalChromeReady = useDeferredPortalChrome(user?.id);
  useEffectStormProbe('AppMain.user-identity', [user?.id, user?.companyId, user?.role]);
  const recordsRef = useRef(records);
  recordsRef.current = records;
  const { settings: globalSettings } = useSettings();
  const { setLanguage } = useLanguage();
  const location = useLocation();
  const navigate = useNavigate();
  const isRecoveryHash = typeof window !== 'undefined' && window.location.hash.includes('type=recovery');
  const handleRouteRetry = useCallback(() => {
    setRouteLoadAttempt((prev) => prev + 1);
  }, []);

  const getAuthDebugContext = useCallback(() => {
    const now = Date.now();
    const startedAt = loginStartedAtRef.current ?? now;
    const elapsedMs = Math.max(0, now - startedAt);
    const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
    const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
    const isWebView =
      /\bwv\b|WebView|(iPhone|iPod|iPad)(?!.*Safari\/)|Android.*Version\/[\d.]+/i.test(ua);
    const isPwa =
      typeof window !== 'undefined' &&
      (window.matchMedia?.('(display-mode: standalone)').matches === true ||
        (navigator as Navigator & { standalone?: boolean }).standalone === true);
    return {
      timestamp: new Date(now).toISOString(),
      route: typeof window !== 'undefined' ? window.location.pathname : '',
      visibilityState: typeof document !== 'undefined' ? document.visibilityState : 'unknown',
      online: typeof navigator === 'undefined' ? true : navigator.onLine,
      isMobile,
      isPwa,
      isWebView,
      loadingState: isLoggingIn,
      sessionExists: Boolean(user),
      executionDurationMs: elapsedMs,
      attemptId: activeLoginAttemptIdRef.current,
      pipelineId: activeAuthPipelineRef.current?.pipelineId ?? null,
    };
  }, [isLoggingIn, user]);

  const logAuth = useCallback(
    (tag: string, extra: Record<string, unknown> = {}) => {
      if (typeof console === 'undefined') return;
      console.info(tag, { ...getAuthDebugContext(), ...extra });
    },
    [getAuthDebugContext],
  );

  const startAuthPipeline = useCallback(
    (eventType: string, opts?: { reuseIfLoginInFlight?: boolean }) => {
      if (
        opts?.reuseIfLoginInFlight &&
        activeLoginAttemptIdRef.current !== null &&
        activeAuthPipelineRef.current &&
        (eventType === 'SIGNED_IN_OR_REFRESHED' || eventType.includes('SIGNED_IN'))
      ) {
        logAuth('[AUTH PIPELINE REUSE]', {
          pipelineId: activeAuthPipelineRef.current.pipelineId,
          eventType,
        });
        return activeAuthPipelineRef.current.pipelineId;
      }
      const prev = activeAuthPipelineRef.current;
      if (prev) {
        logAuth('[AUTH PIPELINE CANCELLED]', {
          pipelineId: prev.pipelineId,
          previousEventType: prev.eventType,
          reason: 'superseded_by_new_event',
          elapsedMs: Date.now() - prev.startedAt,
        });
      }
      const pipelineId = ++authPipelineSeqRef.current;
      activeAuthPipelineRef.current = {
        pipelineId,
        startedAt: Date.now(),
        eventType,
      };
      logAuth('[AUTH PIPELINE START]', { pipelineId, eventType });
      return pipelineId;
    },
    [logAuth],
  );

  useEffect(() => {
    setLongTaskPipelineContext(activeAuthPipelineRef.current?.pipelineId ?? null);
  }, [location.pathname, authFlow.loading, authFlow.status, user?.id]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!window.location.hash.includes('type=recovery')) return;
    if (location.pathname === '/reset-password') return;

    navigate(`/reset-password${window.location.hash}`, { replace: true });
  }, [location.pathname, navigate]);

  useEffect(() => {
    if (!user) return;
    markFirstRouteIfNeeded(location.pathname);
  }, [location.pathname, user]);

  useEffect(() => {
    const onEnrich = (e: Event) => {
      const ce = e as CustomEvent<User>;
      const next = ce.detail;
      if (!next?.id) return;
      setUser((prev) => (prev?.id === next.id ? next : prev));
    };
    window.addEventListener(SMARTPONTO_PROFILE_ENRICHED_EVENT, onEnrich);
    return () => window.removeEventListener(SMARTPONTO_PROFILE_ENRICHED_EVENT, onEnrich);
  }, []);

  useEffect(() => {
    installMobileClockDriftGuard();
  }, []);

  // Aplicar idioma padrão das configurações quando não houver preferência no navegador
  useEffect(() => {
    let hasLangPref = false;
    if (typeof window !== 'undefined') {
      try {
        hasLangPref = !!localStorage.getItem('smartponto_language');
      } catch (err) {
        console.warn('[App] Falha ao ler idioma salvo:', err);
      }
    }
    if (globalSettings?.language && typeof window !== 'undefined' && !hasLangPref) {
      const lang = globalSettings.language === 'en-US' || globalSettings.language === 'pt-BR' ? globalSettings.language : 'pt-BR';
      setLanguage(lang);
    }
  }, [globalSettings?.language, setLanguage]);

  useEffect(() => {
    authEffectRunCountRef.current.initAuth = (authEffectRunCountRef.current.initAuth ?? 0) + 1;
    logAuth('[AUTH EFFECT TRIGGER]', {
      effect_name: 'init_auth_bootstrap',
      execution_count: authEffectRunCountRef.current.initAuth,
      dependencies: '[]',
    });
    let timeoutId: ReturnType<typeof setTimeout>;
    let isMounted = true;

    /** BOOT FLOW (restore session / silent hydration) — ownership separado do LOGIN FLOW em `handleLogin`. */
    const initApp = async () => {
      try {
        // Rede de segurança: getSession + getCurrentUser têm timeouts próprios; isto evita spinner eterno se algo travar.
        /** Deve ser ≥ pior caso de `getCurrentUser` (2×30s + retry) + margem. */
        const INIT_APP_MAX_MS = 95_000;
        timeoutId = setTimeout(() => {
          if (isMounted) {
            console.warn('Initialization timeout - forcing app to load');
            setIsInitialLoading(false);
          }
        }, INIT_APP_MAX_MS);

        // Verificar se Supabase está configurado (usando verificação dinâmica)
        if (!checkSupabaseConfigured()) {
          console.warn('Supabase not configured - app will show login screen');
          if (isMounted) {
            clearTimeout(timeoutId);
            setIsInitialLoading(false);
          }
          return;
        }

        // Teste de conexão ao iniciar apenas para log (não bloqueia a tela)
        const connectionTimeoutMs = 15000;
        const isOfflineDevMode =
          typeof window !== 'undefined' && (window as any).__SUPABASE_OFFLINE_DEV === true;
        if (!isOfflineDevMode) {
          testSupabaseConnection(connectionTimeoutMs).then((result) => {
            if (result.ok && import.meta.env?.DEV) {
              console.log('[PontoWebDesk] Conexão Supabase OK');
            }
            // Não loga falha aqui para não poluir o console; login mostrará erro se precisar.
          });
        }

        // Não usar getSession() isolado com timeout curto como “portão”: se IndexedDB/rede atrasarem,
        // a app saía antes de hidratar e o usuário via tela presa / sem perfil em cache.
        // getCurrentUser() pode levar até ~2×30s + retry; não bloqueamos o splash tanto assim.
        // `onAuthStateChanged` e o fallback de perfil mínimo no authService ainda atualizam o usuário depois.
        const INIT_HYDRATE_MS = 7_000;
        const currentUser = await Promise.race([
          authService.getCurrentUser(),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), INIT_HYDRATE_MS)),
        ]).catch((error) => {
          console.error('Error getting current user:', error);
          return null;
        });

        if (isMounted && currentUser) {
          setUser(currentUser);
          beginPostLoginRequestBudgetWindow('session_restored');
          scheduleDeferredBootstrap('init_company', async () => {
            try {
              const comp = await Promise.race([
                PontoService.getCompany(currentUser.companyId),
                new Promise<Company | null>((resolve) => setTimeout(() => resolve(null), 2000)),
              ]).catch(() => null);
              if (comp && isMounted) setCompany(comp);
            } catch (error) {
              console.error('Error loading company:', error);
            }
          });

          let hasSeenOnboarding = null;
          try {
            hasSeenOnboarding = localStorage.getItem(`onboarding_${currentUser.id}`);
          } catch (err) {
            console.warn('[App] Falha ao ler onboarding:', err);
          }
          if (!hasSeenOnboarding && isMounted) setShowOnboarding(true);
        }

        if (isMounted) {
          clearTimeout(timeoutId);
          setIsInitialLoading(false);
        }
      } catch (error) {
        console.error('Error initializing app:', error);
        if (isMounted) {
          clearTimeout(timeoutId);
          setIsInitialLoading(false);
        }
      }
    };

    initApp();

    // Observar mudanças no estado de autenticação (apenas se Supabase configurado)
    let unsubscribe: (() => void) | null = null;
    if (checkSupabaseConfigured()) {
      try {
        unsubscribe = authService.onAuthStateChanged((authUser) => {
          if (!isMounted) return;
          const pipelineId = startAuthPipeline(
            authUser ? 'SIGNED_IN_OR_REFRESHED' : 'INITIAL_SESSION_OR_SIGNED_OUT',
            { reuseIfLoginInFlight: Boolean(authUser && activeLoginAttemptIdRef.current !== null) },
          );
          traceLoginStep(getActiveLoginTrace(), 'auth_listener_triggered', {
            pipelineId,
            hasAuthUser: Boolean(authUser),
          });
          logAuth('[AUTH LISTENER EVENT]', {
            pipelineId,
            authUserExists: Boolean(authUser),
            authUserId: authUser?.id ?? null,
            authUserRole: authUser?.role ?? null,
          });

          if (authUser) {
            logAuth('[AUTH LISTENER SIGNED_IN]', {
              pipelineId,
              authUserId: authUser.id,
              authUserRole: authUser.role,
            });
            if (alreadyAuthenticatedRef.current) {
              logAuth('[AUTH PIPELINE IGNORED]', {
                pipelineId,
                reason: 'already_authenticated_guard',
                incomingUserId: authUser.id,
              });
              return;
            }
            const selectedRole = pendingLoginRoleRef.current;
            if (selectedRole && !isRoleAllowedForSelectedLogin(selectedRole, authUser.role)) {
              if (roleMismatchHandlingRef.current) return;
              roleMismatchHandlingRef.current = true;
              setLoginError(getRoleMismatchMessageForLogin(selectedRole));
              dispatchAuthFlow({ type: 'RELEASE_LOADING' });
              pendingLoginRoleRef.current = null;
              void (async () => {
                try {
                  await authService.signOut();
                } catch {
                  // ignora
                }
                try {
                  await clearLocalAuthSession();
                } catch {
                  // ignora
                }
                setUser(null);
                setCompany(null);
                window.dispatchEvent(new Event('current_user_changed'));
                roleMismatchHandlingRef.current = false;
              })();
              logAuth('[AUTH PIPELINE CANCELLED]', {
                pipelineId,
                reason: 'role_mismatch',
              });
              return;
            }
            // Sincroniza sempre com a sessão do Supabase (TOKEN_REFRESHED, SIGNED_IN, etc.).
            // A flag de logout em authService evita corrida com signOut; não bloquear aqui —
            // bloquear quando `current === null` impedia recuperar sessão válida após eventos tardios.
            setUser(authUser);
            alreadyAuthenticatedRef.current = true;
            dispatchAuthFlow({
              type: 'AUTHENTICATED',
              attemptId: activeLoginAttemptIdRef.current,
              pipelineId,
            });
            PontoService.getCompany(authUser.companyId).then(comp => {
              if (isMounted && comp) setCompany(comp);
            }).catch(error => {
              console.error('Error loading company in auth state change:', error);
            });
            logAuth('[AUTH PIPELINE COMPLETED]', {
              pipelineId,
              userId: authUser.id,
              role: authUser.role,
            });
            activeAuthPipelineRef.current = null;
          } else {
            logAuth('[AUTH LISTENER INITIAL_SESSION]', {
              pipelineId,
              authUserExists: false,
            });
            setUser(null);
            setCompany(null);
            alreadyAuthenticatedRef.current = false;
            dispatchAuthFlow({ type: 'RESET' });
            activeAuthPipelineRef.current = null;
          }
        });
      } catch (error) {
        console.error('Error setting up auth state listener:', error);
      }
    }

    return () => {
      isMounted = false;
      clearTimeout(timeoutId);
      if (unsubscribe) unsubscribe();
    };
  }, []);

  /** JWT inválido em chamadas REST: limpa sessão e evita estado “meio logado”. */
  useEffect(() => {
    const onAuthExpired = () => {
      void (async () => {
        try {
          await clearLocalAuthSession();
        } catch {
          // ignora
        }
        try {
          clearCurrentUserFromAllStorages();
        } catch {
          // ignora
        }
        clearTenantScopedCaches();
        window.dispatchEvent(new Event('current_user_changed'));
        if (typeof window !== 'undefined') {
          window.location.href = window.location.origin + '/';
        }
      })();
    };
    window.addEventListener('supabase:auth-expired', onAuthExpired);
    return () => window.removeEventListener('supabase:auth-expired', onAuthExpired);
  }, []);

  // Ao exibir tela de login (user null), limpar erro
  useEffect(() => {
    if (!user) {
      setLoginError(null);
    }
  }, [user]);

  const fetchInsights = useCallback(async () => {
    if (!isAiDashboardInsightsAutoEnabled()) return;
    const list = recordsRef.current;
    if (list.length < 2) return;
    if (insightsAutoFetchDoneRef.current) return;

    insightsAutoFetchDoneRef.current = true;
    const summary: DailySummary = {
      date: new Date().toISOString(),
      totalHours: 8,
      records: list.slice(0, 10),
    };
    try {
      const result = await getWorkInsights([summary]);
      setInsights(result);
    } catch (e) {
      if (import.meta.env.DEV) {
        console.warn('[Dashboard] IA indisponível (ignorado):', e);
      }
      setInsights({
        insight: 'Insights por IA indisponíveis. O restante do sistema segue normal.',
        score: 8,
      });
    }
  }, []);

  useEffect(() => {
    if (!isAiDashboardInsightsAutoEnabled()) return;
    if (activeTab !== 'dashboard' || records.length < 2) return;
    void fetchInsights();
  }, [activeTab, records.length, fetchInsights]);

  useEffect(() => {
    if (records.length < 2) {
      insightsAutoFetchDoneRef.current = false;
      setInsights(null);
    }
  }, [records.length]);

  useEffect(() => {
    if (!user || !user.preferences?.notifications) {
      stopReminderCheck();
      return;
    }
    const cfg = getReminderConfig();
    if (!cfg.enabled) return;

    // Verificar se a permissão já foi concedida anteriormente
    // Não solicitar automaticamente - apenas verificar o status atual
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      startReminderCheck();
    }
    // Se a permissão não foi concedida, não solicitar automaticamente
    // O usuário pode solicitar manualmente nas configurações

    return () => stopReminderCheck();
  }, [user?.id, user?.preferences?.notifications]);

  useEffect(() => {
    try {
      ThemeService.applyTheme(theme);
    } catch (error) {
      console.error('Erro ao aplicar tema:', error);
    }
  }, [theme]);

  const handlePunchStart = (type: LogType) => {
    setError(null);
    setPendingPunchType(type);

    // Se a empresa exige foto obrigatória, abrir direto o modal de foto
    // Isso é especialmente importante em dispositivos móveis para acionar a câmera imediatamente
    if (company?.settings?.requirePhoto) {
      setSelectedMethod(PunchMethod.PHOTO);
      setPunchType(type);
      setShowMethodSelection(false);
    } else {
      // Caso contrário, mostrar modal de seleção
      setShowMethodSelection(true);
    }
  };

  const handleMethodSelection = (method: 'photo' | 'manual' | 'gps' | 'biometric') => {
    setShowMethodSelection(false);
    if (pendingPunchType) {
      const methodMap: Record<string, PunchMethod> = {
        photo: PunchMethod.PHOTO,
        manual: PunchMethod.MANUAL,
        gps: PunchMethod.GPS,
        biometric: PunchMethod.BIOMETRIC,
      };
      setSelectedMethod(methodMap[method] || PunchMethod.PHOTO);
      setPunchType(pendingPunchType);
    }
  };

  const onConfirmPunch = async (method: PunchMethod, data: { photo?: string, justification?: string, location?: any }) => {
    if (!punchType) return;
    try {
      await addRecord(punchType, method, data);
      setPunchType(null);
      if (records.length === 1) {
        setShowCelebration(true);
        setTimeout(() => setShowCelebration(false), 4000);
      }
      if ('vibrate' in navigator) navigator.vibrate(50);

      // Feedback sonoro simples (se o navegador permitir)
      try {
        const audio = new Audio('/sounds/punch-success.mp3');
        audio.volume = 0.5;
        audio.play().catch((err) => {
          if (import.meta.env?.DEV) {
            console.warn('[App] Falha ao tocar som de confirmação:', err);
          }
        });
      } catch {
        // silencioso se falhar
      }
    } catch (err) {
      console.error('Erro ao registrar ponto:', err);
      setError('Falha ao registrar o ponto. Tente novamente.');
    }
  };

  const isWorking = useMemo(() => records[0]?.type === LogType.IN, [records]);

  const stats = useMemo(() => ({
    today: PontoService.calculateDailyHours(records),
    balance: "+12h 45m",
    status: isWorking ? 'Em Jornada' : 'Pausa / Descanso'
  }), [records, isWorking]);

  // Calcular progresso diário visual (comparando com jornada padrão da empresa)
  useEffect(() => {
    if (!company) {
      setTodayProgress(0);
      setTodayLabel('00h 00m de 00h 00m');
      return;
    }

    const today = new Date().toDateString();
    const dated = records
      .map((r) => ({ r, d: getRecordCreatedAtDate(r) }))
      .filter((x): x is { r: typeof records[number]; d: Date } => x.d !== null);
    const todayRecords = dated
      .filter(({ d }) => d.toDateString() === today)
      .sort((a, b) => a.d.getTime() - b.d.getTime());

    let totalMs = 0;
    let lastInTime: number | null = null;
    for (const { r, d } of todayRecords) {
      if (r.type === LogType.IN) lastInTime = d.getTime();
      else if (lastInTime && (r.type === LogType.OUT || r.type === LogType.BREAK)) {
        totalMs += d.getTime() - lastInTime;
        lastInTime = null;
      }
    }
    if (lastInTime) totalMs += new Date().getTime() - lastInTime;

    const workedHours = totalMs / (1000 * 60 * 60);

    const standardHoursConfig =
      company.settings?.standardHours ||
      (globalSettings
        ? { start: globalSettings.default_entry_time, end: globalSettings.default_exit_time }
        : null);
    if (!standardHoursConfig?.start || !standardHoursConfig?.end) {
      setTodayProgress(0);
      setTodayLabel(`${stats.today}`);
      return;
    }
    const [startH, startM] = standardHoursConfig.start.split(':').map(Number);
    const [endH, endM] = standardHoursConfig.end.split(':').map(Number);
    const standardMs =
      (endH * 60 + endM - (startH * 60 + startM)) * 60 * 1000;
    const standardHours = standardMs / (1000 * 60 * 60);

    if (standardHours <= 0) {
      setTodayProgress(0);
      setTodayLabel(`${stats.today}`);
      return;
    }

    const progress = Math.min(1, workedHours / standardHours);
    setTodayProgress(progress);

    const totalHours = Math.floor(standardHours);
    const totalMinutes = Math.round((standardHours % 1) * 60);
    setTodayLabel(
      `${stats.today} de ${totalHours.toString().padStart(2, '0')}h ${totalMinutes
        .toString()
        .padStart(2, '0')}m`
    );
  }, [records, company, globalSettings, stats.today]);

  // Registros filtrados para a aba de histórico
  const filteredHistory = useMemo(() => {
    return records.filter(rec => {
      if (historyTypeFilter !== 'all' && rec.type !== historyTypeFilter) return false;
      if (historyMethodFilter !== 'all' && rec.method !== historyMethodFilter) return false;

      if (historyDateFilter) {
        const recDate = rec.createdAt.toISOString().slice(0, 10);
        if (recDate !== historyDateFilter) return false;
      }

      return true;
    });
  }, [records, historyTypeFilter, historyMethodFilter, historyDateFilter]);

  /** LOGIN FLOW (owned): autenticação + hidratação + navegação sem depender do listener para SIGNED_IN. */
  const handleLogin = async (identifier: string, password: string, role: LoginRole) => {
    if (activeLoginAttemptIdRef.current !== null || isLoggingIn) {
      logAuth('[AUTH DEADLOCK DETECTED]', {
        reason: 'concurrent_login_attempt_blocked',
        activeAttemptId: activeLoginAttemptIdRef.current,
      });
      return;
    }
    const attemptId = ++loginAttemptSeqRef.current;
    activeLoginAttemptIdRef.current = attemptId;
    loginStartedAtRef.current = Date.now();
    markLoginSubmitStarted();
    alreadyAuthenticatedRef.current = false;
    pendingLoginRoleRef.current = role;
    dispatchAuthFlow({ type: 'LOGIN_START', attemptId });
    logAuth('[LOGIN START]', {
      attemptId,
      identifierPreview: (identifier || '').trim().slice(0, 3),
      role,
    });
    const isAdminAccess = (userRole: User['role'] | undefined): boolean =>
      userRole === 'admin' || userRole === 'hr';

    const isRoleAllowedForSelection = (selectedRole: LoginRole, userRole: User['role'] | undefined): boolean => {
      if (selectedRole === 'admin') return isAdminAccess(userRole);
      if (selectedRole === 'employee') return !isAdminAccess(userRole);
      return true;
    };

    const getRoleMismatchMessage = (_selectedRole: LoginRole): string => 'Acesso negado';

    const forceLogoutAfterRoleMismatch = async (): Promise<void> => {
      try {
        await authService.signOut();
      } catch {
        // ignora
      }
      try {
        await clearLocalAuthSession();
      } catch {
        // ignora
      }
      setUser(null);
      setCompany(null);
      window.dispatchEvent(new Event('current_user_changed'));
    };

    try {
      if (typeof window !== 'undefined') {
        const q = new URLSearchParams(window.location.search);
        if (q.get('clearAuthCache') === '1') {
          window.localStorage.clear();
          window.sessionStorage.clear();
          if (typeof console !== 'undefined') {
            console.info('[LOGIN] clearAuthCache=1 → storage limpo antes do submit');
          }
        }
      }
    } catch {
      // ignorar
    }
    if (typeof console !== 'undefined' && import.meta.env?.DEV) {
      console.info('[LOGIN] submit', {
        identifierLen: (identifier || '').trim().length,
        passwordLen: (password || '').length,
        role,
      });
    }
    const parsed = validateLogin({ identifier, password });
    if (!parsed.success) {
      pendingLoginRoleRef.current = null;
      if (typeof console !== 'undefined' && import.meta.env?.DEV) {
        console.warn('[LOGIN] validação Zod falhou:', parsed.error.flatten());
      }
      setLoginError(parsed.error.errors[0]?.message ?? 'Dados inválidos');
      dispatchAuthFlow({ type: 'FAILED', attemptId, error: 'validation_failed' });
      logAuth('[LOGIN FAILED]', { attemptId, reason: 'validation_failed' });
      return;
    }
    setLoginError(null);

    const pipelineId = startAuthPipeline('manual_login');
    const loginTrace = createLoginTrace(attemptId, pipelineId);
    let traceFinalized = false;
    const endLoginTrace = (outcome: string) => {
      if (traceFinalized || !loginTrace) return;
      traceFinalized = true;
      const slow = getSlowestLoginStep(loginTrace);
      if (slow && typeof console !== 'undefined') {
        console.info('[AUTH TRACE]', { summary: 'slowest_step', ...slow, outcome });
      }
      finalizeLoginTrace(loginTrace, outcome);
    };

    pushCriticalLoginPath();
    authService.setLoginDiagnostics({ pipelineId, attemptId });
    const manualPipelineToken = authService.acquireManualLoginPipeline();

    const hydrateUserFromSessionIfExists = async (): Promise<boolean> => {
      const owner = createHydrationOwner(`hydrate-${attemptId}`);
      beginHydration(owner);
      dispatchAuthFlow({
        type: 'HYDRATION_START',
        attemptId,
        pipelineId: activeAuthPipelineRef.current?.pipelineId ?? null,
      });
      logAuth('[AUTH HYDRATION START]', { attemptId, owner });
      try {
        const client = getSupabaseClient();
        if (!client) return false;

        const sessionPack = await withHydrationTimeout(owner, 12_000, () =>
          measureSupabaseAsync('getSession_hydrate', () => client.auth.getSession()),
        );
        if (sessionPack === 'hydration_timeout') {
          logAuth('[AUTH HYDRATION FAILED]', { attemptId, reason: 'session_hydration_timeout' });
          dispatchAuthFlow({ type: 'FAILED', attemptId, error: 'hydration_timeout' });
          return false;
        }
        const { data } = sessionPack as Awaited<ReturnType<typeof client.auth.getSession>>;
        traceLoginStep(getActiveLoginTrace(), 'session_received', { hasUser: Boolean(data?.session?.user) });
        logAuth('[LOGIN SESSION FOUND]', {
          attemptId,
          hasSession: Boolean(data?.session?.user),
        });
        if (data?.session?.user) {
          dispatchAuthFlow({ type: 'SESSION_DETECTED', attemptId });
        }
        if (!data?.session?.user) return false;
        if (!isHydrationOwnerActive(owner)) {
          logAuth('[AUTH HYDRATION STALE]', { attemptId, phase: 'post_session' });
          return false;
        }

        const hydratedUserResult = await withHydrationTimeout(owner, 45_000, () => authService.getCurrentUser());
        if (hydratedUserResult === 'hydration_timeout') {
          logAuth('[AUTH HYDRATION FAILED]', { attemptId, reason: 'user_hydration_timeout' });
          return false;
        }
        const hydratedUser = hydratedUserResult as User | null;
        if (!hydratedUser) return false;
        if (!isHydrationOwnerActive(owner)) {
          logAuth('[AUTH HYDRATION STALE]', { attemptId, phase: 'post_user' });
          return false;
        }

        logAuth('[LOGIN SESSION HYDRATED]', {
          attemptId,
          hydratedUserId: hydratedUser.id,
          hydratedRole: hydratedUser.role,
        });
        logAuth('[AUTH HYDRATION SUCCESS]', {
          attemptId,
          hydratedUserId: hydratedUser.id,
          hydratedRole: hydratedUser.role,
        });
        if (!isRoleAllowedForSelection(role, hydratedUser.role)) {
          await forceLogoutAfterRoleMismatch();
          setLoginError(getRoleMismatchMessage(role));
          pendingLoginRoleRef.current = null;
          return false;
        }
        setUser(hydratedUser);
        beginPostLoginRequestBudgetWindow('manual_login_hydrated');
        alreadyAuthenticatedRef.current = true;
        setIsInitialLoading(false);
        window.dispatchEvent(new Event('current_user_changed'));
        const targetRoute =
          hydratedUser.role === 'admin' || hydratedUser.role === 'hr'
            ? '/admin/dashboard'
            : '/employee/dashboard';
        if (hydratedUser.role === 'admin' || hydratedUser.role === 'hr') {
          setActiveTab('admin');
        } else {
          setActiveTab('dashboard');
        }
        traceLoginStep(getActiveLoginTrace(), 'navigation_start', { targetRoute });
        requestAuthNavigation({
          pipelineId: activeAuthPipelineRef.current?.pipelineId ?? null,
          target: targetRoute,
          replace: true,
          navigate,
        });
        pendingLoginRoleRef.current = null;
        dispatchAuthFlow({
          type: 'AUTHENTICATED',
          attemptId,
          pipelineId: activeAuthPipelineRef.current?.pipelineId ?? null,
        });
        logAuth('[LOGIN SESSION RECOVERED]', {
          attemptId,
          routeTarget: targetRoute,
        });
        return true;
      } catch {
        logAuth('[AUTH HYDRATION FAILED]', { attemptId });
        dispatchAuthFlow({ type: 'FAILED', attemptId, error: 'hydration_failed' });
        return false;
      } finally {
        endHydration(owner);
      }
    };

    try {
      traceLoginStep(loginTrace, 'auth_request_start');
      // Pré-check rápido para reduzir espera percebida quando o projeto Supabase está pausado.
      const FAST_PRECHECK_TIMEOUT_MS = 3000;
      const precheckResult = await Promise.race([
        checkSupabaseConnection(),
        new Promise<'unknown'>((resolve) => setTimeout(() => resolve('unknown'), FAST_PRECHECK_TIMEOUT_MS)),
      ]);
      if (precheckResult !== 'unknown' && !precheckResult.ok) {
        // Pré-check informativo: NÃO acionar telas globais nem connectionUnavailable —
        // isso roubava o formulário de login e mostrava "Servidor indisponível" mesmo antes de tentar sessão Auth.
        if (import.meta.env.DEV && typeof console !== 'undefined') {
          console.warn('[LOGIN PRECHECK] Health-check inconclusivo (login segue igual):', precheckResult.message);
        }
      }

      let result: { user: any; error: string | null };
      try {
        /**
         * Hard-lock anti-spinner infinito no mobile:
         * se a promessa de login não concluir, interrompemos a espera da UI.
         * Depois tentamos hidratar pela sessão já gravada (quando o signIn concluiu no backend).
         */
        result = await withTimeout(
          authService.signInWithEmail(identifier, password),
          30000,
          'login',
        );
        if (!result.error) {
          traceLoginStep(loginTrace, 'auth_request_success');
        }
      } catch (authErr: any) {
        logAuth('[LOGIN TIMEOUT]', {
          attemptId,
          error: authErr?.message ?? String(authErr),
        });
        const recovered = await hydrateUserFromSessionIfExists();
        if (recovered) {
          endLoginTrace('recovered_via_hydrate_after_timeout');
          return;
        }
        const errText = String(
          authErr?.message || authErr?.details || authErr?.hint || authErr?.error?.message || ''
        ).toLowerCase();
        let isTimeoutError = errText.includes('login_timeout') || errText.includes('timeout');
        const isCircuitBreakerError = errText.includes('circuit breaker ativo');
        let isDnsError =
          errText.includes('err_name_not_resolved') ||
          errText.includes('name_not_resolved') ||
          errText.includes('net::err_name_not_resolved') ||
          errText.includes('enotfound') ||
          errText.includes('getaddrinfo') ||
          errText.includes('dns');

        if (isTimeoutError && !isDnsError) {
          try {
            const connectionCheck = await Promise.race([
              checkSupabaseConnection(),
              new Promise<'unknown'>((resolve) => setTimeout(() => resolve('unknown'), 1500)),
            ]);
            if (connectionCheck !== 'unknown') {
              if (connectionCheck.status === 'dns') {
                isDnsError = true;
                isTimeoutError = false;
              } else if (connectionCheck.status === 'network' || connectionCheck.status === 'offline') {
                isTimeoutError = false;
              }
            }
          } catch {
            // mantém classificação original
          }
        }

        setConnectionUnavailable(true);
        if (isCircuitBreakerError) {
          logSupabaseError(new Error('circuit breaker ativo durante login'), 'login');
          setConnectionIssueMessage('Servidor temporariamente indisponível. Aguardando para nova tentativa automática.');
          setLoginError('Conexão temporariamente bloqueada para evitar múltiplas tentativas. Aguarde alguns segundos e tente novamente.');
        } else if (isDnsError) {
          logSupabaseError(new Error('dns login failed_to_fetch name_not_resolved'), 'login');
          setConnectionIssueMessage('Falha de DNS ao autenticar. Verifique internet/DNS local e a resolução do domínio do Supabase.');
          setLoginError('Falha de DNS ao acessar o Supabase. Tente novamente em instantes.');
        } else if (isTimeoutError) {
          logSupabaseError(new Error('timeout durante login'), 'login');
          setConnectionIssueMessage('Tempo esgotado ao autenticar. O Supabase pode estar iniciando (free tier) ou a rede está instável.');
          setLoginError('Tempo esgotado ao autenticar. Tente novamente.');
        } else {
          logSupabaseError(authErr, 'login');
          setConnectionIssueMessage('Falha de conectividade durante a autenticação. Verifique rede e tente novamente.');
          setLoginError(authErr?.message || 'Erro de rede ao autenticar.');
        }
        try {
          await clearLocalAuthSession();
        } catch {
          // ignora
        }
        pendingLoginRoleRef.current = null;
        dispatchAuthFlow({ type: 'FAILED', attemptId, error: authErr?.message ?? String(authErr) });
        logAuth('[LOGIN FAILED]', {
          attemptId,
          reason: 'auth_exception',
          error: authErr?.message ?? String(authErr),
        });
        endLoginTrace('failed:auth_exception');
        return;
      }

      if (result.error) {
        const recovered = await hydrateUserFromSessionIfExists();
        if (recovered) {
          endLoginTrace('recovered_via_hydrate_after_error');
          return;
        }
        const normalizedError = String(result.error || '').toLowerCase();
        const isDnsErrorResult =
          normalizedError.includes('err_name_not_resolved') ||
          normalizedError.includes('name_not_resolved') ||
          normalizedError.includes('net::err_name_not_resolved') ||
          normalizedError.includes('enotfound') ||
          normalizedError.includes('getaddrinfo') ||
          normalizedError.includes('dns');
        if (
          normalizedError.includes('tempo esgotado') ||
          normalizedError.includes('timeout') ||
          normalizedError.includes('network')
        ) {
          setConnectionIssueMessage(
            isDnsErrorResult
              ? 'Falha de DNS durante o login. Verifique internet/DNS e tente novamente.'
              : 'Falha de conectividade durante o login. Verifique DNS/rede e tente novamente.'
          );
          setConnectionUnavailable(true);
        }
        setLoginError(result.error);
        pendingLoginRoleRef.current = null;
        dispatchAuthFlow({ type: 'FAILED', attemptId, error: result.error });
        logAuth('[LOGIN FAILED]', {
          attemptId,
          reason: 'auth_service_error',
          error: result.error,
        });
        endLoginTrace('failed:auth_service_error');
        return;
      }

      if (result.user) {
        if (alreadyAuthenticatedRef.current) {
          logAuth('[AUTH PIPELINE IGNORED]', {
            attemptId,
            reason: 'already_authenticated_before_manual_setuser',
          });
          endLoginTrace('ignored:already_authenticated');
          return;
        }
        if (!isRoleAllowedForSelection(role, result.user.role)) {
          await forceLogoutAfterRoleMismatch();
          setLoginError(getRoleMismatchMessage(role));
          pendingLoginRoleRef.current = null;
          endLoginTrace('failed:role_mismatch');
          return;
        }

        /**
         * Caminho crítico do login: setar usuário e navegar IMEDIATAMENTE.
         * Qualquer await extra aqui (getSession, getCompany, refreshSession) faz o spinner ficar
         * preso e o usuário pensa que precisa "atualizar o navegador" — quando na verdade a sessão
         * já foi gravada e só faltava o redirect. Tudo que não bloqueia a navegação vai pra fire-and-forget.
         */
        const targetRoute =
          result.user.role === 'admin' || result.user.role === 'hr'
            ? '/admin/dashboard'
            : '/employee/dashboard';

        flushSync(() => {
          setUser(result.user);
          alreadyAuthenticatedRef.current = true;
          setIsInitialLoading(false);
          if (typeof console !== 'undefined' && import.meta.env.DEV) {
            console.log('[USER SET MANUAL]');
          }
        });

        if (result.user.role === 'admin' || result.user.role === 'hr') {
          setActiveTab('admin');
        } else {
          setActiveTab('dashboard');
        }
        traceLoginStep(loginTrace, 'navigation_start', { targetRoute });
        requestAuthNavigation({
          pipelineId: activeAuthPipelineRef.current?.pipelineId ?? null,
          target: targetRoute,
          replace: true,
          navigate,
        });
        dispatchAuthFlow({
          type: 'AUTHENTICATED',
          attemptId,
          pipelineId: activeAuthPipelineRef.current?.pipelineId ?? null,
        });
        logAuth('[LOGIN NAVIGATION]', {
          attemptId,
          targetRoute,
          userRole: result.user.role,
        });
        pendingLoginRoleRef.current = null;

        if (typeof console !== 'undefined' && import.meta.env.DEV) {
          console.log('[REDIRECT CHECK]', {
            userInState: !!result.user,
            targetRoute,
          });
        }

        // Side-effects diferidos: NÃO bloquear o redirect/spinner.
        // - getSession() é apenas diagnóstico de log.
        // - getCompany() alimenta o header da dashboard, mas a página renderiza sem ele.
        void (async () => {
          try {
            window.dispatchEvent(new Event('current_user_changed'));
          } catch {
            // ignora
          }

          try {
            const client = getSupabaseClient();
            if (client && import.meta.env.DEV && typeof console !== 'undefined') {
              const { data: sessSnap, error: sessErr } = await client.auth.getSession();
              console.log('[SESSION AFTER LOGIN]', {
                sessionExists: !!sessSnap?.session,
                error: sessErr?.message ?? null,
              });
            }
          } catch {
            // log opcional; nunca quebra login
          }

          try {
            const comp = await Promise.race([
              PontoService.getCompany(result.user.companyId),
              new Promise<undefined>((r) => setTimeout(() => r(undefined), 3000)),
            ]);
            if (comp) setCompany(comp);
          } catch {
            // segue sem empresa; admin/employee dashboard tolera company nulo no boot
          }
        })();
        logAuth('[LOGIN SUCCESS]', {
          attemptId,
          userId: result.user.id,
          role: result.user.role,
        });
        endLoginTrace('success');
      }
    } catch (error: any) {
      console.error('Erro no handleLogin:', error);
      const recovered = await hydrateUserFromSessionIfExists();
      if (recovered) {
        endLoginTrace('recovered_via_hydrate_after_exception');
        return;
      }
      const errorText = String(
        error?.message || error?.details || error?.hint || error?.error?.message || ''
      ).toLowerCase();
      const isDnsLike =
        errorText.includes('err_name_not_resolved') ||
        errorText.includes('name_not_resolved') ||
        errorText.includes('dns');
      const isNetworkLike =
        isDnsLike ||
        errorText.includes('failed to fetch') ||
        errorText.includes('networkerror') ||
        errorText.includes('network request failed') ||
        (error instanceof TypeError && errorText.includes('fetch'));

      if (isNetworkLike) {
        setConnectionUnavailable(true);
        setConnectionIssueMessage(
          isDnsLike
            ? 'Falha de DNS ao autenticar. Verifique internet/DNS local e confirme se a URL do projeto Supabase está correta.'
            : 'Falha de rede ao autenticar. Verifique conexão e tente novamente.'
        );
        setLoginError(
          isDnsLike
            ? 'Falha de DNS ao acessar o Supabase. Confira a URL do projeto e o DNS da rede.'
            : 'Falha de rede ao acessar o Supabase. Tente novamente em instantes.'
        );
        pendingLoginRoleRef.current = null;
        endLoginTrace('failed:network');
        return;
      }

      setLoginError(error?.message || 'Erro ao fazer login');
      pendingLoginRoleRef.current = null;
      dispatchAuthFlow({ type: 'FAILED', attemptId, error: error?.message || 'login_exception' });
      logAuth('[LOGIN FAILED]', {
        attemptId,
        reason: 'unexpected_exception',
        error: error?.message ?? String(error),
      });
      endLoginTrace('failed:unexpected_exception');
    } finally {
      /** Libera após um tick curto: GoTrue pode emitir SIGNED_IN logo após o await do signIn (mobile). */
      const releaseToken = manualPipelineToken;
      window.setTimeout(() => {
        authService.releaseManualLoginPipeline(releaseToken);
        authService.clearLoginDiagnostics();
      }, 160);
      popCriticalLoginPath();
      traceLoginStep(loginTrace, 'loading_released');
      if (!traceFinalized) {
        endLoginTrace('released_implicit');
      }
      if (activeLoginAttemptIdRef.current === attemptId) {
        dispatchAuthFlow({ type: 'RELEASE_LOADING' });
        activeLoginAttemptIdRef.current = null;
      }
      logAuth('[LOGIN STATE RELEASED]', { attemptId });
      markLoginUiComplete('login_pipeline_released');
      if (!roleMismatchHandlingRef.current && pendingLoginRoleRef.current !== null) {
        pendingLoginRoleRef.current = null;
      }
    }
  };

  useEffect(() => {
    if (!isLoggingIn) return;
    authEffectRunCountRef.current.loginRecovery = (authEffectRunCountRef.current.loginRecovery ?? 0) + 1;
    logAuth('[AUTH EFFECT TRIGGER]', {
      effect_name: 'login_recovery_watchdog',
      execution_count: authEffectRunCountRef.current.loginRecovery,
      dependencies: '[isLoggingIn]',
    });

    const tryRecoverStuckLogin = async (source: string) => {
      if (sessionRecoveryLockRef.current) return;
      const startedAt = loginStartedAtRef.current;
      if (!startedAt) return;
      const elapsed = Date.now() - startedAt;
      if (elapsed < 8000) return;
      if (authWatchdogDumpAtRef.current !== startedAt) {
        authWatchdogDumpAtRef.current = startedAt;
        logAuthWatchdogDump({
          ...getAuthDebugContext(),
          authFlowStatus: authFlow.status,
          authFlowLoading: authFlow.loading,
          hydrationOwner: getActiveHydrationOwnerToken(),
          activeLoginTraceAttempt: getActiveLoginTrace()?.attemptId ?? null,
          pendingLoginRole: pendingLoginRoleRef.current,
          pipelineId: activeAuthPipelineRef.current?.pipelineId ?? null,
          route: typeof window !== 'undefined' ? window.location.pathname : '',
        });
      }
      const hardTimedOut = elapsed >= 30000;
      if (hardTimedOut) {
        logAuth('[LOGIN HARD TIMEOUT]', {
          source,
          elapsedMs: elapsed,
        });
      }
      sessionRecoveryLockRef.current = true;
      logAuth('[AUTH DEADLOCK DETECTED]', {
        reason: 'login_loading_stuck_recovery',
        source,
        elapsedMs: elapsed,
      });
      try {
        const client = getSupabaseClient();
        if (!client) return;
        const { data } = await withTimeout(client.auth.getSession(), 4000, 'session_recovery');
        if (!data?.session?.user) return;
        const hydrated = await withTimeout(authService.getCurrentUser(), 7000, 'hydration_recovery');
        if (!hydrated) return;
        const selectedRole = pendingLoginRoleRef.current;
        if (selectedRole && !isRoleAllowedForSelectedLogin(selectedRole, hydrated.role)) {
          setLoginError(getRoleMismatchMessageForLogin(selectedRole));
          return;
        }
        setUser(hydrated);
        setIsInitialLoading(false);
        const targetRoute =
          hydrated.role === 'admin' || hydrated.role === 'hr'
            ? '/admin/dashboard'
            : '/employee/dashboard';
        requestAuthNavigation({
          pipelineId: activeAuthPipelineRef.current?.pipelineId ?? null,
          target: targetRoute,
          replace: true,
          navigate,
        });
        logAuth('[LOGIN SESSION RECOVERED]', {
          source,
          targetRoute,
          hydratedUserId: hydrated.id,
          hydratedRole: hydrated.role,
        });
      } catch (error) {
        logAuth('[AUTH HYDRATION FAILED]', {
          source,
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        dispatchAuthFlow({ type: 'RELEASE_LOADING' });
        activeLoginAttemptIdRef.current = null;
        sessionRecoveryLockRef.current = false;
        if (hardTimedOut) {
          logAuth('[LOGIN FORCED RELEASE]', { source, elapsedMs: elapsed });
        }
        logAuth('[LOGIN STATE RELEASED]', { source: `${source}_recovery_finally` });
      }
    };

    const interval = window.setInterval(() => {
      void tryRecoverStuckLogin('watchdog');
    }, 2000);

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        void tryRecoverStuckLogin('visibilitychange');
      }
    };
    const onPageShow = () => {
      void tryRecoverStuckLogin('pageshow');
    };
    const onOnline = () => {
      void tryRecoverStuckLogin('online');
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pageshow', onPageShow);
    window.addEventListener('online', onOnline);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pageshow', onPageShow);
      window.removeEventListener('online', onOnline);
    };
  }, [isLoggingIn, logAuth, navigate, authFlow.status, authFlow.loading]);

  /** PWA/WebView: ao voltar ao foreground, revalidar sessão e destravar loading sem reload. */
  useEffect(() => {
    if (typeof document === 'undefined' || typeof window === 'undefined') return;
    const reconcile = () => {
      if (document.visibilityState !== 'visible') return;
      void (async () => {
        try {
          if (!checkSupabaseConfigured()) return;
          const client = getSupabaseClient();
          if (!client) return;
          const { data } = await withTimeout(client.auth.getSession(), 6000, 'foreground_resume_session');
          if (!data?.session?.user) return;
          if (isLoggingIn && loginStartedAtRef.current && Date.now() - loginStartedAtRef.current > 4000) {
            dispatchAuthFlow({ type: 'RELEASE_LOADING' });
            activeLoginAttemptIdRef.current = null;
            logAuth('[AUTH FOREGROUND RECONCILE]', { action: 'release_stuck_loading' });
          }
          if (!user && data.session.user) {
            const u = await withTimeout(authService.getCurrentUser(), 8000, 'foreground_resume_hydrate');
            if (u) {
              flushSync(() => {
                setUser(u);
                alreadyAuthenticatedRef.current = true;
                setIsInitialLoading(false);
              });
              window.dispatchEvent(new Event('current_user_changed'));
              logAuth('[AUTH FOREGROUND RECONCILE]', { action: 'hydrated_from_session' });
            }
          }
        } catch (e) {
          logAuth('[AUTH FOREGROUND RECONCILE]', { error: String(e) });
        }
      })();
    };
    document.addEventListener('visibilitychange', reconcile);
    window.addEventListener('pageshow', reconcile);
    return () => {
      document.removeEventListener('visibilitychange', reconcile);
      window.removeEventListener('pageshow', reconcile);
    };
  }, [isLoggingIn, user, logAuth, dispatchAuthFlow]);

  /** Limpa sessão e estado para tentar login de novo (timeout, 400 ou sessão quebrada). */
  const handleClearSessionAndRetry = async () => {
    setLoginError(null);
    setIsResettingSession(true);
    try {
      await resetSession();
    } finally {
      setIsResettingSession(false);
    }
  };

  /** Voltar à tela de login sem recarregar (útil se a reconexão automática já tiver restaurado). */
  const handleBackToLogin = () => {
    setConnectionUnavailable(false);
    setLoginError(null);
  };

  const handleLogout = useCallback(async () => {
    // Zera o estado React imediatamente — evita qualquer re-render com usuário ainda presente
    // enquanto o signOut assíncrono ainda está em andamento.
    setUser(null);
    setCompany(null);
    setInsights(null);
    insightsAutoFetchDoneRef.current = false;
    setLoginError(null);
    setConnectionUnavailable(false);
    setConnectionIssueMessage(null);
    setIsReconnecting(false);
    setIsInitialLoading(false);
    pendingLoginRoleRef.current = null;
    roleMismatchHandlingRef.current = false;
    alreadyAuthenticatedRef.current = false;
    activeAuthPipelineRef.current = null;
    dispatchAuthFlow({ type: 'RESET' });
    resetAuthNavigationCoordinator();

    // Limpa caches para não vazar dados entre sessões (memória + React Query)
    queryCache.clear();
    clearTenantScopedCaches(user ? { companyId: user.companyId, userId: user.id } : undefined);
    try {
      queryClient.clear();
    } catch {
      // ignora
    }

    try {
      await authService.signOut();
      // Em PWA, caches podem manter respostas/artefatos antigos em memória.
      try {
        if (typeof window !== 'undefined' && 'caches' in window) {
          const names = await caches.keys();
          await Promise.all(
            names
              .filter((n) => n.startsWith('smartponto-'))
              .map((n) => caches.delete(n)),
          );
        }
      } catch {
        // ignora falha ao limpar caches
      }
    } catch (error) {
      console.error('Erro ao fazer logout:', error);
    }

    // Logout SPA: evita “flash” cinza causado por recarga completa.
    navigate('/', { replace: true });
  }, [navigate]);

  useSessionTimeout(
    globalSettings?.session_timeout_minutes ?? 60,
    handleLogout,
    !!user
  );

  // Theme functions (ANTES de qualquer return condicional)
  const toggleTheme = useCallback(() => {
    try {
      const nextTheme = theme === 'light' ? 'dark' : 'light';
      setTheme(nextTheme);
    } catch (error) {
      console.error('Erro ao alternar tema:', error);
    }
  }, [theme]);

  const getThemeIcon = useCallback(() => {
    return theme === 'light' ? <Sun size={20} /> : <Moon size={20} />;
  }, [theme]);

  const getThemeLabel = useCallback(() => {
    return theme === 'light' ? i18n.t('layout.themeLight') : i18n.t('layout.themeDark');
  }, [theme]);

  // Reconexão automática quando servidor está indisponível (ex.: free tier pausado)
  useEffect(() => {
    if (!connectionUnavailable || !checkSupabaseConfigured()) return;

    let active = true;
    let retryDelayMs = 3000;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const scheduleNext = () => {
      if (!active) return;
      timeoutId = setTimeout(run, retryDelayMs);
    };

    const run = async () => {
      if (!active) return;
      setIsReconnecting(true);
      const result = await checkSupabaseConnection();
      if (!active) return;
      if (result.ok) {
        setConnectionIssueMessage(null);
        setConnectionUnavailable(false);
        setIsReconnecting(false);
        return;
      }
      setIsReconnecting(false);
      if (result.status === 'dns') {
        setConnectionIssueMessage('Falha de DNS detectada ao acessar o Supabase. Verifique conexão/rede DNS e tente novamente.');
      } else if (result.status === 'circuit_breaker') {
        setConnectionIssueMessage(result.message);
      } else if (result.status === 'offline') {
        setConnectionIssueMessage('Sem internet no dispositivo. Reconecte e tente novamente.');
      }
      retryDelayMs = Math.min(retryDelayMs * 2, 30000);
      scheduleNext();
    };

    run();

    return () => {
      active = false;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [connectionUnavailable]);

  // Timeout de segurança adicional para garantir que o loading sempre termine
  useEffect(() => {
    if (!isInitialLoading) return;

    const safetyTimeout = setTimeout(() => {
      console.warn('Safety timeout triggered - forcing app to load');
      setIsInitialLoading(false);
    }, 90000);

    return () => clearTimeout(safetyTimeout);
  }, [isInitialLoading]);

  if (isInitialLoading) {
    return <div className="min-h-screen bg-slate-950 flex items-center justify-center"><LoadingState message={i18n.t('app.securingConnection')} /></div>;
  }

  // Fallback: servidor temporariamente indisponível (free tier pausado / rede lenta)
  if (connectionUnavailable) {
    const onClearSession = async () => {
      setIsResettingSession(true);
      try {
        await resetSession();
      } finally {
        setIsResettingSession(false);
      }
    };
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex flex-col items-center justify-center p-6 text-center">
        <div className="max-w-md w-full space-y-6">
          <div className="w-16 h-16 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center mx-auto">
            <AlertTriangle className="w-8 h-8 text-amber-600 dark:text-amber-400" />
          </div>
          <h1 className="text-xl font-semibold text-slate-900 dark:text-white">
            {i18n.t('app.serverUnavailable')}
          </h1>
          <p className="text-slate-600 dark:text-slate-400 text-sm">
            {connectionIssueMessage || (isReconnecting ? i18n.t('app.reconnecting') : isResettingSession ? i18n.t('app.clearingSession') : i18n.t('app.waitOrClear'))}
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Button
              onClick={handleBackToLogin}
              variant="outline"
              className="w-full sm:w-auto"
              disabled={isResettingSession}
            >
              {i18n.t('app.backToLogin')}
            </Button>
            <Button
              onClick={onClearSession}
              className="w-full sm:w-auto"
              disabled={isResettingSession}
              loading={isResettingSession}
            >
              {isResettingSession ? i18n.t('app.clearing') : i18n.t('app.clearSessionRetry')}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (location.pathname === '/reset-password' || isRecoveryHash) {
    return (
      <React.Suspense
        key={`route-load-${routeLoadAttempt}`}
        fallback={<RouteLoadingFallback message="Carregando..." onRetry={handleRouteRetry} />}
      >
        <ResetPasswordRoute />
      </React.Suspense>
    );
  }

  if (!user) {
    if (location.pathname === '/accept-invite') {
      return (
        <React.Suspense
          key={`route-load-${routeLoadAttempt}`}
          fallback={<RouteLoadingFallback message="Carregando..." onRetry={handleRouteRetry} />}
        >
          <AcceptInviteRoute />
        </React.Suspense>
      );
    }

    return (
      <div className={`min-h-screen relative flex flex-col lg:flex-row overflow-x-hidden overflow-y-auto font-sans transition-colors duration-300 ${theme === 'dark' ? 'dark' : ''}`}>
        {/* Fundo com gradiente - alterna entre modo claro e escuro */}
        <div className={`fixed inset-0 z-0 transition-all duration-500 ${
          theme === 'dark' 
            ? 'bg-gradient-to-br from-slate-950 via-purple-950 to-indigo-950' 
            : 'bg-gradient-to-br from-indigo-600 via-purple-600 to-violet-700'
        }`} />

        {/* Padrão de pontos sutis */}
        <div
          className={`fixed inset-0 z-0 transition-opacity duration-500 ${theme === 'dark' ? 'opacity-20' : 'opacity-30'}`}
          style={{
            backgroundImage: `radial-gradient(circle at 1px 1px, rgba(255,255,255,0.15) 1px, transparent 0)`,
            backgroundSize: '40px 40px',
          }}
        />

        {/* Toggle de tema */}
        <button
          onClick={toggleTheme}
          className="fixed top-5 right-5 z-50 p-3 bg-white/10 hover:bg-white/20 backdrop-blur-md rounded-xl border border-white/20 transition-all group"
          aria-label={getThemeLabel()}
          title={getThemeLabel()}
        >
          <div className="text-white/80 group-hover:text-white group-hover:scale-110 transition-all">
            {getThemeIcon()}
          </div>
        </button>

        {/* Área de Apresentação - Esquerda no Desktop, Topo no Mobile */}
        <div className={`relative z-10 w-full lg:w-1/2 lg:min-h-screen flex items-center justify-center py-10 lg:py-0 ${theme === 'dark' ? 'bg-black/20' : 'bg-white/10'} lg:bg-transparent transition-colors duration-500`}>
          <PresentationPanel />
        </div>

        {/* Área de Login - Direita no Desktop, Abaixo no Mobile */}
        <div className={`relative z-10 w-full lg:w-1/2 lg:min-h-screen flex items-center justify-center px-4 sm:px-6 lg:px-8 py-8 lg:py-0 backdrop-blur-sm transition-colors duration-500 ${
          theme === 'dark' ? 'bg-slate-950/30' : 'bg-white/10'
        } lg:bg-transparent lg:backdrop-blur-none`}>
          <LoginCard
            onLogin={handleLogin}
            isLoading={isLoggingIn}
            error={loginError}
            onClearError={() => setLoginError(null)}
            onClearSession={handleClearSessionAndRetry}
            isResettingSession={isResettingSession}
          />
        </div>
      </div>
    );
  }

  const path = location.pathname;
  const isAdminRoute = path.startsWith('/admin');
  const isEmployeeRoute = path.startsWith('/employee');
  const isPortalRoute =
    isAdminRoute ||
    isEmployeeRoute ||
    path === '/dashboard' ||
    path === '/dashboard-admin' ||
    path === '/dashboard-employee' ||
    path === '/time-clock' ||
    path === '/time-records' ||
    path === '/settings' ||
    path === '/profile' ||
    path === '/employees' ||
    path === '/schedules' ||
    path === '/real-time-insights' ||
    path === '/company' ||
    path === '/reports' ||
    path === '/time-balance' ||
    path === '/requests' ||
    path === '/vacations' ||
    path === '/absences' ||
    path === '/notifications' ||
    path === '/ai-chat' ||
    path === '/locations' ||
    path === '/devices';

  const isAdminOrHr = user.role === 'admin' || user.role === 'hr';

  if (path === '/trocar-conta') {
    const roleLabel = isAdminOrHr ? i18n.t('accountSwitch.roleAdmin') : i18n.t('accountSwitch.roleEmployee');
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex flex-col items-center justify-center p-6">
        <button
          type="button"
          onClick={toggleTheme}
          className="absolute top-5 right-5 z-20 p-3 bg-white/90 dark:bg-slate-900/70 hover:bg-white dark:hover:bg-slate-900 backdrop-blur-md rounded-xl border border-slate-200 dark:border-slate-700/80 transition-all shadow-sm"
          aria-label={getThemeLabel()}
          title={getThemeLabel()}
        >
          <div className="text-slate-700 dark:text-white">{getThemeIcon()}</div>
        </button>
        <div className="w-full max-w-md space-y-6 rounded-[2rem] border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-8 shadow-xl shadow-slate-900/10">
          <div className="flex items-center gap-3 text-indigo-600 dark:text-indigo-400">
            <UserCog className="w-8 h-8 shrink-0" aria-hidden />
            <h1 className="text-xl font-bold text-slate-900 dark:text-white">{i18n.t('accountSwitch.title')}</h1>
          </div>
          <p className="text-sm text-slate-600 dark:text-slate-400">{i18n.t('accountSwitch.intro')}</p>
          <div className="rounded-2xl border border-slate-100 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-800/50 p-4">
            <p className="text-sm font-bold text-slate-900 dark:text-white truncate">{user.nome}</p>
            <p className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 mt-1">{roleLabel}</p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 break-all">{user.email}</p>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">{i18n.t('accountSwitch.hint')}</p>
          <div className="flex flex-col sm:flex-row gap-3">
            <Button
              type="button"
              className="w-full sm:flex-1"
              variant="outline"
              onClick={() =>
                navigate(isAdminOrHr ? '/admin/dashboard' : '/employee/dashboard', { replace: true })
              }
            >
              {i18n.t('accountSwitch.continue')}
            </Button>
            <Button
              type="button"
              className="w-full sm:flex-1"
              loading={accountSwitchLogoutBusy}
              disabled={accountSwitchLogoutBusy}
              onClick={async () => {
                setAccountSwitchLogoutBusy(true);
                try {
                  await handleLogout();
                } finally {
                  setAccountSwitchLogoutBusy(false);
                }
              }}
            >
              {i18n.t('accountSwitch.signOut')}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // Sempre redirecionar raiz para a dashboard correta por role (evita mostrar layout antigo)
  if (path === '/') {
    return <Navigate to={isAdminOrHr ? '/admin/dashboard' : '/employee/dashboard'} replace />;
  }

  // Admin/HR não devem ver área de funcionário: redirecionar para dashboard admin
  if (isPortalRoute && isAdminOrHr && isEmployeeRoute) {
    return <Navigate to="/admin/dashboard" replace />;
  }

  // Funcionário em rota admin: redirecionar para dashboard do funcionário
  if (isPortalRoute && path.startsWith('/admin') && !isAdminOrHr) {
    return <Navigate to="/employee/dashboard" replace />;
  }

  const LayoutComponent = isAdminRoute ? AdminLayout : isEmployeeRoute ? EmployeeLayout : isAdminOrHr ? AdminLayout : EmployeeLayout;

  if (isPortalRoute) {
    return (
      <LayoutComponent
        user={user}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        onLogout={handleLogout}
        operationalChromeReady={portalChromeReady}
      >
        <React.Suspense
          key={`route-load-${routeLoadAttempt}`}
          fallback={<RouteLoadingFallback message="Carregando página..." onRetry={handleRouteRetry} />}
        >
          <Routes>
            {/* Rotas Admin: /admin redireciona pelo index; não duplicar Route path="/admin" (quebra sub-rotas como /admin/bank-hours). */}
            <Route
              path="/admin"
              element={
                <ProtectedRoute user={user} allowedRoles={['admin', 'hr']}>
                  <AppErrorBoundary>
                    <Outlet />
                  </AppErrorBoundary>
                </ProtectedRoute>
              }
            >
              <Route index element={<Navigate to="/admin/dashboard" replace />} />
              <Route path="dashboard" element={<AdminDashboard />} />
              <Route path="employees" element={<AdminEmployees />} />
              <Route path="import-employees" element={<ImportEmployees />} />
              <Route path="timesheet" element={<AdminTimesheet />} />
              <Route path="calculos" element={<AdminCalculos />} />
              <Route path="cartao-ponto" element={<AdminCartaoPonto />} />
              <Route path="cartao-ponto-leitura" element={<AdminCartaoPonto />} />
              <Route path="lancamento-eventos" element={<AdminLancamentoEventos />} />
              <Route path="pre-folha" element={<AdminPreFolha />} />
              <Route path="time-attendance" element={<TimeAttendancePage />} />
              <Route path="time-attendance-audit" element={<TimeAttendanceAuditPage />} />
              <Route path="geolocation-audit" element={<GeolocationAuditPage />} />
              <Route path="operational-geo-playback" element={<OperationalGeoPlaybackPage />} />
              <Route path="time-attendance-timeline" element={<TimeAttendanceTimelinePage />} />
              <Route path="operational-incidents" element={<OperationalIncidentsPage />} />
              <Route path="operational-recovery" element={<OperationalRecoveryPage />} />
              <Route path="operational-health-check" element={<OperationalHealthCheckPage />} />
              <Route path="operational-observability" element={<OperationalObservabilityPage />} />
              <Route path="production-control-center" element={<ProductionControlCenterPage />} />
              <Route path="operational-load-report" element={<OperationalLoadReportPage />} />
              <Route path="rep-operational-health" element={<RepOperationsCenterPage />} />
              <Route path="rep-operations-center" element={<RepOperationsCenterPage />} />
              <Route path="absences" element={<AbsencesPage />} />
              <Route path="ausencias" element={<AdminAusencias />} />
              <Route path="requests" element={<RequestsPage />} />
              <Route path="monitoring" element={<AdminMonitoring />} />
              <Route path="schedules" element={<AdminSchedules />} />
              <Route path="shifts" element={<AdminShifts />} />
              <Route path="colaborador-jornada" element={<AdminColaboradorJornada />} />
              <Route path="departments" element={<DepartmentsPage />} />
              <Route path="job-titles" element={<AdminJobTitles />} />
              <Route path="estruturas" element={<AdminEstruturas />} />
              <Route path="cidades" element={<AdminCidades />} />
              <Route path="estados-civis" element={<AdminEstadosCivis />} />
              <Route path="eventos" element={<AdminEventos />} />
              <Route path="motivo-demissao" element={<AdminMotivoDemissao />} />
              <Route path="feriados" element={<AdminFeriados />} />
              <Route path="justificativas" element={<AdminJustificativas />} />
              <Route path="arquivar-calculos" element={<AdminArquivarCalculos />} />
              <Route path="colunas-mix" element={<AdminColunasMix />} />
              <Route path="ponto-diario" element={<AdminPontoDiario />} />
              <Route path="ponto-diario-leitura" element={<AdminPontoDiario />} />
              <Route path="arquivos-fiscais" element={<AdminArquivosFiscais />} />
              <Route path="rep-devices" element={<AdminRepDevices />} />
              <Route path="import-rep" element={<AdminImportRep />} />
              <Route path="rep-unresolved" element={<AdminRepUnresolvedPunches />} />
              <Route path="live-attendance" element={<Navigate to="/admin/monitoring" replace />} />
              <Route path="fiscalizacao" element={<AdminFiscalizacao />} />
              <Route path="security" element={<AdminSecurity />} />
              <Route path="company" element={<AdminCompany />} />
              <Route path="reports" element={<AdminReports />} />
              <Route path="reports/read/:slug" element={<ReportReadPage />} />
              <Route path="reports/work-hours" element={<ReportWorkHours />} />
              <Route path="reports/overtime" element={<ReportOvertime />} />
              <Route path="reports/inconsistencies" element={<ReportInconsistencies />} />
              <Route path="reports/bank-hours" element={<ReportBankHours />} />
              <Route path="reports/security" element={<ReportSecurity />} />
              <Route path="bank-hours" element={<AdminBankHours />} />
              <Route path="ajuda" element={<AdminAjuda />} />
              <Route path="metricas-produto" element={<AdminMetricasProduto />} />
              <Route path="settings" element={<AdminSettings />} />
            </Route>
            {/* Rotas Funcionário: só colaborador/supervisor (admin já é redirecionado antes; reforço RBAC) */}
            <Route
              path="/employee"
              element={
                <RoleGuard user={user} allowedRoles={['employee', 'supervisor']} redirectTo="/admin/dashboard">
                  <AppErrorBoundary>
                    <Outlet />
                  </AppErrorBoundary>
                </RoleGuard>
              }
            >
              <Route index element={<Navigate to="/employee/dashboard" replace />} />
              <Route path="dashboard" element={<EmployeeDashboard />} />
              <Route path="work-schedule" element={<MyWorkSchedule />} />
              <Route path="clock" element={<EmployeeClockIn />} />
              <Route path="timesheet" element={<EmployeeTimesheet />} />
              <Route path="monitoring" element={<EmployeeMonitoring />} />
              <Route path="requests" element={<RequestsPage />} />
              <Route path="absences" element={<AbsencesPage />} />
              <Route path="profile" element={<EmployeeProfile />} />
              <Route path="settings" element={<EmployeeSettings />} />
              <Route path="time-balance" element={<TimeBalancePage />} />
              <Route path="holerite" element={<Navigate to="/employee/dashboard" replace />} />
            </Route>
            {/* Atalhos legados (sidebar antiga / links salvos): enviam para a área correta */}
            <Route path="/time-balance" element={<Navigate to={isAdminOrHr ? '/admin/bank-hours' : '/employee/time-balance'} replace />} />
            <Route
              path="/requests"
              element={<Navigate to={isAdminOrHr ? '/admin/requests' : '/employee/requests'} replace />}
            />
            {/* Rotas legadas: /dashboard redireciona pela role para evitar confusão */}
            <Route path="/dashboard" element={<Navigate to={isAdminOrHr ? '/admin/dashboard' : '/employee/dashboard'} replace />} />
            <Route
              path="/dashboard-admin"
              element={
                <RoleGuard user={user} allowedRoles={['admin', 'hr']}>
                  <AdminDashboard />
                </RoleGuard>
              }
            />
            <Route
              path="/dashboard-employee"
              element={
                <RoleGuard user={user} allowedRoles={['employee', 'supervisor']} redirectTo="/admin/dashboard">
                  <EmployeeDashboard />
                </RoleGuard>
              }
            />
            <Route
              path="/time-clock"
              element={
                <RoleGuard user={user} allowedRoles={['employee', 'supervisor']} redirectTo="/admin/dashboard">
                  <TimeClockPage />
                </RoleGuard>
              }
            />
            <Route
              path="/time-records"
              element={
                <RoleGuard user={user} allowedRoles={['employee', 'supervisor']} redirectTo="/admin/dashboard">
                  <TimeRecordsPage />
                </RoleGuard>
              }
            />
            <Route
              path="/settings"
              element={
                <RoleGuard user={user} allowedRoles={['admin', 'hr']} redirectTo="/employee/settings">
                  <SettingsPage />
                </RoleGuard>
              }
            />
            <Route path="/profile" element={<ProfileViewLazy user={user} />} />
            <Route
              path="/employees"
              element={
                <RoleGuard user={user} allowedRoles={['admin', 'hr']}>
                  <EmployeesPage />
                </RoleGuard>
              }
            />
            <Route
              path="/schedules"
              element={
                <RoleGuard user={user} allowedRoles={['admin', 'hr']}>
                  <SchedulesPage />
                </RoleGuard>
              }
            />
            <Route
              path="/real-time-insights"
              element={
                <RoleGuard user={user} allowedRoles={['admin', 'hr']}>
                  <RealTimeInsightsPage />
                </RoleGuard>
              }
            />
            <Route
              path="/company"
              element={
                <RoleGuard user={user} allowedRoles={['admin', 'hr']}>
                  <CompanyPage user={user} />
                </RoleGuard>
              }
            />
            <Route
              path="/reports"
              element={
                <RoleGuard user={user} allowedRoles={['admin', 'hr']}>
                  <ReportsPage />
                </RoleGuard>
              }
            />
          </Routes>
        </React.Suspense>
      </LayoutComponent>
    );
  }

  return (
    <Layout
      user={user}
      activeTab={activeTab}
      setActiveTab={setActiveTab}
      onLogout={handleLogout}
      operationalChromeReady={portalChromeReady}
    >
      {showOnboarding && (
        <Onboarding
          onComplete={() => {
            try {
              localStorage.setItem(`onboarding_${user.id}`, 'true');
            } catch (err) {
              console.warn('[App] Falha ao salvar onboarding:', err);
            }
            setShowOnboarding(false);
          }}
        />
      )}
      <SuccessOverlay visible={showCelebration} title="Ponto Registrado" message="Sua marcação foi validada e salva com sucesso." />

      <React.Suspense
        key={`route-load-${routeLoadAttempt}`}
        fallback={<RouteLoadingFallback message="Carregando..." onRetry={handleRouteRetry} />}
      >
        {activeTab === 'dashboard' && (
          <div className="space-y-10 animate-in slide-in-from-bottom-6 duration-700">
            <header className="flex flex-col md:flex-row md:items-center justify-between gap-6">
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <Building2 size={16} className="text-indigo-600" />
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{company?.name}</span>
                </div>
                <h2 className="text-4xl font-extrabold text-slate-900 dark:text-white tracking-tight">Olá, {user.nome.split(' ')[0]}</h2>
              </div>
              {insights && (
                <div className="glass-card px-6 py-5 rounded-3xl flex items-start gap-4 max-w-sm border-indigo-100 dark:border-indigo-900/30">
                  <div className="mt-1 p-2 bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 rounded-xl active-pulse"><Sparkles size={20} /></div>
                  <div>
                    <p className="text-[10px] font-bold text-indigo-600 dark:text-indigo-400 uppercase tracking-widest mb-1">IA Insights</p>
                    <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed font-medium">{insights.insight}</p>
                  </div>
                </div>
              )}
            </header>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-10">
              <div className="lg:col-span-2 space-y-10">
                <div className="glass-card rounded-[3rem] p-10 md:p-14 relative overflow-hidden">
                  <div className="absolute top-10 right-10">
                    <Badge color={isWorking ? 'green' : 'slate'}>{stats.status}</Badge>
                  </div>
                  <Clock />
                  {/* Timer visual de jornada */}
                  <div className="mt-6">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                        Progresso da jornada
                      </span>
                      <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                        {todayLabel}
                      </span>
                    </div>
                    <div className="w-full h-3 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-indigo-500 via-blue-500 to-emerald-500 rounded-full transition-all duration-500"
                        style={{ width: `${Math.round(todayProgress * 100)}%` }}
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 mt-14">
                    {!isWorking ? (
                      <Button loading={isPunching} onClick={() => handlePunchStart(LogType.IN)} size="xl" className="flex items-center justify-center gap-3">
                        <Camera size={24} /> Entrada
                      </Button>
                    ) : (
                      <Button loading={isPunching} onClick={() => handlePunchStart(LogType.OUT)} variant="secondary" size="xl" className="flex items-center justify-center gap-3">
                        <Camera size={24} /> Saída
                      </Button>
                    )}
                    <Button disabled={isPunching || !isWorking} onClick={() => handlePunchStart(LogType.BREAK)} variant="outline" size="xl" className="flex items-center justify-center gap-3">
                      <Camera size={24} /> Pausa
                    </Button>
                  </div>
                  {company?.settings?.requirePhoto && (
                    <div className="mt-6 flex items-center justify-center gap-2 text-xs text-slate-600 dark:text-slate-400">
                      <Camera size={16} className="text-indigo-600 dark:text-indigo-400" />
                      <span className="font-bold">Foto obrigatória para registro</span>
                    </div>
                  )}
                  {error && (
                    <div className="mt-10 p-5 bg-red-50 dark:bg-red-950/20 border border-red-100 dark:border-red-900/30 rounded-2xl flex items-center gap-4 text-red-600 text-sm font-bold animate-in shake duration-500">
                      <AlertTriangle size={20} /> <span>{error}</span>
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
                  {[
                    { label: 'Total Hoje', value: stats.today, icon: ClockIcon, color: 'text-indigo-600', bg: 'bg-indigo-50 dark:bg-indigo-900/20' },
                    { label: 'Banco Horas', value: stats.balance, icon: Crown, color: 'text-green-600', bg: 'bg-green-50 dark:bg-green-900/20' },
                    { label: 'Agenda', value: 'Completa', icon: CalendarDays, color: 'text-amber-600', bg: 'bg-amber-50 dark:bg-amber-900/20' },
                  ].map((stat, idx) => (
                    <div key={idx} className="glass-card p-8 rounded-[2.5rem] group hover:scale-[1.02] transition-transform">
                      <div className={`w-14 h-14 rounded-2xl ${stat.bg} ${stat.color} flex items-center justify-center mb-6`}><stat.icon size={28} /></div>
                      <p className="text-slate-400 text-[10px] font-bold uppercase tracking-widest">{stat.label}</p>
                      <p className="text-3xl font-extrabold text-slate-900 dark:text-white mt-2 tabular-nums">{stat.value}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="glass-card rounded-[3rem] p-10 h-fit">
                <h3 className="font-extrabold text-2xl text-slate-900 dark:text-white mb-10">Jornada Hoje</h3>
                <div className="space-y-10">
                  {records.filter(r => r.createdAt.toDateString() === new Date().toDateString()).map((rec) => (
                    <div key={rec.id} className="flex gap-6 relative group">
                      <div className={`w-5 h-5 rounded-full border-[4px] mt-1.5 shrink-0 ${rec.type === LogType.IN ? 'border-indigo-600' : 'border-slate-300'}`}></div>
                      <div className="flex-1">
                        <div className="flex justify-between items-start">
                          <p className="text-lg font-bold text-slate-900 dark:text-white capitalize leading-none">{rec.type}</p>
                          <p className="text-sm font-bold text-slate-400">{rec.createdAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                  {records.length === 0 && <div className="py-10 text-center opacity-40 text-xs font-bold uppercase tracking-widest">Aguardando primeiro registro</div>}
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'history' && (
          <div className="animate-in slide-in-from-bottom-6 duration-700 space-y-8">
            <h2 className="text-4xl font-extrabold text-slate-900 dark:text-white">Meu Histórico</h2>
            <div className="glass-card rounded-[2.5rem] overflow-hidden">
              {/* Filtros avançados */}
              <div className="px-10 pt-8 pb-4 flex flex-col md:flex-row gap-4 md:items-end">
                <div className="flex-1 space-y-2">
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Data</p>
                  <input
                    type="date"
                    value={historyDateFilter}
                    onChange={(e) => setHistoryDateFilter(e.target.value)}
                    className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div className="flex-1 space-y-2">
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Tipo</p>
                  <select
                    value={historyTypeFilter}
                    onChange={(e) => setHistoryTypeFilter(e.target.value as 'all' | LogType)}
                    className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="all">Todos</option>
                    <option value={LogType.IN}>Entrada</option>
                    <option value={LogType.OUT}>Saída</option>
                    <option value={LogType.BREAK}>Pausa</option>
                  </select>
                </div>
                <div className="flex-1 space-y-2">
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Método</p>
                  <select
                    value={historyMethodFilter}
                    onChange={(e) => setHistoryMethodFilter(e.target.value as 'all' | PunchMethod)}
                    className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="all">Todos</option>
                    <option value={PunchMethod.PHOTO}>Foto</option>
                    <option value={PunchMethod.GPS}>GPS</option>
                    <option value={PunchMethod.BIOMETRIC}>Biometria</option>
                    <option value={PunchMethod.MANUAL}>Manual</option>
                  </select>
                </div>
              </div>
              <table className="w-full text-left">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-800">
                    <th className="px-10 py-6 text-[10px] font-bold text-slate-400 uppercase">Data</th>
                    <th className="px-10 py-6 text-[10px] font-bold text-slate-400 uppercase">Tipo</th>
                    <th className="px-10 py-6 text-[10px] font-bold text-slate-400 uppercase">Método</th>
                    <th className="px-10 py-6 text-[10px] font-bold text-slate-400 uppercase">Horário</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {filteredHistory.slice(0, 50).map(rec => (
                    <tr key={rec.id} className="hover:bg-indigo-50/20 transition-colors">
                      <td className="px-10 py-7 font-bold">{rec.createdAt.toLocaleDateString('pt-BR')}</td>
                      <td className="px-10 py-7">
                        <Badge color={rec.type === LogType.IN ? 'indigo' : 'slate'}>
                          {rec.type}
                        </Badge>
                      </td>
                      <td className="px-10 py-7">
                        <Badge color={
                          rec.method === PunchMethod.PHOTO
                            ? 'indigo'
                            : rec.method === PunchMethod.GPS
                            ? 'blue'
                            : rec.method === PunchMethod.BIOMETRIC
                            ? 'violet'
                            : 'slate'
                        }>
                          {rec.method === PunchMethod.PHOTO && 'Foto'}
                          {rec.method === PunchMethod.GPS && 'GPS'}
                          {rec.method === PunchMethod.BIOMETRIC && 'Biometria'}
                          {rec.method === PunchMethod.MANUAL && 'Manual'}
                        </Badge>
                      </td>
                      <td className="px-10 py-7 text-lg font-extrabold tabular-nums">
                        {rec.createdAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {records.length === 0 && (
                <div className="p-20 text-center text-slate-400 text-xs font-bold uppercase tracking-widest">
                  Nenhum registro encontrado
                </div>
              )}
              {records.length > 0 && filteredHistory.length === 0 && (
                <div className="p-6 text-center text-slate-400 text-[11px] font-bold uppercase tracking-widest border-t border-slate-100 dark:border-slate-800">
                  Nenhum registro com os filtros aplicados
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'admin' && (user.role === 'admin' || user.role === 'hr') && (
          <Navigate to="/admin/dashboard" replace />
        )}

        {activeTab === 'settings' && <ProfileViewLazy user={user} />}
      </React.Suspense>

      {/* Diálogo de seleção de método de registro */}
      {showMethodSelection && !punchType && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/80 backdrop-blur-xl animate-in fade-in duration-300"
          onClick={(e) => {
            // Fechar ao clicar no backdrop
            if (e.target === e.currentTarget) {
              setShowMethodSelection(false);
              setPendingPunchType(null);
            }
          }}
        >
          <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-[3rem] shadow-2xl overflow-hidden animate-in zoom-in-95 duration-300 border border-white/10">
            <div className="p-10 text-center">
              <div className="w-20 h-20 bg-gradient-to-br from-indigo-600 to-violet-600 rounded-full flex items-center justify-center mx-auto mb-6 shadow-2xl shadow-indigo-600/30">
                <ShieldCheck size={40} className="text-white" />
              </div>
              <h3 className="text-2xl font-black text-slate-900 dark:text-white mb-2">
                Como deseja registrar?
              </h3>
              <p className="text-slate-600 dark:text-slate-400 text-sm mb-6">
                Escolha o método de validação para seu registro de ponto
              </p>

              <div className="space-y-3">
                {/* Selfie por Foto */}
                <button
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (pendingPunchType) {
                      setSelectedMethod(PunchMethod.PHOTO);
                      setPunchType(pendingPunchType);
                      setShowMethodSelection(false);
                    }
                  }}
                  type="button"
                  className="w-full p-5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl font-bold text-base flex items-center gap-4 transition-all shadow-xl shadow-indigo-600/20 active:scale-95"
                >
                  <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center shrink-0">
                    <Camera size={24} />
                  </div>
                  <div className="text-left">
                    <p className="font-bold">Selfie por Foto</p>
                    <p className="text-indigo-200 text-xs">Capture uma foto do rosto</p>
                  </div>
                </button>

                {/* Localização GPS */}
                <button
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (pendingPunchType) {
                      setSelectedMethod(PunchMethod.GPS);
                      setPunchType(pendingPunchType);
                      setShowMethodSelection(false);
                    }
                  }}
                  type="button"
                  className="w-full p-5 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl font-bold text-base flex items-center gap-4 transition-all shadow-xl shadow-blue-600/20 active:scale-95"
                >
                  <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center shrink-0">
                    <MapPin size={24} />
                  </div>
                  <div className="text-left">
                    <p className="font-bold">Localização GPS</p>
                    <p className="text-blue-200 text-xs">Validação por geolocalização</p>
                  </div>
                </button>

                {/* Impressão Digital */}
                <button
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (pendingPunchType) {
                      setSelectedMethod(PunchMethod.BIOMETRIC);
                      setPunchType(pendingPunchType);
                      setShowMethodSelection(false);
                    }
                  }}
                  type="button"
                  className="w-full p-5 bg-violet-600 hover:bg-violet-700 text-white rounded-2xl font-bold text-base flex items-center gap-4 transition-all shadow-xl shadow-violet-600/20 active:scale-95"
                >
                  <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center shrink-0">
                    <ScanLine size={24} />
                  </div>
                  <div className="text-left">
                    <p className="font-bold">Impressão Digital</p>
                    <p className="text-violet-200 text-xs">Biometria via sensor do dispositivo</p>
                  </div>
                </button>

                {/* Ponto Manual (se permitido nas configurações globais e da empresa) */}
                {(company?.settings?.allowManualPunch ?? true) && (globalSettings?.allow_manual_punch ?? true) && (
                  <button
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      if (pendingPunchType) {
                        setSelectedMethod(PunchMethod.MANUAL);
                        setPunchType(pendingPunchType);
                        setShowMethodSelection(false);
                      }
                    }}
                    type="button"
                    className="w-full p-5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-900 dark:text-white rounded-2xl font-bold text-base flex items-center gap-4 transition-all border-2 border-slate-200 dark:border-slate-700 active:scale-95"
                  >
                    <div className="w-12 h-12 bg-slate-200 dark:bg-slate-700 rounded-xl flex items-center justify-center shrink-0">
                      <Keyboard size={24} />
                    </div>
                    <div className="text-left">
                      <p className="font-bold">Ponto Manual</p>
                      <p className="text-slate-500 dark:text-slate-400 text-xs">Registro com justificativa</p>
                    </div>
                  </button>
                )}
              </div>

              <button
                onClick={() => {
                  setShowMethodSelection(false);
                  setPendingPunchType(null);
                  setSelectedMethod(null);
                }}
                className="mt-6 text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 text-sm font-bold transition-colors"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {punchType && (
        <PunchModal
          user={user}
          type={punchType}
          initialMethod={selectedMethod || undefined}
          onClose={() => {
            setPunchType(null);
            setPendingPunchType(null);
            setSelectedMethod(null);
          }}
          onConfirm={async (method, data) => {
            await onConfirmPunch(method, data);
            setPunchType(null);
            setPendingPunchType(null);
            setSelectedMethod(null);
          }}
        />
      )}
    </Layout>
  );
};

const appMainProfilerOnRender = createReactProfilerOnRender();

/** Badge de schema: não compete com o primeiro paint pós-login. */
const DeferredSchemaGuardBadge: React.FC = () => {
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const run = () => setShow(true);
    const ric = window.requestIdleCallback;
    if (typeof ric === 'function') {
      const id = ric.call(window, run, { timeout: 2500 });
      return () => window.cancelIdleCallback(id);
    }
    const t = window.setTimeout(run, 1200);
    return () => window.clearTimeout(t);
  }, []);
  if (!show) return null;
  return <SchemaGuardBadge />;
};

const AppContent: React.FC = () =>
  !checkSupabaseConfigured() ? (
    <ConfigSupabaseScreen />
  ) : (
    <QueryClientProvider client={queryClient}>
      <SettingsProvider>
        <Profiler id="AppMain" onRender={appMainProfilerOnRender}>
          <AppMain />
        </Profiler>
        <DeferredSchemaGuardBadge />
      </SettingsProvider>
    </QueryClientProvider>
  );

const App: React.FC = () => <AppContent />;

export default App;
