import React, { memo, useState, useCallback } from 'react';
import {
  LayoutDashboard,
  History,
  ShieldCheck,
  Users,
  CalendarRange,
  MapPin,
  Cpu,
  ClipboardList,
  Clock12,
  PlaneTakeoff,
  CircleOff,
  Scale,
  Bell,
  Settings,
  ChevronLeft,
  ChevronRight,
  Building2,
  LogOut,
  Sparkles,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { User } from '../../../types';
import SidebarItem from './SidebarItem';
import SidebarGroup from './SidebarGroup';
import { useNavigationBadges } from '../../hooks/useNavigationBadges';

const SIDEBAR_WIDTH_EXPANDED = 240;
const SIDEBAR_WIDTH_COLLAPSED = 72;

export type LayoutVariant = 'admin' | 'employee';

export interface NavMenuContentProps {
  user: User;
  collapsed: boolean;
  onItemClick?: () => void;
  requestsCount: number;
  notificationsCount: number;
  layoutVariant?: LayoutVariant;
}

export const NavMenuContent: React.FC<NavMenuContentProps> = memo(function NavMenuContent({
  user,
  collapsed,
  onItemClick,
  requestsCount,
  notificationsCount,
  layoutVariant,
}) {
  const isAdmin = layoutVariant === 'admin' || user.role === 'admin' || user.role === 'hr';

  const Item = ({ path, label, icon, badge }: { path: string; label: string; icon: React.ComponentType<{ size?: number; strokeWidth?: number }>; badge?: number }) => (
    <SidebarItem
      path={path}
      label={label}
      icon={icon}
      collapsed={collapsed}
      badge={badge}
      onAfterNavigate={onItemClick}
    />
  );

  if (layoutVariant === 'employee') {
    return (
      <nav className="flex flex-col gap-6 py-4" aria-label="Menu do funcionário">
        <SidebarGroup title="Principal" collapsed={collapsed} defaultOpen>
          <Item path="/dashboard" label="Dashboard" icon={LayoutDashboard} />
          <Item path="/time-clock" label="Registrar Ponto" icon={History} />
          <Item path="/time-records" label="Meus Registros" icon={History} />
        </SidebarGroup>
        <SidebarGroup title="Solicitações" collapsed={collapsed} defaultOpen>
          <Item path="/requests" label="Solicitações" icon={ClipboardList} badge={requestsCount} />
          <Item path="/vacations" label="Férias" icon={PlaneTakeoff} />
        </SidebarGroup>
        <SidebarGroup title="Relatórios" collapsed={collapsed} defaultOpen>
          <Item path="/time-balance" label="Banco de Horas" icon={Scale} />
        </SidebarGroup>
        <SidebarGroup title="Sistema" collapsed={collapsed} defaultOpen>
          <Item path="/notifications" label="Notificações" icon={Bell} badge={notificationsCount} />
          <Item path="/settings" label="Configurações" icon={Settings} />
        </SidebarGroup>
      </nav>
    );
  }

  return (
    <nav className="flex flex-col gap-6 py-4" aria-label="Menu principal">
      <SidebarGroup title="Principal" collapsed={collapsed} defaultOpen>
        <Item path="/dashboard" label="Dashboard" icon={LayoutDashboard} />
        <Item path="/time-clock" label="Registrar Ponto" icon={History} />
        <Item path="/time-records" label="Meus Registros" icon={History} />
      </SidebarGroup>

      {isAdmin && (
        <SidebarGroup title="Gestão" collapsed={collapsed} defaultOpen>
          <Item path="/admin" label={user.role === 'admin' ? 'Painel Admin' : 'Painel RH'} icon={ShieldCheck} />
          <Item path="/employees" label="Funcionários" icon={Users} />
          <Item path="/departments" label="Departamentos" icon={Building2} />
          <Item path="/schedules" label="Escalas" icon={CalendarRange} />
          <Item path="/locations" label="Localizações" icon={MapPin} />
          <Item path="/devices" label="Dispositivos" icon={Cpu} />
        </SidebarGroup>
      )}

      <SidebarGroup title="Solicitações" collapsed={collapsed} defaultOpen>
        <Item path="/requests" label="Solicitações" icon={ClipboardList} badge={requestsCount} />
        <Item path="/adjustments" label="Ajustes de Ponto" icon={Clock12} />
        <Item path="/vacations" label="Férias" icon={PlaneTakeoff} />
        <Item path="/absences" label="Ausências" icon={CircleOff} />
      </SidebarGroup>

      <SidebarGroup title="Relatórios" collapsed={collapsed} defaultOpen>
        <Item path="/time-balance" label="Banco de Horas" icon={Scale} />
      </SidebarGroup>

      {isAdmin && (
        <SidebarGroup title="IA" collapsed={collapsed} defaultOpen>
          <Item path="/ai-chat" label="Chat com IA (RH)" icon={Sparkles} />
        </SidebarGroup>
      )}

      <SidebarGroup title="Sistema" collapsed={collapsed} defaultOpen>
        <Item path="/notifications" label="Notificações" icon={Bell} badge={notificationsCount} />
        <Item path="/settings" label="Configurações" icon={Settings} />
      </SidebarGroup>
    </nav>
  );
});

export interface SmartSidebarProps {
  user: User;
  onLogout: () => void;
  onCollapsedChange?: (collapsed: boolean) => void;
  layoutVariant?: LayoutVariant;
}

const SmartSidebar: React.FC<SmartSidebarProps> = ({ user, onLogout, onCollapsedChange, layoutVariant }) => {
  const [collapsed, setCollapsed] = useState(false);
  const navigate = useNavigate();
  const { requestsCount, notificationsCount } = useNavigationBadges(user);
  const effectiveVariant = layoutVariant ?? (user.role === 'admin' || user.role === 'hr' ? 'admin' : 'employee');

  const handleToggleCollapsed = useCallback(() => {
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
      aria-label="Menu principal"
    >
      <div className="flex flex-col flex-1 min-h-0 p-3">
        <div className={`flex items-center gap-3 ${collapsed ? 'justify-center px-0' : 'px-2'} pb-4 border-b border-slate-100 dark:border-slate-800`}>
          <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center text-white shadow-lg shadow-indigo-500/30 shrink-0">
            <ShieldCheck size={24} aria-hidden />
          </div>
          {!collapsed && (
            <div className="min-w-0">
              <span className="text-lg font-bold text-slate-900 dark:text-white tracking-tight block truncate">SmartPonto</span>
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em]">SaaS</span>
            </div>
          )}
        </div>

        <div className="mt-4 flex-1 overflow-y-auto min-h-0 custom-scrollbar">
          <div className="mb-4">
            {!collapsed ? (
              <button
                type="button"
                onClick={() => navigate('/time-clock')}
                className="flex items-center justify-center gap-2 w-full py-3 rounded-xl bg-indigo-600 text-white font-semibold text-sm shadow-lg shadow-indigo-600/25 hover:bg-indigo-700 transition-colors"
              >
                <History size={18} /> Clock Now
              </button>
            ) : (
              <button
                type="button"
                onClick={() => navigate('/time-clock')}
                title="Clock Now"
                className="flex items-center justify-center w-12 h-12 rounded-xl bg-indigo-600 text-white shadow-lg shadow-indigo-600/25 hover:bg-indigo-700 transition-colors mx-auto"
              >
                <History size={20} />
              </button>
            )}
          </div>

          <NavMenuContent
            user={user}
            collapsed={collapsed}
            layoutVariant={effectiveVariant}
            requestsCount={requestsCount}
            notificationsCount={notificationsCount}
          />
        </div>

        <div className={`pt-4 mt-auto border-t border-slate-100 dark:border-slate-800 ${collapsed ? 'px-0' : 'px-2'}`}>
          <div className={`rounded-2xl border border-slate-100 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-800/50 p-3 ${collapsed ? 'flex flex-col items-center' : ''}`}>
            {!collapsed && (
              <div className="flex items-center gap-3 mb-3">
                <div className="w-9 h-9 rounded-full bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center text-indigo-600 dark:text-indigo-400 font-bold border-2 border-white dark:border-slate-700 shrink-0">
                  {user.nome.charAt(0)}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-slate-900 dark:text-white truncate">{user.nome}</p>
                  <p className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider truncate">{user.cargo}</p>
                </div>
              </div>
            )}
            {collapsed && (
              <div className="w-9 h-9 rounded-full bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center text-indigo-600 dark:text-indigo-400 font-bold border-2 border-white dark:border-slate-700 mx-auto mb-2">
                {user.nome.charAt(0)}
              </div>
            )}
            <button
              type="button"
              onClick={onLogout}
              className={`w-full flex items-center justify-center gap-2 py-2.5 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-xl transition-all text-xs font-bold focus-visible:ring-2 focus-visible:ring-red-500/50 ${collapsed ? 'px-0' : ''}`}
            >
              <LogOut size={16} aria-hidden /> {!collapsed && <span>Sair</span>}
            </button>
          </div>
        </div>

        <button
          type="button"
          onClick={handleToggleCollapsed}
          className="mt-2 flex items-center justify-center w-full py-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
          aria-label={collapsed ? 'Expandir menu' : 'Recolher menu'}
        >
          {collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
        </button>
      </div>
    </aside>
  );
};

export default memo(SmartSidebar);
