import React, { memo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import type { LucideIcon } from 'lucide-react';
import {
  getBottomNavPrimaryItems,
  getMoreMenuItems,
  getNavigationForRole,
} from '../../config/navigation';
import type { User } from '../../../types';

const SvgMenu = ({ size = 24 }: { size?: number }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <line x1="4" x2="20" y1="12" y2="12" />
    <line x1="4" x2="20" y1="6" y2="6" />
    <line x1="4" x2="20" y1="18" y2="18" />
  </svg>
);
const SvgX = ({ size = 20 }: { size?: number }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M18 6 6 18" /><path d="m6 6 12 12" />
  </svg>
);
const SvgLogOut = ({ size = 20 }: { size?: number }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <polyline points="16 17 21 12 16 7" />
    <line x1="21" x2="9" y1="12" y2="12" />
  </svg>
);

export interface BottomNavProps {
  user: User;
  onLogout: () => void;
}

/** Renderiza ícone do item ou fallback com a inicial do label. */
function NavIcon({
  icon: Icon,
  size = 24,
  label,
}: {
  icon: LucideIcon | undefined;
  size?: number;
  label: string;
}) {
  if (Icon) {
    return <Icon size={size} aria-hidden className="shrink-0" />;
  }
  return (
    <span
      className="inline-flex items-center justify-center font-bold text-[10px] text-current shrink-0"
      style={{ width: size, height: size }}
      aria-hidden
    >
      {label.charAt(0)}
    </span>
  );
}

const BottomNav: React.FC<BottomNavProps> = ({ user, onLogout }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const primaryItems = getBottomNavPrimaryItems(user?.role ?? 'employee');
  const moreItems = getMoreMenuItems(user?.role ?? 'employee');

  return (
    <>
      <nav
        className="fixed bottom-0 left-0 right-0 z-40 lg:hidden flex items-center justify-around bg-white/95 dark:bg-slate-900/95 backdrop-blur-xl border-t border-slate-200 dark:border-slate-800 safe-area-pb"
        aria-label="Navegação principal"
      >
        {(primaryItems.length > 0 ? primaryItems : getNavigationForRole(user?.role ?? 'employee').slice(0, 4)).map((item) => {
          const isActive = location.pathname === item.path;
          const label = typeof item.name === 'string' ? item.name : String(item.name ?? '');
          return (
            <button
              key={item.path}
              type="button"
              onClick={() => navigate(item.path)}
              className={`flex flex-col items-center justify-center flex-1 py-2.5 px-2 min-w-0 gap-1 transition-colors ${
                isActive
                  ? 'text-indigo-600 dark:text-indigo-400'
                  : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
              }`}
              aria-current={isActive ? 'page' : undefined}
              aria-label={label}
            >
              <NavIcon icon={item?.icon} size={24} label={label} />
              <span className="text-[10px] font-medium truncate max-w-full">{label}</span>
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          className={`flex flex-col items-center justify-center flex-1 py-2.5 px-2 min-w-0 gap-1 transition-colors ${
            drawerOpen
              ? 'text-indigo-600 dark:text-indigo-400'
              : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
          }`}
          aria-label="Mais opções"
          aria-expanded={drawerOpen}
        >
          <SvgMenu size={24} />
          <span className="text-[10px] font-medium">Mais</span>
        </button>
      </nav>

      {/* Drawer "Mais" */}
      <AnimatePresence>
        {drawerOpen && (
          <>
            <motion.div
              className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm lg:hidden"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              onClick={() => setDrawerOpen(false)}
              aria-hidden
            />
            <motion.aside
              className="fixed bottom-0 left-0 right-0 z-50 lg:hidden rounded-t-2xl bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 shadow-2xl max-h-[70vh] flex flex-col"
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'tween', duration: 0.25, ease: 'easeOut' }}
              aria-label="Menu Mais"
            >
              <div className="flex items-center justify-between p-4 border-b border-slate-100 dark:border-slate-800">
                <h2 className="text-lg font-bold text-slate-900 dark:text-white">Mais</h2>
                <button
                  type="button"
                  onClick={() => setDrawerOpen(false)}
                  className="p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors"
                  aria-label="Fechar"
                >
                  <SvgX size={20} />
                </button>
              </div>
              <div className="overflow-y-auto flex-1 p-4 flex flex-col gap-1">
                {moreItems.map((item) => {
                  const isActive = location.pathname === item.path;
                  const label = typeof item.name === 'string' ? item.name : String(item.name ?? '');
                  return (
                    <button
                      key={item.path}
                      type="button"
                      onClick={() => {
                        navigate(item.path);
                        setDrawerOpen(false);
                      }}
                      className={`
                        flex items-center gap-3 w-full rounded-xl px-4 py-3 text-left text-sm font-medium transition-colors
                        ${
                          isActive
                            ? 'bg-indigo-600 text-white'
                            : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
                        }
                      `}
                    >
                      <NavIcon icon={item?.icon} size={20} label={label} />
                      {label}
                    </button>
                  );
                })}
              </div>
              <div className="p-4 pt-0 mt-auto border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => {
                    setDrawerOpen(false);
                    onLogout();
                  }}
                  className="flex items-center gap-3 w-full rounded-xl px-4 py-3 text-left text-sm font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors"
                  aria-label="Sair do sistema"
                >
                  <SvgLogOut size={20} />
                  Sair do sistema
                </button>
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </>
  );
};

export default memo(BottomNav);
