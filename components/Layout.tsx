import React, { memo, useCallback, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { User } from '../types';
import { Bell, Search, Sun, Moon } from 'lucide-react';
import NotificationCenter from './NotificationCenter';
import { NotificationService } from '../services/notificationService';
import { ThemeService } from '../services/themeService';
import { i18n } from '../lib/i18n';
import {
  SmartNavigationProvider,
  SmartDock,
  RadialMenu,
  CommandPalette,
} from '../src/navigation';

/** Cabeçalho: apenas título + busca — sem BrandLogo (evita favicon duplicado; logo nas sidebars). */

export type LayoutVariant = 'admin' | 'employee';

interface LayoutProps {
  user: User;
  children: React.ReactNode;
  activeTab: string;
  setActiveTab: (tab: string) => void;
  onLogout: () => void | Promise<void>;
  layoutVariant?: LayoutVariant;
}

const Layout: React.FC<LayoutProps> = ({ user, children, activeTab, setActiveTab, onLogout, layoutVariant }) => {
  const navigate = useNavigate();
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const saved = user?.preferences?.theme;
    if (saved === 'light' || saved === 'dark') return saved;
    return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });
  const [showNotifications, setShowNotifications] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    ThemeService.init();
    const saved = user?.preferences?.theme;
    const resolved = saved === 'light' || saved === 'dark' ? saved : (typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    ThemeService.applyTheme(resolved ?? 'light');
    setTheme(resolved ?? 'light');
  }, [user?.preferences?.theme]);

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
    const nextTheme = theme === 'light' ? 'dark' : 'light';
    setTheme(nextTheme);
    ThemeService.applyTheme(nextTheme);
  }, [theme]);

  return (
    <SmartNavigationProvider user={user} onLogout={onLogout}>
      <div className="flex h-screen overflow-hidden bg-transparent print:h-auto print:overflow-visible">
        <div className="flex-1 flex flex-col min-w-0 bg-transparent relative print:h-auto print:overflow-visible">
          <header className="print:hidden h-16 lg:h-20 bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border-b border-slate-200 dark:border-slate-800 flex items-center justify-between px-4 lg:px-8 sticky top-0 z-20 transition-colors duration-300">
            <div className="flex items-center gap-2 flex-1 max-w-md">
              <span className="text-base lg:text-lg font-bold text-indigo-600 dark:text-indigo-400 shrink-0">PontoWebDesk</span>
              <div className="relative flex-1 hidden sm:block max-w-xs">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} aria-hidden="true" />
                <input
                  type="text"
                  placeholder={i18n.t('layout.searchPlaceholder')}
                  aria-label={i18n.t('layout.searchField')}
                  className="w-full pl-10 pr-4 py-2 bg-slate-100 dark:bg-slate-800 border-none rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500/30 transition-all text-slate-900 dark:text-white"
                />
              </div>
            </div>

            <div className="flex items-center gap-1 sm:gap-2">
              <button
                onClick={toggleTheme}
                className="p-2.5 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-all"
                aria-label={theme === 'light' ? i18n.t('layout.ariaThemeLight') : i18n.t('layout.ariaThemeDark')}
                title={theme === 'light' ? i18n.t('layout.themeLight') : i18n.t('layout.themeDark')}
              >
                {theme === 'light' ? <Sun size={20} /> : <Moon size={20} />}
              </button>
              <div className="relative">
                <button
                  onClick={() => setShowNotifications(!showNotifications)}
                  className="p-2.5 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-all relative"
                  aria-label={`${i18n.t('layout.notifications')}${unreadCount > 0 ? `, ${unreadCount} ${i18n.t('layout.unreadCount')}` : ''}`}
                  aria-expanded={showNotifications}
                >
                  <Bell size={20} />
                  {unreadCount > 0 && (
                    <span className="absolute top-2 right-2 w-2.5 h-2.5 bg-red-600 rounded-full border-2 border-white dark:border-slate-900" aria-label={`${unreadCount} ${i18n.t('layout.unreadCount')}`} />
                  )}
                </button>
                {showNotifications && (
                  <div className="absolute right-0 top-full mt-2 z-50">
                    <NotificationCenter
                      userId={user.id}
                      onClose={() => setShowNotifications(false)}
                      onUnreadCountChange={setUnreadCount}
                    />
                  </div>
                )}
              </div>
              <div className="w-px h-6 bg-slate-200 dark:bg-slate-700 mx-1 hidden sm:block" aria-hidden="true" />
              <button
                type="button"
                onClick={() => navigate(user?.role === 'admin' || user?.role === 'hr' ? '/profile' : '/employee/profile')}
                className="flex items-center justify-center w-8 h-8 rounded-full bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 font-bold text-sm border-2 border-white dark:border-slate-700 hover:ring-2 hover:ring-indigo-500/50 transition-all shrink-0"
                aria-label={i18n.t('layout.openProfile')}
                title={i18n.t('layout.profile')}
              >
                {(user?.nome ?? 'U').charAt(0).toUpperCase()}
              </button>
            </div>
          </header>

          <main
            id="main-content"
            tabIndex={-1}
            className="flex-1 overflow-y-auto custom-scrollbar focus:outline-none pb-24 print:overflow-visible print:h-auto print:pb-0 bg-slate-50/30 dark:bg-slate-950/40 min-h-0"
            role="main"
            aria-label={i18n.t('layout.mainContent')}
          >
            <div className="p-4 md:p-6 lg:p-10 max-w-7xl mx-auto w-full print:p-0 print:m-0 print:max-w-none min-h-full">
              {children}
            </div>
          </main>

          <div className="print:hidden shrink-0">
            <SmartDock />
          </div>

          <div className="print:hidden">
            <RadialMenu />
            <CommandPalette />
          </div>
        </div>
      </div>
    </SmartNavigationProvider>
  );
};

export default memo(Layout);
