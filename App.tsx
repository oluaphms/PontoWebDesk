import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { Routes, Route, Navigate, useLocation, useNavigate, Outlet } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from './src/lib/queryClient';
import { AppInitializer } from './src/components/AppInitializer';
import { User, LogType, DailySummary, PunchMethod, Company } from './types';
import Layout from './components/Layout';
import { BRAND_IMAGE_1024 } from './components/BrandLogo';
import Clock from './components/Clock';
import PunchModal from './components/PunchModal';
import Onboarding from './components/Onboarding';
import { Button, Badge, LoadingState, SuccessOverlay, Input } from './components/UI';
import RouteLoadingFallback from './src/components/RouteLoadingFallback';
import { getWorkInsights } from './services/geminiService';
import { isAiDashboardInsightsAutoEnabled } from './services/geminiEnv';
import { PontoService, getRecordCreatedAtDate } from './services/pontoService';
import { useRecords } from './src/hooks/useRecords';
import { authService } from './services/authService';
import { queryCache } from './src/services/queryCache';
import {
  checkSupabaseConfigured,
  testSupabaseConnection,
  resetSession,
  clearLocalAuthSession,
  clearCurrentUserFromAllStorages,
} from './services/supabaseClient';
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
  User as UserIcon,
  Lock,
  ArrowLeft,
  ChevronRight,
  Settings,
  ExternalLink,
  Sun,
  Moon,
  Camera,
  Keyboard,
  MapPin,
  Eye,
  EyeOff,
  UserCog,
} from 'lucide-react';
import ForgotPasswordModal from './src/components/auth/ForgotPasswordModal';
import RoleGuard from './src/components/auth/RoleGuard';
import ProtectedRoute from './src/components/auth/ProtectedRoute';
import { useSettings, SettingsProvider } from './src/contexts/SettingsContext';
import { useLanguage } from './src/contexts/LanguageContext';
import { i18n } from './lib/i18n';
import { useSessionTimeout } from './src/hooks/useSessionTimeout';
import { readCachedUser } from './src/hooks/useCurrentUser';
import AdminLayout from './src/layouts/AdminLayout';
import EmployeeLayout from './src/layouts/EmployeeLayout';
import {
  AbsencesPage,
  AcceptInviteRoute,
  AdminAjuda,
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
  TimeBalancePage,
  TimeClockPage,
  TimeRecordsPage,
  AdminArquivosFiscais,
} from './src/routes/portalLazyPages';

