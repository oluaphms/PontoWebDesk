
import React, { useState, useEffect, useCallback, useMemo, Suspense, lazy } from 'react';
import { Routes, Route, useLocation, useNavigate } from 'react-router-dom';
import { User, LogType, DailySummary, PunchMethod, Company } from './types';
import Layout from './components/Layout';
import Clock from './components/Clock';
import PunchModal from './components/PunchModal';
import Onboarding from './components/Onboarding';
import { Button, Badge, LoadingState, SuccessOverlay, Input } from './components/UI';
import { getWorkInsights } from './services/geminiService';
import { PontoService } from './services/pontoService';
import { useRecords } from './hooks/useRecords';
import { authService } from './services/authService';
import { isSupabaseConfigured } from './services/supabase';
import { validateLogin } from './lib/validationSchemas';
import ProfileView from './components/ProfileView';
import {
  requestNotificationPermission,
  startReminderCheck,
  stopReminderCheck,
  getReminderConfig,
} from './services/pushReminderService';
import { ThemeService } from './services/themeService';
import {
  Fingerprint,
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
  Monitor,
  Camera,
  Keyboard,
  MapPin,
  Eye,
  EyeOff,
} from 'lucide-react';
import { BiometricService } from './services/biometricService';
import DashboardPage from './src/pages/Dashboard';
import TimeClockPage from './src/pages/TimeClock';
import TimeRecordsPage from './src/pages/TimeRecords';
import EmployeesPage from './src/pages/Employees';
import SchedulesPage from './src/pages/Schedules';
import LocationsPage from './src/pages/Locations';
import DevicesPage from './src/pages/Devices';
import RequestsPage from './src/pages/Requests';
import AdjustmentsPage from './src/pages/Adjustments';
import VacationsPage from './src/pages/Vacations';
import AbsencesPage from './src/pages/Absences';
import TimeBalancePage from './src/pages/TimeBalance';
import DepartmentsPage from './src/pages/Departments';
import NotificationsPage from './src/pages/Notifications';
import AIChatPage from './src/pages/AIChat';
import ProductivityTrendsPage from './src/pages/ProductivityTrends';
import RealTimeInsightsPage from './src/pages/RealTimeInsights';
import AlertsPage from './src/pages/Alerts';
import TeamsPage from './src/pages/Teams';
import ScreenshotsPage from './src/pages/Screenshots';
import TimeAttendancePage from './src/pages/TimeAttendance';
import ActivitiesPage from './src/pages/Activities';
import ProjectsPage from './src/pages/Projects';
import ReportsPage from './src/pages/Reports';
import SettingsPage from './src/pages/Settings';
import ForgotPasswordModal from './src/components/auth/ForgotPasswordModal';
import ResetPasswordPage from './src/pages/ResetPassword';
import AcceptInvitePage from './src/pages/AcceptInvite';
import RoleGuard from './src/components/auth/RoleGuard';
import AdminLayout from './src/layouts/AdminLayout';
import EmployeeLayout from './src/layouts/EmployeeLayout';

// Lazy loading of complex views
const AdminView = lazy(() => import('./components/AdminView'));

