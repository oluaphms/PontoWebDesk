import React, { memo, useCallback, useState, useEffect } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { User } from '../types';
import { Bell, Search, Sun, Moon, BrainCircuit } from 'lucide-react';
import NotificationCenter from './NotificationCenter';
import { NotificationService } from '../services/notificationService';
import { ThemeService } from '../services/themeService';
import { AppSidebar, AppSidebarNavContent } from '../src/components/layout';
import { getMenuItemsForUser } from '../src/config/menuItems';
import { MobileDrawer, MenuToggleButton } from '../src/components/navigation';
import { i18n } from '../lib/i18n';
import AdminSidebar from '../src/components/AdminSidebar';
import EmployeeSidebar from '../src/components/EmployeeSidebar';

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
  const location = useLocation();
  const navigate = useNavigate();
  const [theme, setTheme] = useState<'light' | 'dark' | 'auto'>(user.preferences?.theme || 'auto');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [isDesktop, setIsDesktop] = useState(typeof window !== 'undefined' && window.innerWidth >= 1024);

  const isAdminRoutes = location.pathname.startsWith('/admin');
  const isEmployeeRoutes = location.pathname.startsWith('/employee');
  const useAdminSidebar = layoutVariant === 'admin' || isAdminRoutes;
  const useEmployeeSidebar = layoutVariant === 'employee' || isEmployeeRoutes;

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

  const sidebar = useAdminSidebar ? (
    <AdminSidebar user={user} onLogout={onLogout} onCollapsedChange={setSidebarCollapsed} />
  ) : useEmployeeSidebar ? (
    <EmployeeSidebar user={user} onLogout={onLogout} onCollapsedChange={setSidebarCollapsed} />
  ) : (
    <AppSidebar user={user} onLogout={onLogout} onCollapsedChange={setSidebarCollapsed} />
  );

  const mobileNavContent = useAdminSidebar ? (
    <nav className="flex flex-col gap-1 py-2">
      {[
        { label: 'Dashboard', path: '/admin/dashboard' },
        { label: 'Funcionários', path: '/admin/employees' },
        { label: 'Departamentos', path: '/admin/departments' },
        { label: 'Cargos', path: '/admin/job-titles' },
        { label: 'Espelho de Ponto', path: '/admin/timesheet' },
        { label: 'Monitoramento', path: '/admin/monitoring' },
        { label: 'Escalas', path: '/admin/schedules' },
        { label: 'Horários', path: '/admin/shifts' },
        { label: 'Empresa', path: '/admin/company' },
        { label: 'Relatórios', path: '/admin/reports' },
        { label: 'Configurações', path: '/admin/settings' },
      ].map((item) => (
        <Link
          key={item.path}
          to={item.path}
          onClick={() => setIsMobileMenuOpen(false)}
          className={`block w-full text-left px-4 py-3 rounded-xl font-medium no-underline ${location.pathname === item.path ? 'bg-indigo-600 text-white' : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'}`}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  ) : useEmployeeSidebar ? (
    <nav className="flex flex-col gap-1 py-2">
      {[
        { label: 'Dashboard', path: '/employee/dashboard' },
        { label: 'Registrar Ponto', path: '/employee/clock' },
        { label: 'Espelho de Ponto', path: '/employee/timesheet' },
        { label: 'Mapa em tempo real', path: '/employee/monitoring' },
        { label: 'Banco de Horas', path: '/employee/time-balance' },
        { label: 'Perfil', path: '/employee/profile' },
        { label: 'Configurações', path: '/employee/settings' },
      ].map((item) => (
        <Link
          key={item.path}
          to={item.path}
          onClick={() => setIsMobileMenuOpen(false)}
          className={`block w-full text-left px-4 py-3 rounded-xl font-medium no-underline ${location.pathname === item.path ? 'bg-emerald-600 text-white' : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'}`}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  ) : (
    <AppSidebarNavContent items={getMenuItemsForUser(user)} onItemClick={() => setIsMobileMenuOpen(false)} />
  );

  return (
    <div className="flex h-screen overflow-hidden bg-transparent">
      {sidebar}

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
                placeholder={i18n.t('layout.searchPlaceholder')}
                aria-label="Campo de pesquisa"
                className="w-full pl-10 pr-4 py-2.5 bg-slate-100 dark:bg-slate-800 border-none rounded-xl text-sm outline-none focus:ring-4 focus:ring-indigo-100 dark:focus:ring-indigo-900/30 transition-all text-slate-900 dark:text-white"
              />
            </div>
          </div>

          <div className="flex items-center gap-2 lg:gap-4">
            <button
              onClick={toggleTheme}
              className="p-2.5 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-all"
              aria-label={theme === 'light' ? i18n.t('layout.ariaThemeLight') : theme === 'dark' ? i18n.t('layout.ariaThemeDark') : i18n.t('layout.ariaThemeAuto')}
              title={theme === 'light' ? i18n.t('layout.themeLight') : theme === 'dark' ? i18n.t('layout.themeDark') : i18n.t('layout.themeAuto')}
            >
              {theme === 'light' ? <Sun size={20} /> : theme === 'dark' ? <Moon size={20} /> : <BrainCircuit size={20} />}
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
                  <NotificationCenter userId={user.id} onClose={() => setShowNotifications(false)} />
                </div>
              )}
            </div>
            <div className="w-px h-6 bg-slate-200 dark:bg-slate-700 mx-1 hidden sm:block" aria-hidden="true" />
            <div className="hidden sm:flex items-center gap-3 ml-2">
              <div className="text-right">
                <p className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest leading-none mb-1">{i18n.t('layout.activeCompany')}</p>
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
        aria-label={i18n.t('layout.mobileNavLabel')}
      >
        {mobileNavContent}
        <div className="pt-6 mt-6 border-t border-slate-100 dark:border-slate-800">
          <button
            type="button"
            onClick={() => {
              setIsMobileMenuOpen(false);
              onLogout();
            }}
            className="w-full flex items-center justify-center gap-2 py-3 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 font-bold rounded-xl transition-all"
            aria-label={i18n.t('layout.logoutApp')}
          >
            {i18n.t('layout.logoutApp')}
          </button>
        </div>
      </MobileDrawer>
    </div>
  );
};

export default memo(Layout);
