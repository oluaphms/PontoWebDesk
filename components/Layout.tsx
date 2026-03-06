import React, { memo, useCallback, useState, useEffect } from 'react';
import { User } from '../types';
import { Bell, Search, Sun, Moon, BrainCircuit } from 'lucide-react';
import NotificationCenter from './NotificationCenter';
import { NotificationService } from '../services/notificationService';
import { ThemeService } from '../services/themeService';
import { AppSidebar, AppSidebarNavContent } from '../src/components/layout';
import { MobileDrawer, MenuToggleButton } from '../src/components/navigation';

const SIDEBAR_WIDTH_EXPANDED = 240;
const SIDEBAR_WIDTH_COLLAPSED = 72;

export type LayoutVariant = 'admin' | 'employee';

interface LayoutProps {
  user: User;
  children: React.ReactNode;
  activeTab: string;
  setActiveTab: (tab: string) => void;
  onLogout: () => void;
  layoutVariant?: LayoutVariant;
}

const Layout: React.FC<LayoutProps> = ({ user, children, activeTab, setActiveTab, onLogout, layoutVariant }) => {
  const [theme, setTheme] = useState<'light' | 'dark' | 'auto'>(user.preferences?.theme || 'auto');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [isDesktop, setIsDesktop] = useState(typeof window !== 'undefined' && window.innerWidth >= 1024);

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const handler = () => setIsDesktop(mq.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

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

  const sidebarWidth = sidebarCollapsed ? SIDEBAR_WIDTH_COLLAPSED : SIDEBAR_WIDTH_EXPANDED;

  return (
    <div className="flex h-screen overflow-hidden bg-transparent">
      <AppSidebar
        user={user}
        onLogout={onLogout}
        onCollapsedChange={setSidebarCollapsed}
      />

      <div
        className="flex-1 flex flex-col min-w-0 bg-transparent relative transition-[margin] duration-300 ease-in-out"
        style={{ marginLeft: isDesktop ? sidebarWidth : 0 }}
      >
        <header className="h-20 bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border-b border-slate-200 dark:border-slate-800 flex items-center justify-between px-6 lg:px-8 sticky top-0 z-20 transition-colors duration-300">
          <div className="lg:hidden flex items-center gap-3">
            <MenuToggleButton
              onClick={() => setIsMobileMenuOpen(true)}
              aria-expanded={isMobileMenuOpen}
            />
            <span className="text-lg font-bold text-indigo-600 dark:text-indigo-400">SmartPonto</span>
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
                  <span className="absolute top-2 right-2 w-2.5 h-2.5 bg-red-600 rounded-full border-2 border-white dark:border-slate-900" aria-label={`${unreadCount} notificações não lidas`} />
                )}
              </button>
              {showNotifications && (
                <div className="absolute right-0 top-full mt-2 z-50">
                  <NotificationCenter userId={user.id} onClose={() => setShowNotifications(false)} />
                </div>
              )}
            </div>
            <div className="w-px h-6 bg-slate-200 dark:bg-slate-700 mx-1 hidden sm:block" aria-hidden="true" />
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

      <MobileDrawer
        open={isMobileMenuOpen}
        onClose={() => setIsMobileMenuOpen(false)}
        aria-label="Navegação móvel"
      >
        <AppSidebarNavContent onItemClick={() => setIsMobileMenuOpen(false)} />
        <div className="pt-6 mt-6 border-t border-slate-100 dark:border-slate-800">
          <button
            type="button"
            onClick={() => {
              setIsMobileMenuOpen(false);
              onLogout();
            }}
            className="w-full flex items-center justify-center gap-2 py-3 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 font-bold rounded-xl transition-all"
            aria-label="Sair do aplicativo"
          >
            Sair do Aplicativo
          </button>
        </div>
      </MobileDrawer>
    </div>
  );
};

export default memo(Layout);