// Lazy loading of complex views
const AdminView = React.lazy(() => import('./components/AdminView'));

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
    return readCachedUser() != null;
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
  const [loginStep, setLoginStep] = useState<'choice' | 'form'>('choice');
  const [loginRole, setLoginRole] = useState<'admin' | 'employee' | null>(null);
  const [loginData, setLoginData] = useState({ identifier: '', password: '' });
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [showIdentifier, setShowIdentifier] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // Conexão Supabase (fallback quando servidor pausado/rede lenta)
  const [connectionUnavailable, setConnectionUnavailable] = useState(false);
  const [connectionIssueMessage, setConnectionIssueMessage] = useState<string | null>(null);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [isResettingSession, setIsResettingSession] = useState(false);
  const [accountSwitchLogoutBusy, setAccountSwitchLogoutBusy] = useState(false);

  // Theme State (para tela de login) — alinhado a ThemeService (chave `theme` + legado)
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    if (typeof window === 'undefined') return 'dark';
    const saved = ThemeService.readStoredTheme();
    if (saved === 'light' || saved === 'dark') return saved;
    return ThemeService.getSystemTheme();
  });

  const { records, isLoading: isPunching, error, setError, addRecord } = useRecords(user?.id, user?.companyId);
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

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!window.location.hash.includes('type=recovery')) return;
    if (location.pathname === '/reset-password') return;

    navigate(`/reset-password${window.location.hash}`, { replace: true });
  }, [location.pathname, navigate]);

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
    let timeoutId: ReturnType<typeof setTimeout>;
    let isMounted = true;

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
        // getCurrentUser(): até 2×30s + retry delay — não cortar antes (cold start / deploy).
        const INIT_HYDRATE_MS = 68_000;
        const currentUser = await Promise.race([
          authService.getCurrentUser(),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), INIT_HYDRATE_MS)),
        ]).catch((error) => {
          console.error('Error getting current user:', error);
          return null;
        });

        if (isMounted && currentUser) {
          setUser(currentUser);
          try {
            const comp = await Promise.race([
              PontoService.getCompany(currentUser.companyId),
              new Promise<Company | null>((resolve) => setTimeout(() => resolve(null), 2000))
            ]).catch(() => null);

            if (comp && isMounted) setCompany(comp);
          } catch (error) {
            console.error('Error loading company:', error);
          }

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

          if (authUser) {
            // Sincroniza sempre com a sessão do Supabase (TOKEN_REFRESHED, SIGNED_IN, etc.).
            // A flag de logout em authService evita corrida com signOut; não bloquear aqui —
            // bloquear quando `current === null` impedia recuperar sessão válida após eventos tardios.
            setUser(authUser);
            PontoService.getCompany(authUser.companyId).then(comp => {
              if (isMounted && comp) setCompany(comp);
            }).catch(error => {
              console.error('Error loading company in auth state change:', error);
            });
          } else {
            setUser(null);
            setCompany(null);
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
        window.dispatchEvent(new Event('current_user_changed'));
        if (typeof window !== 'undefined') {
          window.location.href = window.location.origin + '/';
        }
      })();
    };
    window.addEventListener('supabase:auth-expired', onAuthExpired);
    return () => window.removeEventListener('supabase:auth-expired', onAuthExpired);
  }, []);

  // Ao exibir tela de login (user null), garantir formulário em estado inicial
  useEffect(() => {
    if (!user) {
      setLoginStep('choice');
      setLoginRole(null);
      setLoginData({ identifier: '', password: '' });
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

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = validateLogin(loginData);
    if (!parsed.success) {
      setLoginError(parsed.error.errors[0]?.message ?? 'Dados inválidos');
      return;
    }

    setIsLoggingIn(true);
    setLoginError(null);

    try {
      // Pré-check rápido para reduzir espera percebida quando o projeto Supabase está pausado.
      // Se der falso rapidamente, já mostramos a tela de reconexão sem esperar o signIn completo.
      const FAST_PRECHECK_TIMEOUT_MS = 2500;
      const precheckResult = await Promise.race([
        checkSupabaseConnection(),
        new Promise<'unknown'>((resolve) => setTimeout(() => resolve('unknown'), FAST_PRECHECK_TIMEOUT_MS)),
      ]);
      if (precheckResult !== 'unknown' && !precheckResult.ok) {
        const dnsHint =
          precheckResult.status === 'dns'
            ? ' Falha de DNS detectada. Verifique internet, DNS da rede e se o domínio do projeto Supabase resolve no dispositivo.'
            : '';
        setConnectionIssueMessage(`${precheckResult.message}.${dnsHint}`.trim());
        setConnectionUnavailable(true);
        setLoginError(
          `${precheckResult.message} Verifique em supabase.com/dashboard e use "Limpar sessão e tentar de novo".`
        );
        return;
      }

      // Não chamar signOut aqui: o Supabase substitui a sessão no signIn e o signOut assíncrono
      // gerava evento "sem sessão" depois do login (voltava para a tela de login) e atrasava o fluxo.

      // Delega a resolução do identificador (email, nome, CPF) para o AuthService,
      // que já trata e normaliza o valor (incluindo fallback de domínio quando necessário).
      const loginPromise = authService.signInWithEmail(loginData.identifier, loginData.password);
      /** Teto alinhado a rede lenta + cold start do Supabase após deploy. */
      const LOGIN_TIMEOUT_MS = 55_000;
      const timeoutPromise = new Promise<{ user: any; error: string | null }>((_, reject) =>
        setTimeout(
          () =>
            reject(
              new Error('LOGIN_TIMEOUT')
            ),
          LOGIN_TIMEOUT_MS
        )
      );
      let result: { user: any; error: string | null };
      try {
        result = await Promise.race([loginPromise, timeoutPromise]);
      } catch (authErr: any) {
        const errText = String(
          authErr?.message ||
          authErr?.details ||
          authErr?.hint ||
          authErr?.error?.message ||
          ''
        ).toLowerCase();
        let isTimeoutError = errText.includes('login_timeout') || errText.includes('timeout');
        const isCircuitBreakerError =
          errText.includes('circuit breaker ativo');
        let isDnsError =
          errText.includes('err_name_not_resolved') ||
          errText.includes('name_not_resolved') ||
          errText.includes('dns') ||
          errText.includes('failed to fetch');

        // Reclassifica timeout quando a causa real for DNS/rede.
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
        // Limpar sessão local para o próximo "Entrar" funcionar sem precisar clicar em "Limpar sessão"
        try {
          await clearLocalAuthSession();
        } catch {
          // ignora
        }
        return;
      }

      if (result.error) {
        const normalizedError = String(result.error || '').toLowerCase();
        const isDnsErrorResult =
          normalizedError.includes('err_name_not_resolved') ||
          normalizedError.includes('name_not_resolved') ||
          normalizedError.includes('dns') ||
          normalizedError.includes('failed to fetch');
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
        return;
      }

      if (result.user) {
        setUser(result.user);
        try {
          const comp = await Promise.race([
            PontoService.getCompany(result.user.companyId),
            new Promise<undefined>((r) => setTimeout(() => r(undefined), 3000))
          ]);
          if (comp) setCompany(comp);
        } catch {
          // segue sem empresa
        }

        if (result.user.role === 'admin' || result.user.role === 'hr') {
          setActiveTab('admin');
          navigate('/admin/dashboard', { replace: true });
        } else {
          setActiveTab('dashboard');
          navigate('/employee/dashboard', { replace: true });
        }
      }
    } catch (error: any) {
      console.error('Erro no handleLoginSubmit:', error);
      const errorText = String(
        error?.message ||
          error?.details ||
          error?.hint ||
          error?.error?.message ||
          ''
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
        return;
      }

      setLoginError(error?.message || 'Erro ao fazer login');
    } finally {
      setIsLoggingIn(false);
    }
  };

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
    setLoginStep('choice');
    setLoginRole(null);
    setLoginData({ identifier: '', password: '' });
    setLoginError(null);

    // Limpa caches para não vazar dados entre sessões (memória + React Query)
    queryCache.clear();
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

    // Recarga completa: garante cliente Supabase e UI sem sessão antiga em memória
    if (typeof window !== 'undefined') {
      window.location.replace(`${window.location.origin}/`);
    }
  }, []);

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
      <div className="min-h-screen relative flex flex-col items-center justify-center px-4 py-10 sm:p-6 overflow-x-hidden overflow-y-auto font-sans transition-colors duration-300 bg-slate-50 dark:bg-slate-950">
        <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
          <div className="absolute top-[-15%] right-[-20%] h-[50%] w-[55%] rounded-full bg-indigo-500/10 dark:bg-indigo-500/15 blur-[100px]" />
          <div className="absolute bottom-[-20%] left-[-15%] h-[45%] w-[50%] rounded-full bg-blue-500/8 dark:bg-blue-500/10 blur-[90px]" />
        </div>

        <div className="w-full max-w-md relative z-10">
          <h1 className="sr-only">
            {i18n.t('app.name')} — {i18n.t('login.slogan')}
          </h1>

          {/* Um único painel: logo em cima, ações embaixo */}
          <div className="relative rounded-[2.5rem] border border-slate-200/90 dark:border-slate-800/70 bg-white dark:bg-slate-900/90 backdrop-blur-xl shadow-2xl shadow-slate-900/12 dark:shadow-black/35 overflow-hidden transition-colors">
            <button
              onClick={toggleTheme}
              className="absolute top-5 right-5 z-20 p-3 bg-white/90 dark:bg-slate-900/70 hover:bg-white dark:hover:bg-slate-900 backdrop-blur-md rounded-xl border border-slate-200 dark:border-slate-700/80 transition-all group shadow-sm"
              aria-label={getThemeLabel()}
              title={getThemeLabel()}
            >
              <div className="text-slate-700 dark:text-white group-hover:scale-110 transition-transform">
                {getThemeIcon()}
              </div>
            </button>
            <div className="relative px-6 sm:px-8 pt-9 pb-8 sm:pb-10 flex flex-col items-center bg-gradient-to-br from-indigo-100/95 via-slate-50 to-slate-100 dark:from-slate-800 dark:via-slate-900 dark:to-slate-950">
              <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-[2.5rem]" aria-hidden>
                <div className="absolute -top-1/3 left-1/2 -translate-x-1/2 w-[140%] h-[70%] rounded-full bg-indigo-400/12 dark:bg-indigo-500/10 blur-[64px]" />
              </div>
              <img
                src={BRAND_IMAGE_1024}
                alt={`${i18n.t('app.name')} — ${i18n.t('login.slogan')}`}
                className="relative z-10 w-[min(56vw,200px)] h-[min(56vw,200px)] sm:w-44 sm:h-44 md:w-48 md:h-48 object-contain rounded-[1.75rem] shadow-2xl shadow-indigo-500/35 ring-1 ring-white/60 dark:ring-white/10"
                width={192}
                height={192}
                loading="eager"
                decoding="async"
              />

            {loginStep === 'choice' ? (
              <div className="relative z-10 w-full mt-8 space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
                <button
                  onClick={() => { setLoginRole('employee'); setLoginStep('form'); }}
                  className="w-full group p-6 bg-slate-50 dark:bg-white/5 hover:bg-indigo-600 dark:hover:bg-indigo-600 rounded-[2rem] border border-slate-200 dark:border-white/5 transition-all flex items-center justify-between text-left outline-none focus:ring-4 focus:ring-indigo-500/30"
                >
                  <div className="flex items-center gap-5">
                    <div className="w-12 h-12 bg-indigo-100 dark:bg-white/10 rounded-2xl flex items-center justify-center text-indigo-600 dark:text-white group-hover:bg-white/20 transition-colors">
                      <UserIcon size={24} />
                    </div>
                    <div>
                      <p className="text-slate-900 dark:text-white font-bold text-lg transition-colors group-hover:text-white">Entrar</p>
                      <p className="text-slate-600 dark:text-slate-400 text-xs group-hover:text-indigo-100 dark:group-hover:text-indigo-100 transition-colors">Entre como Colaborador.</p>
                    </div>
                  </div>
                  <ChevronRight size={20} className="text-slate-400 dark:text-slate-600 group-hover:text-white transition-colors" />
                </button>

                <button
                  onClick={() => { setLoginRole('admin'); setLoginStep('form'); }}
                  className="w-full group p-6 bg-slate-50 dark:bg-white/5 hover:bg-slate-800 dark:hover:bg-slate-800 rounded-[2rem] border border-slate-200 dark:border-white/5 transition-all flex items-center justify-between text-left outline-none focus:ring-4 focus:ring-slate-500/30"
                >
                  <div className="flex items-center gap-5">
                    <div className="w-12 h-12 bg-slate-100 dark:bg-white/10 rounded-2xl flex items-center justify-center text-slate-700 dark:text-white group-hover:bg-white/20 transition-colors">
                      <ShieldCheck size={24} />
                    </div>
                    <div>
                      <p className="text-slate-900 dark:text-white font-bold text-lg transition-colors group-hover:text-white">Entrar</p>
                      <p className="text-slate-600 dark:text-slate-400 text-xs group-hover:text-slate-200 dark:group-hover:text-slate-200 transition-colors">Entre como Administrador.</p>
                      </div>
                  </div>
                  <ChevronRight size={20} className="text-slate-400 dark:text-slate-600 group-hover:text-white transition-colors" />
                </button>
              </div>
            ) : (
              <div className="relative z-10 w-full mt-8 animate-in fade-in slide-in-from-right-4 duration-500">
                <button
                  onClick={() => setLoginStep('choice')}
                  className="flex items-center gap-2 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors text-[10px] font-bold uppercase tracking-widest mb-8"
                >
                  <ArrowLeft size={14} /> {i18n.t('login.backToSelection')}
                </button>

                <div className="mb-8">
                  <h2 className="text-2xl font-bold text-slate-900 dark:text-white transition-colors">Entrar</h2>
                  <p className="text-slate-600 dark:text-slate-400 text-sm transition-colors">
                    {loginRole === 'admin'
                      ? 'Entre como Administrador'
                      : 'Entre como Colaborador'}
                  </p>
                </div>

                <form onSubmit={handleLoginSubmit} className="space-y-6">
                  {/* Campo usuário oculto para acessibilidade e gerenciadores de senha (evita aviso do navegador) */}
                  <input
                    type="text"
                    autoComplete="username"
                    value={loginData.identifier}
                    readOnly
                    tabIndex={-1}
                    aria-hidden="true"
                    className="absolute w-px h-px -left-[9999px] opacity-0 pointer-events-none"
                  />
                  <div className="space-y-4">
                    <div className="relative">
                      <UserIcon className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
                      <input
                        type={showIdentifier ? 'text' : 'password'}
                        placeholder={i18n.t('login.usernameOrEmail')}
                        value={loginData.identifier}
                        onChange={e => setLoginData({ ...loginData, identifier: e.target.value })}
                        autoComplete="username"
                        className="w-full pl-12 pr-10 py-4 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700/50 rounded-2xl text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500 outline-none focus:ring-2 focus:ring-indigo-500 dark:focus:ring-indigo-600 transition-all text-sm"
                      />
                      <button
                        type="button"
                        onClick={() => setShowIdentifier((prev) => !prev)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
                        aria-label={showIdentifier ? i18n.t('app.hidePassword') : i18n.t('app.showPassword')}
                      >
                        {showIdentifier ? <EyeOff size={18} /> : <Eye size={18} />}
                      </button>
                    </div>
                    <div className="relative">
                      <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
                      <input
                        type={showPassword ? 'text' : 'password'}
                        placeholder={i18n.t('login.accessPassword')}
                        value={loginData.password}
                        onChange={e => setLoginData({ ...loginData, password: e.target.value })}
                        autoComplete="current-password"
                        className="w-full pl-12 pr-10 py-4 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700/50 rounded-2xl text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500 outline-none focus:ring-2 focus:ring-indigo-500 dark:focus:ring-indigo-600 transition-all text-sm"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((prev) => !prev)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
                        aria-label={showPassword ? i18n.t('app.hidePassword') : i18n.t('app.showPassword')}
                      >
                        {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                      </button>
                    </div>
                  </div>

                  {loginError && (
                    <div className="space-y-2">
                      <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl flex items-center gap-3 text-red-500 text-xs font-bold animate-in shake">
                        <AlertTriangle size={16} /> {loginError}
                      </div>
                      <button
                        type="button"
                        onClick={handleClearSessionAndRetry}
                        className="text-xs text-slate-500 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 underline"
                      >
                        {i18n.t('app.clearSessionRetry')}
                      </button>
                    </div>
                  )}

                  <Button
                    type="submit"
                    loading={isLoggingIn}
                    className="w-full h-14 rounded-2xl text-lg shadow-xl shadow-indigo-600/20"
                  >
                    {loginRole === 'admin'
                      ? 'Entrar como Administrador'
                      : loginRole === 'employee'
                        ? 'Entrar como Colaborador'
                        : i18n.t('login.enterSystem')}
                  </Button>

                  <p className="text-center space-x-4">
                    <button
                      type="button"
                      onClick={() => setShowForgotPassword(true)}
                      className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline font-medium"
                    >
                      {i18n.t('login.forgotPassword')}
                    </button>
                    <button
                      type="button"
                      onClick={handleClearSessionAndRetry}
                      disabled={isResettingSession}
                      className="text-sm text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 underline disabled:opacity-50"
                    >
                      {isResettingSession ? i18n.t('app.clearing') : i18n.t('app.clearSessionRetry')}
                    </button>
                  </p>
                </form>

                <ForgotPasswordModal isOpen={showForgotPassword} onClose={() => setShowForgotPassword(false)} />
              </div>
            )}
            </div>
          </div>

          <p className="text-center text-slate-500 dark:text-slate-400 text-[10px] font-bold uppercase tracking-widest mt-8 transition-colors">
            {i18n.t('login.footer')} • v1.4.0
          </p>
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
      <LayoutComponent user={user} activeTab={activeTab} setActiveTab={setActiveTab} onLogout={handleLogout}>
        <React.Suspense
          key={`route-load-${routeLoadAttempt}`}
          fallback={<RouteLoadingFallback message="Carregando página..." onRetry={handleRouteRetry} />}
        >
          <Routes>
            {/* Rotas Admin: /admin redireciona pelo index; não duplicar Route path="/admin" (quebra sub-rotas como /admin/bank-hours). */}
            <Route path="/admin" element={<ProtectedRoute user={user} allowedRoles={['admin', 'hr']}><Outlet /></ProtectedRoute>}>
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
              <Route path="settings" element={<AdminSettings />} />
            </Route>
            {/* Rotas Funcionário: só colaborador/supervisor (admin já é redirecionado antes; reforço RBAC) */}
            <Route
              path="/employee"
              element={
                <RoleGuard user={user} allowedRoles={['employee', 'supervisor']} redirectTo="/admin/dashboard">
                  <Outlet />
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
    <Layout user={user} activeTab={activeTab} setActiveTab={setActiveTab} onLogout={handleLogout}>
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

        {activeTab === 'admin' && (user.role === 'admin' || user.role === 'hr') && <AdminView admin={user} />}

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

const AppContent: React.FC = () =>
  !checkSupabaseConfigured() ? (
    <ConfigSupabaseScreen />
  ) : (
    <QueryClientProvider client={queryClient}>
      <SettingsProvider>
        <AppMain />
      </SettingsProvider>
    </QueryClientProvider>
  );

const App: React.FC = () => <AppContent />;

export default App;
