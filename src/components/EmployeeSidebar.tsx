import React, { memo, useState, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  Clock,
  CalendarDays,
  Scale,
  MapPin,
  User as UserIcon,
  Settings,
  LogOut,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import type { User } from '../../types';
import { prefetchPortalRoute } from '../routes/routeChunks';

const SIDEBAR_WIDTH_EXPANDED = 240;
const SIDEBAR_WIDTH_COLLAPSED = 72;

const EMPLOYEE_ITEMS = [
  { label: 'Dashboard', path: '/employee/dashboard', icon: LayoutDashboard },
  { label: 'Registrar Ponto', path: '/employee/clock', icon: Clock },
  { label: 'Espelho de Ponto', path: '/employee/timesheet', icon: CalendarDays },
  { label: 'Mapa em tempo real', path: '/employee/monitoring', icon: MapPin },
  { label: 'Banco de Horas', path: '/employee/time-balance', icon: Scale },
  { label: 'Perfil', path: '/employee/profile', icon: UserIcon },
  { label: 'Configurações', path: '/employee/settings', icon: Settings },
];

export interface EmployeeSidebarProps {
  user: User;
  onLogout: () => void;
  onCollapsedChange?: (collapsed: boolean) => void;
}

const EmployeeSidebar: React.FC<EmployeeSidebarProps> = ({ user, onLogout, onCollapsedChange }) => {
  const [collapsed, setCollapsed] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  const handleToggle = useCallback(() => {
    setCollapsed((c) => {
      const next = !c;
      onCollapsedChange?.(next);
      return next;
    });
  }, [onCollapsedChange]);

  return (
    <aside
      className="fixed left-0 top-0 bottom-0 z-30 hidden lg:flex flex-col bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl border-r border-slate-200/80 dark:border-slate-800/80 transition-[width] duration-300 ease-in-out overflow-hidden"
      style={{
        width: collapsed ? SIDEBAR_WIDTH_COLLAPSED : SIDEBAR_WIDTH_EXPANDED,
        boxShadow: '4px 0 24px rgba(0,0,0,0.06)',
      }}
      aria-label="Menu funcionário"
    >
      <div className="flex flex-col flex-1 min-h-0 p-3">
        <div
          className={`flex items-center gap-3 ${collapsed ? 'justify-center px-0' : 'px-2'} pb-4 border-b border-slate-100 dark:border-slate-800`}
        >
          <div className="transition-transform duration-300 hover:scale-105 filter drop-shadow-[0_0_6px_rgba(139,92,246,0.3)]">
            <img
              src="/play_store_512.png"
              alt="PontoWebDesk"
              width={collapsed ? 40 : 48}
              height={collapsed ? 40 : 48}
              className="w-[40px] h-[40px] lg:w-[48px] lg:h-[48px] object-contain"
            />
          </div>
          {!collapsed && (
            <div className="min-w-0">
              <span className="text-lg font-bold text-slate-900 dark:text-white tracking-tight block truncate">
                SmartPonto
              </span>
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                Funcionário
              </span>
            </div>
          )}
        </div>

        <nav className="mt-4 flex-1 overflow-y-auto min-h-0 flex flex-col gap-1 py-2">
          {EMPLOYEE_ITEMS.map((item) => {
            const isActive = location.pathname === item.path;
            const Icon = item.icon;
            return (
              <button
                key={item.path}
                type="button"
                onClick={() => navigate(item.path)}
                onMouseEnter={() => prefetchPortalRoute(item.path)}
                onFocus={() => prefetchPortalRoute(item.path)}
                className={`
                  group relative flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium transition-all
                  ${collapsed ? 'justify-center px-2' : ''}
                  ${isActive
                    ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-600/25'
                    : 'text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white'
                  }
                `}
                title={collapsed ? item.label : undefined}
              >
                {isActive && (
                  <span className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-8 bg-white rounded-r-full opacity-90" />
                )}
                <Icon className="w-5 h-5 shrink-0" />
                {!collapsed && <span className="flex-1 truncate">{item.label}</span>}
              </button>
            );
          })}
        </nav>

        <div
          className={`pt-4 mt-auto border-t border-slate-100 dark:border-slate-800 ${collapsed ? 'px-0' : 'px-2'}`}
        >
          <div
            className={`rounded-2xl border border-slate-100 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-800/50 p-3 ${collapsed ? 'flex flex-col items-center' : ''}`}
          >
            {!collapsed && (
              <div className="flex items-center gap-3 mb-3">
                <div className="w-9 h-9 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center text-emerald-600 dark:text-emerald-400 font-bold border-2 border-white dark:border-slate-700 shrink-0">
                  {user.nome.charAt(0)}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-slate-900 dark:text-white truncate">{user.nome}</p>
                  <p className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase truncate">
                    {user.cargo}
                  </p>
                </div>
              </div>
            )}
            {collapsed && (
              <div className="w-9 h-9 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center text-emerald-600 dark:text-emerald-400 font-bold border-2 border-white dark:border-slate-700 mx-auto mb-2">
                {user.nome.charAt(0)}
              </div>
            )}
            <button
              type="button"
              onClick={onLogout}
              className={`w-full flex items-center justify-center gap-2 py-2.5 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-xl transition-all text-xs font-bold ${collapsed ? 'px-0' : ''}`}
            >
              <LogOut className="w-4 h-4 shrink-0" />
              {!collapsed && <span>Sair</span>}
            </button>
          </div>
        </div>

        <button
          type="button"
          onClick={handleToggle}
          className="mt-2 flex items-center justify-center w-full py-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
          aria-label={collapsed ? 'Expandir menu' : 'Recolher menu'}
        >
          {collapsed ? <ChevronRight className="w-5 h-5" /> : <ChevronLeft className="w-5 h-5" />}
        </button>
      </div>
    </aside>
  );
};

export default memo(EmployeeSidebar);
