
import React, { memo, useCallback, useState, useEffect } from 'react';
import { User } from '../types';
import { 
  LayoutDashboard, 
  History, 
  LogOut, 
  ShieldCheck, 
  User as UserIcon,
  Bell,
  Search,
  Sun,
  Moon,
  Menu,
  X,
  BrainCircuit
} from 'lucide-react';
import NotificationCenter from './NotificationCenter';
import { NotificationService } from '../services/notificationService';
import { ThemeService } from '../services/themeService';
import { i18n } from '../lib/i18n';

interface LayoutProps {
  user: User;
  children: React.ReactNode;
  activeTab: string;
  setActiveTab: (tab: string) => void;
  onLogout: () => void;
}

const Layout: React.FC<LayoutProps> = ({ user, children, activeTab, setActiveTab, onLogout }) => {
  const [theme, setTheme] = React.useState<'light' | 'dark' | 'auto'>(user.preferences?.theme || 'auto');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = React.useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    ThemeService.init();
    const savedTheme = user.preferences?.theme || 'auto';
    ThemeService.applyTheme(savedTheme);
    setTheme(savedTheme);
  }, [user.preferences?.theme]);

  useEffect(() => {
    const loadUnread = async () => {
      const count = await NotificationService.getUnreadCount(user.id);
      setUnreadCount(count);
    };
    loadUnread();
    const interval = setInterval(loadUnread, 30000);
    return () => clearInterval(interval);
  }, [user.id]);

  const toggleTheme = useCallback(() => {
    const themes: ('light' | 'dark' | 'auto')[] = ['light', 'dark', 'auto'];
    const currentIndex = themes.indexOf(theme);
    const nextTheme = themes[(currentIndex + 1) % themes.length];
    setTheme(nextTheme);
    ThemeService.applyTheme(nextTheme);
  }, [theme]);

  const menuItems = React.useMemo(() => [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'history', label: 'Meu Histórico', icon: History },
    ...(user.role === 'admin' ? [
      { id: 'admin', label: 'Gestão Geral', icon: ShieldCheck }
    ] : []),
    { id: 'settings', label: 'Meu Perfil', icon: UserIcon },
  ], [user.role]);

  const handleNav = (id: string) => {
    setActiveTab(id);
    setIsMobileMenuOpen(false);
    // Move foco para o conteúdo principal após navegação no mobile
    const mainContent = document.getElementById('main-content');
    mainContent?.focus();
  };

  return (
    <div className="flex h-screen overflow-hidden bg-transparent">
      {/* Sidebar Desktop */}
      <aside 
        className="w-72 bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 flex flex-col hidden lg:flex relative z-30 transition-colors duration-300"
        aria-label="Menu Principal"
      >
        <div className="p-8 pb-10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center text-white shadow-lg shadow-indigo-500/30">
              <ShieldCheck size={24} aria-hidden="true" />
            </div>
            <div>
              <span className="text-xl font-bold text-slate-900 dark:text-white tracking-tight block">SmartPonto</span>
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em]">SaaS</span>
            </div>
          </div>
        </div>
        
        <nav className="flex-1 px-4 space-y-1 overflow-y-auto custom-scrollbar">
          {menuItems.map((item) => (
            <button
              key={item.id}
              onClick={() => handleNav(item.id)}
              aria-current={activeTab === item.id ? 'page' : undefined}
              className={`w-full flex items-center gap-3.5 px-6 py-4 rounded-2xl transition-all duration-300 outline-none focus-visible:ring-4 focus-visible:ring-indigo-500/50 ${
                activeTab === item.id 
                  ? 'bg-indigo-600 text-white shadow-xl shadow-indigo-600/20 font-semibold' 
                  : 'text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <item.icon size={20} aria-hidden="true" strokeWidth={activeTab === item.id ? 2.5 : 2} />
              <span className="text-sm">{item.label}</span>
            </button>
          ))}
        </nav>

        <div className="p-6">
          <div className="p-5 bg-slate-50 dark:bg-slate-800/50 rounded-3xl border border-slate-100 dark:border-slate-800">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center text-indigo-600 dark:text-indigo-400 font-bold border-2 border-white dark:border-slate-700">
                {user.nome.charAt(0)}
              </div>
              <div className="flex-1 overflow-hidden">
                <p className="text-sm font-bold text-slate-900 dark:text-white truncate">{user.nome}</p>
                <p className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">{user.cargo}</p>
              </div>
            </div>
            <button 
              onClick={onLogout}
              className="w-full flex items-center justify-center gap-2 py-3 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-xl transition-all text-xs font-bold focus-visible:ring-4 focus-visible:ring-red-500/50"
            >
              <LogOut size={16} aria-hidden="true" /> Sair
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content Container */}
      <div className="flex-1 flex flex-col min-w-0 bg-transparent relative">
        <header className="h-20 bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border-b border-slate-200 dark:border-slate-800 flex items-center justify-between px-6 lg:px-8 sticky top-0 z-20 transition-colors duration-300">
          <div className="lg:hidden flex items-center gap-3">
             <button 
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)} 
              className="p-2 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg"
              aria-label="Abrir menu de navegação"
              aria-expanded={isMobileMenuOpen}
             >
                <Menu size={24} />
             </button>
             <span className="text-lg font-bold text-indigo-600 dark:text-indigo-400">Chronos</span>
          </div>
          
          <div className="hidden lg:flex flex-1 max-w-md">
            <div className="relative w-full">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} aria-hidden="true" />
              <input 
                type="text" 
                placeholder="Pesquisar ponto ou colaborador..." 
                aria-label="Campo de pesquisa"
                className="w-full pl-10 pr-4 py-2.5 bg-slate-100 dark:bg-slate-800 border-none rounded-xl text-sm outline-none focus:ring-4 focus:ring-indigo-100 dark:focus:ring-indigo-900/30 transition-all text-slate-900 dark:text-white"
              />
            </div>
          </div>
          
          <div className="flex items-center gap-2 lg:gap-4">
            <button 
              onClick={toggleTheme}
              className="p-2.5 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-all"
              aria-label={theme === 'light' ? 'Ativar modo escuro' : theme === 'dark' ? 'Ativar modo automático' : 'Ativar modo claro'}
              title={theme === 'light' ? 'Modo claro' : theme === 'dark' ? 'Modo escuro' : 'Modo automático'}
            >
              {theme === 'light' ? <Sun size={20} /> : theme === 'dark' ? <Moon size={20} /> : <BrainCircuit size={20} />}
            </button>
            <div className="relative">
              <button 
                onClick={() => setShowNotifications(!showNotifications)}
                className="p-2.5 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-all relative"
                aria-label={`Ver notificações${unreadCount > 0 ? `, ${unreadCount} não lidas` : ''}`}
                aria-expanded={showNotifications}
              >
                <Bell size={20} />
                {unreadCount > 0 && (
                  <span className="absolute top-2 right-2 w-2.5 h-2.5 bg-red-600 rounded-full border-2 border-white dark:border-slate-900" aria-label={`${unreadCount} notificações não lidas`}></span>
                )}
              </button>
              {showNotifications && (
                <div className="absolute right-0 top-full mt-2 z-50">
                  <NotificationCenter userId={user.id} onClose={() => setShowNotifications(false)} />
                </div>
              )}
            </div>
            <div className="w-px h-6 bg-slate-200 dark:bg-slate-700 mx-1 hidden sm:block" aria-hidden="true"></div>
            <div className="hidden sm:flex items-center gap-3 ml-2">
              <div className="text-right">
                <p className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest leading-none mb-1">Empresa Ativa</p>
                <p className="text-xs font-bold text-indigo-600 dark:text-indigo-400">Corporação LTDA</p>
              </div>
            </div>
          </div>
        </header>

        <main id="main-content" tabIndex={-1} className="flex-1 overflow-y-auto custom-scrollbar focus:outline-none" role="main" aria-label="Conteúdo principal">
          <div className="p-4 md:p-8 lg:p-10 max-w-7xl mx-auto w-full">
            {children}
          </div>
        </main>
      </div>

      {/* Mobile Side Menu */}
      {isMobileMenuOpen && (
        <div className="fixed inset-0 z-[100] lg:hidden animate-in fade-in duration-300">
           <div 
            className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" 
            onClick={() => setIsMobileMenuOpen(false)}
            aria-hidden="true"
           ></div>
           <aside 
            className="absolute left-0 top-0 bottom-0 w-80 bg-white dark:bg-slate-900 shadow-2xl p-6 flex flex-col animate-in slide-in-from-left duration-300"
            role="dialog"
            aria-modal="true"
            aria-label="Navegação móvel"
           >
              <div className="flex items-center justify-between mb-10">
                 <div className="flex items-center gap-2">
                    <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center text-white"><ShieldCheck size={20}/></div>
                    <span className="font-bold text-xl text-slate-900 dark:text-white">SmartPonto</span>
                 </div>
                 <button 
                  onClick={() => setIsMobileMenuOpen(false)} 
                  className="p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg"
                  aria-label="Fechar menu"
                 >
                  <X size={20} />
                 </button>
              </div>
              <nav className="space-y-2 flex-1" aria-label="Menu móvel">
                 {menuItems.map((item) => (
                    <button
                       key={item.id}
                       onClick={() => handleNav(item.id)}
                       aria-current={activeTab === item.id ? 'page' : undefined}
                       className={`w-full flex items-center gap-4 px-5 py-4 rounded-2xl font-bold transition-all outline-none focus-visible:ring-4 focus-visible:ring-indigo-500/50 ${
                          activeTab === item.id ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/20' : 'text-slate-600 dark:text-slate-400'
                       }`}
                    >
                       <item.icon size={20} aria-hidden="true" />
                       {item.label}
                    </button>
                 ))}
              </nav>
              <div className="pt-6 border-t border-slate-100 dark:border-slate-800">
                 <button onClick={onLogout} className="w-full flex items-center gap-4 px-5 py-4 text-red-600 dark:text-red-400 font-bold focus-visible:ring-4 focus-visible:ring-red-500/50 rounded-xl">
                    <LogOut size={20} aria-hidden="true" /> Sair do Aplicativo
                 </button>
              </div>
           </aside>
        </div>
      )}
    </div>
  );
};

export default memo(Layout);