function ConfigSupabaseScreen() {
  const isVercel = typeof window !== 'undefined' && /vercel\.app/i.test(window.location.hostname);
  return (
    <div className="min-h-screen gradient-bg flex flex-col items-center justify-center p-6 text-center">
      <div className="glass-card rounded-2xl p-8 max-w-lg w-full space-y-4">
        <div className="w-14 h-14 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center mx-auto">
          <Settings className="w-7 h-7 text-amber-600 dark:text-amber-400" />
        </div>
        <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">
          Supabase não configurado
        </h1>
        <p className="text-slate-600 dark:text-slate-400 text-sm">
          Configure as variáveis de ambiente para o app funcionar.
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
  const [user, setUser] = useState<User | null>(null);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [insights, setInsights] = useState<{ insight: string, score: number } | null>(null);
  const [punchType, setPunchType] = useState<LogType | null>(null);
  const [showMethodSelection, setShowMethodSelection] = useState(false);
  const [pendingPunchType, setPendingPunchType] = useState<LogType | null>(null);
  const [selectedMethod, setSelectedMethod] = useState<PunchMethod | null>(null);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [showCelebration, setShowCelebration] = useState(false);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [company, setCompany] = useState<Company | null>(null);

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

  // Theme State (para tela de login)
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('smartponto_theme');
      // Se for 'auto' ou não existir, converte para o tema do sistema
      if (saved === 'auto' || !saved || (saved !== 'light' && saved !== 'dark')) {
        const systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
        return systemTheme;
      }
      return saved as 'light' | 'dark';
    }
    return 'dark';
  });

  const { records, isLoading: isPunching, error, setError, addRecord } = useRecords(user?.id, user?.companyId);
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout>;
    let isMounted = true;

    const initApp = async () => {
      try {
        // Timeout de segurança: máximo 5 segundos para inicializar
        timeoutId = setTimeout(() => {
          if (isMounted) {
            console.warn('Initialization timeout - forcing app to load');
            setIsInitialLoading(false);
          }
        }, 5000);

        // Verificar se Supabase está configurado
        if (!isSupabaseConfigured) {
          console.warn('Supabase not configured - app will show login screen');
          if (isMounted) {
            clearTimeout(timeoutId);
            setIsInitialLoading(false);
          }
          return;
        }

        // Tentar obter usuário do Supabase Auth com timeout
        const userPromise = authService.getCurrentUser();
        const timeoutPromise = new Promise<User | null>((resolve) => {
          setTimeout(() => resolve(null), 3000);
        });

        const currentUser = await Promise.race([userPromise, timeoutPromise]).catch((error) => {
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

          const hasSeenOnboarding = localStorage.getItem(`onboarding_${currentUser.id}`);
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
    if (isSupabaseConfigured) {
      try {
        unsubscribe = authService.onAuthStateChanged((user) => {
          if (!isMounted) return;

          if (user) {
            setUser(user);
            PontoService.getCompany(user.companyId).then(comp => {
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

  const fetchInsights = useCallback(async () => {
    if (records.length >= 2 && !insights) {
      const summary: DailySummary = {
        date: new Date().toISOString(),
        totalHours: 8,
        records: records.slice(0, 10)
      };
      const result = await getWorkInsights([summary]);
      setInsights(result);
    }
  }, [records, insights]);

  useEffect(() => {
    if (activeTab === 'dashboard' && records.length > 0) {
      fetchInsights();
    }
  }, [activeTab, fetchInsights]);

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

  // Theme effect (aplicar tema quando mudar)
  useEffect(() => {
    try {
      // Aplicar tema diretamente (sem modo auto)
      if (typeof window !== 'undefined') {
        const root = document.documentElement;
        if (theme === 'dark') {
          root.classList.add('dark');
        } else {
          root.classList.remove('dark');
        }
        localStorage.setItem('smartponto_theme', theme);
      }
    } catch (error) {
      console.error('Erro ao aplicar tema:', error);
    }
  }, [theme]);

  const handlePunchStart = (type: LogType) => {
    setError(null);
    setPendingPunchType(type);

    // Se a empresa exige foto obrigatória, abrir direto o modal de foto
    // Isso é especialmente importante em dispositivos móveis para acionar a câmera imediatamente
    if (company?.settings.requirePhoto) {
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
        audio.play().catch(() => {});
      } catch {
        // silencioso se falhar
      }
    } catch (err) { }
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
    const todayRecords = records
      .filter(r => r.createdAt.toDateString() === today)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

    let totalMs = 0;
    let lastInTime: number | null = null;
    for (const rec of todayRecords) {
      if (rec.type === LogType.IN) lastInTime = rec.createdAt.getTime();
      else if (lastInTime && (rec.type === LogType.OUT || rec.type === LogType.BREAK)) {
        totalMs += rec.createdAt.getTime() - lastInTime;
        lastInTime = null;
      }
    }
    if (lastInTime) totalMs += new Date().getTime() - lastInTime;

    const workedHours = totalMs / (1000 * 60 * 60);

    const [startH, startM] = company.settings.standardHours.start.split(':').map(Number);
    const [endH, endM] = company.settings.standardHours.end.split(':').map(Number);
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
  }, [records, company, stats.today]);

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
      const rawEmail = loginData.identifier.includes('@')
        ? loginData.identifier
        : `${loginData.identifier}@smartponto.com`;
      const email = rawEmail.trim().toLowerCase();

      const loginPromise = authService.signInWithEmail(email, loginData.password);
      const LOGIN_TIMEOUT_MS = 45000; // 45 segundos
      const timeoutPromise = new Promise<{ user: any; error: string | null }>((_, reject) =>
        setTimeout(
          () =>
            reject(
              new Error(
                'Tempo esgotado. O servidor Supabase pode estar pausado (free tier) ou a rede está lenta. Abra https://supabase.com/dashboard e verifique se o projeto está ativo (Restore se pausado). Em seguida use "Limpar sessão e tentar de novo".'
              )
            ),
          LOGIN_TIMEOUT_MS
        )
      );
      let result: { user: any; error: string | null };
      try {
        result = await Promise.race([loginPromise, timeoutPromise]);
      } catch (timeoutErr: any) {
        setLoginError(timeoutErr?.message || 'Tempo esgotado. Tente novamente.');
        return;
      }

      if (result.error) {
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
          navigate('/dashboard', { replace: true });
        } else {
          setActiveTab('dashboard');
          navigate('/dashboard', { replace: true });
        }
      }
    } catch (error: any) {
      console.error('Erro no handleLoginSubmit:', error);
      setLoginError(error?.message || 'Erro ao fazer login');
    } finally {
      setIsLoggingIn(false);
    }
  };

  /** Limpa sessão e estado para tentar login de novo (útil quando 400 ou "só logou uma vez no celular"). */
  const handleClearSessionAndRetry = async () => {
    setLoginError(null);
    try {
      await authService.signOut();
    } catch {
      // ignora
    }
    try {
      localStorage.removeItem('current_user');
    } catch {
      // ignora
    }
  };

  const handleLogout = async () => {
    setUser(null);
    setCompany(null);
    setInsights(null);
    setLoginStep('choice');
    setLoginRole(null);
    setLoginData({ identifier: '', password: '' });
    try {
      await authService.signOut();
    } catch (error) {
      console.error('Erro ao fazer logout:', error);
    }
  };

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
    return theme === 'light' ? 'Modo claro' : 'Modo escuro';
  }, [theme]);

  // Timeout de segurança adicional para garantir que o loading sempre termine
  useEffect(() => {
    if (!isInitialLoading) return;

    const safetyTimeout = setTimeout(() => {
      console.error('Safety timeout triggered - forcing app to load');
      setIsInitialLoading(false);
    }, 6000);

    return () => clearTimeout(safetyTimeout);
  }, [isInitialLoading]);

  if (isInitialLoading) {
    return <div className="min-h-screen bg-slate-950 flex items-center justify-center"><LoadingState message="Protegendo sua conexão..." /></div>;
  }

  if (!user) {
    if (location.pathname === '/reset-password') return <ResetPasswordPage />;
    if (location.pathname === '/accept-invite') return <AcceptInvitePage />;
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-slate-50 dark:bg-slate-950 overflow-hidden relative font-sans transition-colors duration-300">
        {/* Botão de modo escuro - canto superior direito */}
        <button
          onClick={toggleTheme}
          className="absolute top-6 right-6 z-20 p-3 bg-slate-200 dark:bg-slate-900/10 hover:bg-slate-300 dark:hover:bg-slate-900/20 backdrop-blur-md rounded-xl border border-slate-300 dark:border-slate-800/50 transition-all group"
          aria-label={getThemeLabel()}
          title={getThemeLabel()}
        >
          <div className="text-slate-700 dark:text-white group-hover:scale-110 transition-transform">
            {getThemeIcon()}
          </div>
        </button>

        {/* Decorative elements */}
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-indigo-600/5 dark:bg-indigo-600/10 rounded-full blur-[120px]"></div>
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-blue-600/5 dark:bg-blue-600/10 rounded-full blur-[120px]"></div>

        <div className="w-full max-w-md relative z-10">
          <div className="text-center mb-10">
            <div className="inline-flex items-center justify-center w-20 h-20 bg-indigo-600 rounded-3xl text-white shadow-2xl shadow-indigo-500/40 mb-6 animate-in zoom-in duration-700">
              <Fingerprint size={40} />
            </div>
            <h1 className="text-4xl font-black text-slate-900 dark:text-white tracking-tight transition-colors">Smart<span className="text-indigo-600 dark:text-indigo-500">Ponto</span></h1>
            <p className="text-slate-600 dark:text-slate-500 text-sm mt-2 font-medium transition-colors">Gestão de Ponto de Nova Geração</p>
          </div>

          <div className="bg-white dark:bg-slate-900/50 backdrop-blur-3xl p-2 rounded-[2.5rem] border border-slate-200 dark:border-slate-800/50 shadow-2xl overflow-hidden transition-colors">
            {loginStep === 'choice' ? (
              <div className="p-8 space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
                <button
                  onClick={() => { setLoginRole('employee'); setLoginStep('form'); }}
                  className="w-full group p-6 bg-slate-50 dark:bg-white/5 hover:bg-indigo-600 dark:hover:bg-indigo-600 rounded-[2rem] border border-slate-200 dark:border-white/5 transition-all flex items-center justify-between text-left outline-none focus:ring-4 focus:ring-indigo-500/30"
                >
                  <div className="flex items-center gap-5">
                    <div className="w-12 h-12 bg-indigo-100 dark:bg-white/10 rounded-2xl flex items-center justify-center text-indigo-600 dark:text-white group-hover:bg-white/20 transition-colors">
                      <UserIcon size={24} />
                    </div>
                    <div>
                      <p className="text-slate-900 dark:text-white font-bold text-lg transition-colors group-hover:text-white">Acesso Funcionário</p>
                      <p className="text-slate-600 dark:text-slate-400 text-xs group-hover:text-indigo-100 dark:group-hover:text-indigo-100 transition-colors">Bater ponto e ver histórico</p>
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
                      <p className="text-slate-900 dark:text-white font-bold text-lg transition-colors group-hover:text-white">Painel Gestor</p>
                      <p className="text-slate-600 dark:text-slate-400 text-xs group-hover:text-slate-200 dark:group-hover:text-slate-200 transition-colors">Gestão de equipe e relatórios</p>
                    </div>
                  </div>
                  <ChevronRight size={20} className="text-slate-400 dark:text-slate-600 group-hover:text-white transition-colors" />
                </button>
              </div>
            ) : (
              <div className="p-8 animate-in fade-in slide-in-from-right-4 duration-500">
                <button
                  onClick={() => setLoginStep('choice')}
                  className="flex items-center gap-2 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors text-[10px] font-bold uppercase tracking-widest mb-8"
                >
                  <ArrowLeft size={14} /> Voltar para seleção
                </button>

                <div className="mb-8">
                  <h2 className="text-2xl font-bold text-slate-900 dark:text-white transition-colors">Login</h2>
                  <p className="text-slate-600 dark:text-slate-400 text-sm transition-colors">Entre como {loginRole === 'admin' ? 'Administrador' : 'Colaborador'}</p>
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
                        placeholder="Nome de usuário ou Email"
                        value={loginData.identifier}
                        onChange={e => setLoginData({ ...loginData, identifier: e.target.value })}
                        autoComplete="username"
                        className="w-full pl-12 pr-10 py-4 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700/50 rounded-2xl text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500 outline-none focus:ring-2 focus:ring-indigo-500 dark:focus:ring-indigo-600 transition-all text-sm"
                      />
                      <button
                        type="button"
                        onClick={() => setShowIdentifier((prev) => !prev)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
                        aria-label={showIdentifier ? 'Ocultar' : 'Mostrar'}
                      >
                        {showIdentifier ? <EyeOff size={18} /> : <Eye size={18} />}
                      </button>
                    </div>
                    <div className="relative">
                      <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
                      <input
                        type={showPassword ? 'text' : 'password'}
                        placeholder="Senha de acesso"
                        value={loginData.password}
                        onChange={e => setLoginData({ ...loginData, password: e.target.value })}
                        autoComplete="current-password"
                        className="w-full pl-12 pr-10 py-4 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700/50 rounded-2xl text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500 outline-none focus:ring-2 focus:ring-indigo-500 dark:focus:ring-indigo-600 transition-all text-sm"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((prev) => !prev)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
                        aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
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
                        Limpar sessão e tentar de novo
                      </button>
                    </div>
                  )}

                  <Button
                    type="submit"
                    loading={isLoggingIn}
                    className="w-full h-14 rounded-2xl text-lg shadow-xl shadow-indigo-600/20"
                  >
                    Entrar no Sistema
                  </Button>

                  <p className="text-center">
                    <button
                      type="button"
                      onClick={() => setShowForgotPassword(true)}
                      className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline font-medium"
                    >
                      Esqueci minha senha
                    </button>
                  </p>
                </form>

                <ForgotPasswordModal isOpen={showForgotPassword} onClose={() => setShowForgotPassword(false)} />
              </div>
            )}
          </div>

          <p className="text-center text-slate-500 dark:text-slate-400 text-[10px] font-bold uppercase tracking-widest mt-8 transition-colors">
            © 2024 SmartPonto Software • v1.4.0
          </p>
        </div>
      </div>
    );
  }

  const path = location.pathname;
  const isPortalRoute =
    path === '/dashboard' ||
    path === '/dashboard-admin' ||
    path === '/dashboard-employee' ||
    path === '/time-clock' ||
    path === '/time-records' ||
    path === '/admin' ||
    path === '/settings' ||
    path === '/employees' ||
    path === '/departments' ||
    path === '/schedules' ||
    path === '/locations' ||
    path === '/devices' ||
    path === '/requests' ||
    path === '/adjustments' ||
    path === '/vacations' ||
    path === '/absences' ||
    path === '/time-balance' ||
    path === '/notifications' ||
    path === '/ai-chat' ||
    path === '/productivity-trends' ||
    path === '/real-time-insights' ||
    path === '/alerts' ||
    path === '/teams' ||
    path === '/screenshots' ||
    path === '/time-attendance' ||
    path === '/activities' ||
    path === '/projects' ||
    path === '/reports';

  const isAdminOrHr = user.role === 'admin' || user.role === 'hr';
  const LayoutComponent = isAdminOrHr ? AdminLayout : EmployeeLayout;

  if (isPortalRoute) {
    return (
      <LayoutComponent user={user} activeTab={activeTab} setActiveTab={setActiveTab} onLogout={handleLogout}>
        <Suspense fallback={<LoadingState message="Carregando módulo inteligente..." />}>
          <Routes>
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/dashboard-admin" element={<DashboardPage />} />
            <Route path="/dashboard-employee" element={<DashboardPage />} />
            <Route path="/time-clock" element={<TimeClockPage />} />
            <Route path="/time-records" element={<TimeRecordsPage />} />
            <Route
              path="/admin"
              element={
                <RoleGuard user={user} allowedRoles={['admin', 'hr']}>
                  <AdminView admin={user} />
                </RoleGuard>
              }
            />
            <Route path="/settings" element={<SettingsPage user={user} />} />
            <Route
              path="/employees"
              element={
                <RoleGuard user={user} allowedRoles={['admin', 'hr']}>
                  <EmployeesPage />
                </RoleGuard>
              }
            />
            <Route
              path="/departments"
              element={
                <RoleGuard user={user} allowedRoles={['admin', 'hr']}>
                  <DepartmentsPage />
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
              path="/locations"
              element={
                <RoleGuard user={user} allowedRoles={['admin', 'hr']}>
                  <LocationsPage />
                </RoleGuard>
              }
            />
            <Route
              path="/devices"
              element={
                <RoleGuard user={user} allowedRoles={['admin', 'hr']}>
                  <DevicesPage />
                </RoleGuard>
              }
            />
            <Route path="/requests" element={<RequestsPage />} />
            <Route
              path="/adjustments"
              element={
                <RoleGuard user={user} allowedRoles={['admin', 'hr']}>
                  <AdjustmentsPage />
                </RoleGuard>
              }
            />
            <Route path="/vacations" element={<VacationsPage />} />
            <Route path="/absences" element={<AbsencesPage />} />
            <Route path="/time-balance" element={<TimeBalancePage />} />
            <Route path="/notifications" element={<NotificationsPage />} />
            <Route
              path="/ai-chat"
              element={
                <RoleGuard user={user} allowedRoles={['admin', 'hr']}>
                  <AIChatPage />
                </RoleGuard>
              }
            />
            <Route path="/productivity-trends" element={<ProductivityTrendsPage />} />
            <Route path="/real-time-insights" element={<RealTimeInsightsPage />} />
            <Route path="/alerts" element={<AlertsPage />} />
            <Route path="/teams" element={<TeamsPage />} />
            <Route path="/screenshots" element={<ScreenshotsPage />} />
            <Route path="/time-attendance" element={<TimeAttendancePage />} />
            <Route path="/activities" element={<ActivitiesPage />} />
            <Route path="/projects" element={<ProjectsPage />} />
            <Route path="/reports" element={<ReportsPage />} />
          </Routes>
        </Suspense>
      </LayoutComponent>
    );
  }

  return (
    <Layout user={user} activeTab={activeTab} setActiveTab={setActiveTab} onLogout={handleLogout}>
      {showOnboarding && <Onboarding onComplete={() => { localStorage.setItem(`onboarding_${user.id}`, 'true'); setShowOnboarding(false); }} />}
      <SuccessOverlay visible={showCelebration} title="Ponto Registrado" message="Sua marcação foi validada e salva com sucesso." />

      <Suspense fallback={<LoadingState message="Carregando módulo inteligente..." />}>
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
                  {company?.settings.requirePhoto && (
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

        {activeTab === 'settings' && <ProfileView user={user} />}
      </Suspense>

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
                    <Fingerprint size={24} />
                  </div>
                  <div className="text-left">
                    <p className="font-bold">Impressão Digital</p>
                    <p className="text-violet-200 text-xs">Biometria via sensor do dispositivo</p>
                  </div>
                </button>

                {/* Ponto Manual (se permitido) */}
                {company?.settings.allowManualPunch && (
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

const App: React.FC = () =>
  !isSupabaseConfigured ? <ConfigSupabaseScreen /> : <AppMain />;

export default App;
