
import React, { useState, useEffect, useCallback, useMemo, Suspense, lazy } from 'react';
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
  ChevronRight
} from 'lucide-react';

// Lazy loading of complex views
const AdminView = lazy(() => import('./components/AdminView'));

const App: React.FC = () => {
  const [user, setUser] = useState<User | null>(null);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [insights, setInsights] = useState<{insight: string, score: number} | null>(null);
  const [punchType, setPunchType] = useState<LogType | null>(null);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [showCelebration, setShowCelebration] = useState(false);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [company, setCompany] = useState<Company | null>(null);
  
  // Login State
  const [loginStep, setLoginStep] = useState<'choice' | 'form'>('choice');
  const [loginRole, setLoginRole] = useState<'admin' | 'employee' | null>(null);
  const [loginData, setLoginData] = useState({ identifier: '', password: '' });
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  const { records, isLoading: isPunching, error, setError, addRecord } = useRecords(user?.id, user?.companyId);

  useEffect(() => {
    const initApp = async () => {
      // Tentar obter usuário do Firebase Auth
      const currentUser = await authService.getCurrentUser();
      if (currentUser) {
        setUser(currentUser);
        const comp = await PontoService.getCompany(currentUser.companyId);
        if (comp) setCompany(comp);

        const hasSeenOnboarding = localStorage.getItem(`onboarding_${currentUser.id}`);
        if (!hasSeenOnboarding) setShowOnboarding(true);
      }
      setIsInitialLoading(false);
    };
    initApp();
    
    // Observar mudanças no estado de autenticação
    const unsubscribe = authService.onAuthStateChanged((user) => {
      if (user) {
        setUser(user);
        PontoService.getCompany(user.companyId).then(comp => {
          if (comp) setCompany(comp);
        });
      } else {
        setUser(null);
        setCompany(null);
      }
    });
    
    return () => unsubscribe();
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

  const handlePunchStart = (type: LogType) => {
    setError(null);
    setPunchType(type);
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
    } catch (err) {}
  };

  const isWorking = useMemo(() => records[0]?.type === LogType.IN, [records]);

  const stats = useMemo(() => ({
    today: PontoService.calculateDailyHours(records),
    balance: "+12h 45m",
    status: isWorking ? 'Em Jornada' : 'Pausa / Descanso'
  }), [records, isWorking]);

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!loginData.identifier || !loginData.password) {
      setLoginError("Por favor, preencha todos os campos.");
      return;
    }

    setIsLoggingIn(true);
    setLoginError(null);

    try {
      // Usar autenticação real do Firebase
      const result = await authService.signInWithEmail(
        loginData.identifier.includes('@') 
          ? loginData.identifier 
          : `${loginData.identifier}@smartponto.com`,
        loginData.password
      );

      if (result.error) {
        setLoginError(result.error);
        setIsLoggingIn(false);
        return;
      }

      if (result.user) {
        setUser(result.user);
        const comp = await PontoService.getCompany(result.user.companyId);
        if (comp) setCompany(comp);
        
        setIsLoggingIn(false);
        
        if (result.user.role === 'admin') setActiveTab('admin');
        else setActiveTab('dashboard');
      }
    } catch (error: any) {
      setLoginError(error.message || 'Erro ao fazer login');
      setIsLoggingIn(false);
    }
  };

  const handleLogout = async () => {
    try {
      await authService.signOut();
    } catch (error) {
      console.error('Erro ao fazer logout:', error);
    }
    setUser(null);
    setCompany(null);
    setInsights(null);
    setLoginStep('choice');
    setLoginRole(null);
    setLoginData({ identifier: '', password: '' });
  };

  if (isInitialLoading) {
    return <div className="min-h-screen bg-slate-950 flex items-center justify-center"><LoadingState message="Protegendo sua conexão..." /></div>;
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-slate-950 overflow-hidden relative font-sans">
        {/* Decorative elements */}
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-indigo-600/10 rounded-full blur-[120px]"></div>
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-blue-600/10 rounded-full blur-[120px]"></div>

        <div className="w-full max-w-md relative z-10">
          <div className="text-center mb-10">
            <div className="inline-flex items-center justify-center w-20 h-20 bg-indigo-600 rounded-3xl text-white shadow-2xl shadow-indigo-500/40 mb-6 animate-in zoom-in duration-700">
              <Fingerprint size={40} />
            </div>
            <h1 className="text-4xl font-black text-white tracking-tight">Smart<span className="text-indigo-500">Ponto</span></h1>
            <p className="text-slate-500 text-sm mt-2 font-medium">Gestão de Ponto de Nova Geração</p>
          </div>

          <div className="bg-white/5 backdrop-blur-3xl p-2 rounded-[2.5rem] border border-white/10 shadow-2xl overflow-hidden">
            {loginStep === 'choice' ? (
              <div className="p-8 space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
                <button 
                  onClick={() => { setLoginRole('employee'); setLoginStep('form'); }}
                  className="w-full group p-6 bg-white/5 hover:bg-indigo-600 rounded-[2rem] border border-white/5 transition-all flex items-center justify-between text-left outline-none focus:ring-4 focus:ring-indigo-500/30"
                >
                  <div className="flex items-center gap-5">
                    <div className="w-12 h-12 bg-white/10 rounded-2xl flex items-center justify-center text-white group-hover:bg-white/20 transition-colors">
                      <UserIcon size={24} />
                    </div>
                    <div>
                      <p className="text-white font-bold text-lg">Acesso Funcionário</p>
                      <p className="text-slate-400 text-xs group-hover:text-indigo-100 transition-colors">Bater ponto e ver histórico</p>
                    </div>
                  </div>
                  <ChevronRight size={20} className="text-slate-600 group-hover:text-white transition-colors" />
                </button>

                <button 
                  onClick={() => { setLoginRole('admin'); setLoginStep('form'); }}
                  className="w-full group p-6 bg-white/5 hover:bg-slate-800 rounded-[2rem] border border-white/5 transition-all flex items-center justify-between text-left outline-none focus:ring-4 focus:ring-slate-500/30"
                >
                  <div className="flex items-center gap-5">
                    <div className="w-12 h-12 bg-white/10 rounded-2xl flex items-center justify-center text-white group-hover:bg-white/20 transition-colors">
                      <ShieldCheck size={24} />
                    </div>
                    <div>
                      <p className="text-white font-bold text-lg">Painel Gestor</p>
                      <p className="text-slate-400 text-xs group-hover:text-slate-200 transition-colors">Gestão de equipe e relatórios</p>
                    </div>
                  </div>
                  <ChevronRight size={20} className="text-slate-600 group-hover:text-white transition-colors" />
                </button>
              </div>
            ) : (
              <div className="p-8 animate-in fade-in slide-in-from-right-4 duration-500">
                <button 
                  onClick={() => setLoginStep('choice')}
                  className="flex items-center gap-2 text-slate-400 hover:text-white transition-colors text-[10px] font-bold uppercase tracking-widest mb-8"
                >
                  <ArrowLeft size={14} /> Voltar para seleção
                </button>

                <div className="mb-8">
                  <h2 className="text-2xl font-bold text-white">Login</h2>
                  <p className="text-slate-400 text-sm">Entre como {loginRole === 'admin' ? 'Administrador' : 'Colaborador'}</p>
                </div>

                <form onSubmit={handleLoginSubmit} className="space-y-6">
                  <div className="space-y-4">
                    <div className="relative">
                      <UserIcon className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
                      <input 
                        type="text" 
                        placeholder="Nome de usuário ou Email" 
                        value={loginData.identifier}
                        onChange={e => setLoginData({...loginData, identifier: e.target.value})}
                        className="w-full pl-12 pr-4 py-4 bg-white/5 border border-white/10 rounded-2xl text-white outline-none focus:ring-2 focus:ring-indigo-500 transition-all text-sm"
                      />
                    </div>
                    <div className="relative">
                      <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
                      <input 
                        type="password" 
                        placeholder="Senha de acesso" 
                        value={loginData.password}
                        onChange={e => setLoginData({...loginData, password: e.target.value})}
                        className="w-full pl-12 pr-4 py-4 bg-white/5 border border-white/10 rounded-2xl text-white outline-none focus:ring-2 focus:ring-indigo-500 transition-all text-sm"
                      />
                    </div>
                  </div>

                  {loginError && (
                    <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl flex items-center gap-3 text-red-500 text-xs font-bold animate-in shake">
                      <AlertTriangle size={16} /> {loginError}
                    </div>
                  )}

                  <Button 
                    type="submit" 
                    loading={isLoggingIn} 
                    className="w-full h-14 rounded-2xl text-lg shadow-xl shadow-indigo-600/20"
                  >
                    Entrar no Sistema
                  </Button>
                </form>
              </div>
            )}
          </div>
          
          <p className="text-center text-slate-600 text-[10px] font-bold uppercase tracking-widest mt-8">
            © 2024 SmartPonto Software • v1.4.0
          </p>
        </div>
      </div>
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
                  <div className="mt-1 p-2 bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 rounded-xl active-pulse"><Sparkles size={20}/></div>
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
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 mt-14">
                     {!isWorking ? (
                       <Button loading={isPunching} onClick={() => handlePunchStart(LogType.IN)} size="xl">Entrada</Button>
                     ) : (
                       <Button loading={isPunching} onClick={() => handlePunchStart(LogType.OUT)} variant="secondary" size="xl">Saída</Button>
                     )}
                     <Button disabled={isPunching || !isWorking} onClick={() => handlePunchStart(LogType.BREAK)} variant="outline" size="xl">Pausa</Button>
                  </div>
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
                        <div className={`w-14 h-14 rounded-2xl ${stat.bg} ${stat.color} flex items-center justify-center mb-6`}><stat.icon size={28}/></div>
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
                <table className="w-full text-left">
                  <thead><tr className="bg-slate-50 dark:bg-slate-800"><th className="px-10 py-6 text-[10px] font-bold text-slate-400 uppercase">Data</th><th className="px-10 py-6 text-[10px] font-bold text-slate-400 uppercase">Tipo</th><th className="px-10 py-6 text-[10px] font-bold text-slate-400 uppercase">Horário</th></tr></thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {records.slice(0, 50).map(rec => (
                      <tr key={rec.id} className="hover:bg-indigo-50/20 transition-colors">
                        <td className="px-10 py-7 font-bold">{rec.createdAt.toLocaleDateString('pt-BR')}</td>
                        <td className="px-10 py-7"><Badge color={rec.type === LogType.IN ? 'indigo' : 'slate'}>{rec.type}</Badge></td>
                        <td className="px-10 py-7 text-lg font-extrabold tabular-nums">{rec.createdAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {records.length === 0 && <div className="p-20 text-center text-slate-400 text-xs font-bold uppercase tracking-widest">Nenhum registro encontrado</div>}
             </div>
          </div>
        )}

        {activeTab === 'admin' && user.role === 'admin' && <AdminView admin={user} />}
      </Suspense>
      
      {punchType && <PunchModal user={user} type={punchType} onClose={() => setPunchType(null)} onConfirm={onConfirmPunch} />}
    </Layout>
  );
};

export default App;
