import React, { memo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { LogOut } from 'lucide-react';
import { getNavigationForRole } from '../../config/navigation';
import { useLanguage } from '../../contexts/LanguageContext';
import { i18n } from '../../../lib/i18n';
import type { User } from '../../../types';
import { BrandLogo } from '../../../components/BrandLogo';
import { prefetchPortalRoute } from '../../routes/routeChunks';

const DOCK_WIDTH_COLLAPSED = 72;
const DOCK_WIDTH_EXPANDED = 240;

export interface SidebarDockProps {
  user: User;
  onLogout: () => void;
}

const SidebarDock: React.FC<SidebarDockProps> = ({ user, onLogout }) => {
  const location = useLocation();
  const navigate = useNavigate();
  useLanguage(); // re-render quando idioma mudar
  const [isHovered, setIsHovered] = useState(false);
  const expanded = isHovered;
  const width = expanded ? DOCK_WIDTH_EXPANDED : DOCK_WIDTH_COLLAPSED;
  const items = getNavigationForRole(user?.role ?? 'employee', location.pathname);

  return (
    <motion.aside
      className="fixed left-0 top-0 bottom-0 z-30 hidden lg:flex flex-col bg-white/90 dark:bg-slate-900/90 backdrop-blur-xl border-r border-slate-200/80 dark:border-slate-800/80 overflow-hidden"
      initial={false}
      animate={{ width }}
      transition={{ type: 'tween', duration: 0.2, ease: 'easeInOut' }}
      style={{ boxShadow: '4px 0 24px rgba(0,0,0,0.06)' }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      aria-label={i18n.t('layout.navLabel')}
    >
      <div className="flex flex-col flex-1 min-h-0 p-3 flex-nowrap">
        {/* Logo */}
        <div
          className={`flex items-center gap-3 pb-4 border-b border-slate-100 dark:border-slate-800 ${
            expanded ? 'px-2' : 'justify-center px-0'
          }`}
        >
          <BrandLogo size="sm" className="shadow-lg" />
          <AnimatePresence>
            {expanded && (
              <motion.div
                initial={{ opacity: 0, width: 0 }}
                animate={{ opacity: 1, width: 'auto' }}
                exit={{ opacity: 0, width: 0 }}
                transition={{ duration: 0.15 }}
                className="min-w-0 overflow-hidden"
              >
                <span className="text-lg font-bold text-slate-900 dark:text-white tracking-tight block truncate">
                  SmartPonto
                </span>
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em]">
                  {user?.role === 'admin' || user?.role === 'hr' ? i18n.t('layout.roleAdmin') : i18n.t('layout.roleEmployee')}
                </span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Nav */}
        <nav className="mt-4 flex-1 overflow-y-auto min-h-0 flex flex-col gap-1 py-2 custom-scrollbar">
          {items.map((item) => {
            const isActive = location.pathname === item.path;
            const Icon = item.icon;
            return (
              <button
                key={item.path}
                type="button"
                onClick={() => navigate(item.path)}
                onMouseEnter={() => prefetchPortalRoute(item.path)}
                onFocus={() => prefetchPortalRoute(item.path)}
                title={!expanded ? i18n.t(item.nameKey) : undefined}
                className={`
                  group relative flex w-full items-center gap-3 rounded-xl px-3 py-2.5
                  text-left text-sm font-medium transition-all duration-200
                  outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900
                  ${expanded ? '' : 'justify-center px-2'}
                  ${
                    isActive
                      ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/25'
                      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white'
                  }
                `}
                aria-current={isActive ? 'page' : undefined}
              >
                {isActive && (
                  <span
                    className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-8 bg-white rounded-r-full opacity-90"
                    aria-hidden
                  />
                )}
                <Icon
                  size={22}
                  className={`shrink-0 ${isActive ? 'text-white' : 'text-slate-500 group-hover:text-slate-700 dark:text-slate-400 dark:group-hover:text-white'}`}
                  aria-hidden
                />
                <AnimatePresence>
                  {expanded && (
                    <motion.span
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.15 }}
                      className="flex-1 truncate whitespace-nowrap"
                    >
                      {i18n.t(item.nameKey)}
                    </motion.span>
                  )}
                </AnimatePresence>
              </button>
            );
          })}
        </nav>

        {/* User + Logout */}
        <div
          className={`pt-4 mt-auto border-t border-slate-100 dark:border-slate-800 ${expanded ? 'px-2' : 'px-0'}`}
        >
          <div
            className={`rounded-2xl border border-slate-100 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-800/50 p-3 ${
              expanded ? '' : 'flex flex-col items-center'
            }`}
          >
            {expanded ? (
              <div className="flex items-center gap-3 mb-3">
                <div className="w-9 h-9 rounded-full bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center text-indigo-600 dark:text-indigo-400 font-bold border-2 border-white dark:border-slate-700 shrink-0">
                  {(user?.nome ?? 'U').charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-slate-900 dark:text-white truncate">{user?.nome ?? '—'}</p>
                  <p className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider truncate">
                    {user?.cargo ?? '—'}
                  </p>
                </div>
              </div>
            ) : (
              <div className="w-9 h-9 rounded-full bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center text-indigo-600 dark:text-indigo-400 font-bold border-2 border-white dark:border-slate-700 mx-auto mb-2">
                {(user?.nome ?? 'U').charAt(0).toUpperCase()}
              </div>
            )}
            <button
              type="button"
              onClick={onLogout}
              className={`w-full flex items-center justify-center gap-2 py-2.5 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-xl transition-all text-xs font-bold focus-visible:ring-2 focus-visible:ring-red-500/50 ${
                expanded ? '' : 'px-0'
              }`}
            >
              <LogOut size={16} aria-hidden />
              {expanded && <span>{i18n.t('layout.logout')}</span>}
            </button>
          </div>
        </div>
      </div>
    </motion.aside>
  );
};

export default memo(SidebarDock);
