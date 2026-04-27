import React, { memo, useState, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { LogOut, UserCog } from 'lucide-react';
import { getMenuItemsForUser, getMenuItemName, type MenuItemConfig } from '../../config/menuItems';
import { i18n } from '../../../lib/i18n';
import { useLanguage } from '../../contexts/LanguageContext';
import type { User } from '../../../types';
import { prefetchPortalRoute } from '../../routes/routeChunks';

const SIDEBAR_WIDTH_EXPANDED = 240;
const SIDEBAR_WIDTH_COLLAPSED = 72;

export interface AppSidebarProps {
  user: User;
  onLogout: () => void;
  onCollapsedChange?: (collapsed: boolean) => void;
}

/** Conteúdo de navegação reutilizável (sidebar desktop e drawer mobile) */
export interface AppSidebarNavContentProps {
  items: MenuItemConfig[];
  collapsed?: boolean;
  onItemClick?: () => void;
}

export const AppSidebarNavContent = memo<AppSidebarNavContentProps>(function AppSidebarNavContent({
  items,
  collapsed = false,
  onItemClick,
}) {
  const location = useLocation();
  const navigate = useNavigate();
  useLanguage(); // re-render quando o idioma mudar

  return (
    <nav className="flex flex-col gap-1 py-2" aria-label={i18n.t('layout.navLabel')}>
      {items.map((item) => {
        const isActive = location.pathname === item.route;
        const name = getMenuItemName(item);
        return (
          <button
            key={item.route}
            type="button"
            onClick={() => {
              navigate(item.route);
              onItemClick?.();
            }}
            onMouseEnter={() => prefetchPortalRoute(item.route)}
            onFocus={() => prefetchPortalRoute(item.route)}
            aria-current={isActive ? 'page' : undefined}
            className={`
              group relative flex w-full items-center gap-3 rounded-xl px-3 py-2.5
              text-left text-sm font-medium transition-all duration-200
              outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900
              ${collapsed ? 'justify-center px-2' : ''}
              ${isActive
                ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/25'
                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white'
              }
            `}
            title={collapsed ? name : undefined}
          >
            {isActive && (
              <span
                className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-8 bg-white rounded-r-full opacity-90"
                aria-hidden
              />
            )}
            <span
              className={`material-icons text-[22px] select-none ${isActive ? 'text-white' : 'text-slate-500 group-hover:text-slate-700 dark:text-slate-400 dark:group-hover:text-white'}`}
              aria-hidden
            >
              {item.icon}
            </span>
            {!collapsed && <span className="flex-1 truncate">{name}</span>}
          </button>
        );
      })}
    </nav>
  );
});

const AppSidebar: React.FC<AppSidebarProps> = ({ user, onLogout, onCollapsedChange }) => {
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(false);

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
      aria-label={i18n.t('layout.navLabel')}
    >
      <div className="flex flex-col flex-1 min-h-0 p-3">
        <div className={`flex items-center gap-3 ${collapsed ? 'justify-center px-0' : 'px-2'} pb-4 border-b border-slate-100 dark:border-slate-800`}>
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
              <span className="text-lg font-bold text-slate-900 dark:text-white tracking-tight block truncate">PontoWebDesk</span>
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em]">SaaS</span>
            </div>
          )}
        </div>

        <div className="mt-4 flex-1 overflow-y-auto min-h-0 custom-scrollbar">
          <AppSidebarNavContent items={getMenuItemsForUser(user)} collapsed={collapsed} />
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
              onClick={() => navigate('/trocar-conta')}
              className={`w-full flex items-center justify-center gap-2 py-2.5 mb-1 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-500/10 rounded-xl transition-all text-xs font-bold focus-visible:ring-2 focus-visible:ring-indigo-500/50 ${collapsed ? 'px-0' : ''}`}
              title={collapsed ? i18n.t('layout.switchAccount') : undefined}
            >
              <UserCog size={16} aria-hidden /> {!collapsed && <span>{i18n.t('layout.switchAccount')}</span>}
            </button>
            <button
              type="button"
              onClick={onLogout}
              className={`w-full flex items-center justify-center gap-2 py-2.5 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-xl transition-all text-xs font-bold focus-visible:ring-2 focus-visible:ring-red-500/50 ${collapsed ? 'px-0' : ''}`}
            >
              <LogOut size={16} aria-hidden /> {!collapsed && <span>{i18n.t('layout.logout')}</span>}
            </button>
          </div>
        </div>

        <button
          type="button"
          onClick={handleToggle}
          className="mt-2 flex items-center justify-center w-full py-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
          aria-label={collapsed ? i18n.t('layout.expandMenu') : i18n.t('layout.collapseMenu')}
        >
          {collapsed ? (
            <span className="material-icons text-lg">chevron_right</span>
          ) : (
            <span className="material-icons text-lg">chevron_left</span>
          )}
        </button>
      </div>
    </aside>
  );
};

export default memo(AppSidebar);
