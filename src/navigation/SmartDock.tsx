import React, { memo, useCallback, useRef, useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Loader2 } from 'lucide-react';
import { useLanguage } from '../contexts/LanguageContext';
import { i18n } from '../../lib/i18n';
import { useSmartNavigation } from './useSmartNavigation';
import { getNavIcon } from './iconMap';

const LONG_PRESS_MS = 500;
const CARD_MARGIN = 12;
const CARD_MAX_WIDTH = 280;

const SmartDock: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  useLanguage();
  const { user, groups, dockFloatingGroupKey, openDockGroup, setRadialOpen, onLogout } = useSmartNavigation();
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const segmentRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [cardStyle, setCardStyle] = useState<{ left: number; bottom: number; width: number } | null>(null);
  const [logoutBusy, setLogoutBusy] = useState(false);

  const dockEntries = Object.entries(groups);
  const openGroup = dockFloatingGroupKey ? groups[dockFloatingGroupKey] : null;

  /** Esconde o rodapé quando algum modal/dialog está aberto para não sobrepor botões */
  const [modalOpen, setModalOpen] = useState(false);
  useEffect(() => {
    const check = () => {
      const hasDialog = !!document.querySelector('[role="dialog"], [aria-modal="true"]');
      setModalOpen(hasDialog);
    };
    const obs = new MutationObserver(() => check());
    obs.observe(document.body, { childList: true, subtree: true });
    check();
    return () => obs.disconnect();
  }, []);

  /** Calcula posição do card para ficar centralizado no botão e dentro da viewport */
  const updateCardPosition = useCallback(() => {
    if (!dockFloatingGroupKey || !openGroup) {
      setCardStyle(null);
      return;
    }
    const idx = dockEntries.findIndex(([k]) => k === dockFloatingGroupKey);
    const el = segmentRefs.current[idx];
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const cardWidth = Math.min(CARD_MAX_WIDTH, window.innerWidth - CARD_MARGIN * 2);
    const centerX = rect.left + rect.width / 2;
    let left = centerX - cardWidth / 2;
    if (left < CARD_MARGIN) left = CARD_MARGIN;
    if (left + cardWidth > window.innerWidth - CARD_MARGIN) left = window.innerWidth - cardWidth - CARD_MARGIN;
    setCardStyle({
      left,
      bottom: window.innerHeight - rect.top + 8,
      width: cardWidth,
    });
  }, [dockFloatingGroupKey, openGroup, dockEntries]);

  useEffect(() => {
    if (!dockFloatingGroupKey || !openGroup) {
      setCardStyle(null);
      return;
    }
    const t = requestAnimationFrame(updateCardPosition);
    const onResize = () => requestAnimationFrame(updateCardPosition);
    window.addEventListener('resize', onResize);
    return () => {
      cancelAnimationFrame(t);
      window.removeEventListener('resize', onResize);
    };
  }, [dockFloatingGroupKey, openGroup, updateCardPosition]);

  const handleItemClick = useCallback(
    (path: string) => {
      let targetPath = path;
      const isAdminOrHr = user?.role === 'admin' || user?.role === 'hr';
      // Fallback defensivo: garante Banco de Horas correto por perfil.
      if (path === '/time-balance') {
        targetPath = isAdminOrHr ? '/admin/bank-hours' : '/employee/time-balance';
      } else if (path === '/employee/time-balance' && isAdminOrHr) {
        targetPath = '/admin/bank-hours';
      } else if (path === '/admin/bank-hours' && !isAdminOrHr) {
        targetPath = '/employee/time-balance';
      }
      navigate(targetPath);
      openDockGroup(null);
    },
    [navigate, openDockGroup, user?.role]
  );

  /** Dashboard: navega direto para a página, sem abrir submenu */
  const handleDashboardClick = useCallback(() => {
    const dashboardGroup = groups.dashboard;
    const firstPath = dashboardGroup?.items[0]?.path;
    if (firstPath) navigate(firstPath);
  }, [groups.dashboard, navigate]);

  const handleSmartPointerDown = useCallback(() => {
    longPressTimer.current = setTimeout(() => {
      longPressTimer.current = null;
      openDockGroup(null);
      setRadialOpen(true);
    }, LONG_PRESS_MS);
  }, [openDockGroup, setRadialOpen]);

  const handleSmartPointerUp = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }, []);

  const handleSmartClick = useCallback(
    (groupKey: string) => {
      if (longPressTimer.current) return;
      openDockGroup(dockFloatingGroupKey === groupKey ? null : groupKey);
    },
    [dockFloatingGroupKey, openDockGroup]
  );

  /** Para grupos com submenu (não-dashboard): abre/fecha o card acima do botão */
  const handleDockButtonClick = useCallback(
    (groupKey: string) => {
      if (groupKey === 'dashboard') {
        handleDashboardClick();
        return;
      }
      if (groupKey === 'smart') {
        handleSmartClick(groupKey);
        return;
      }
      openDockGroup(dockFloatingGroupKey === groupKey ? null : groupKey);
    },
    [handleDashboardClick, handleSmartClick, dockFloatingGroupKey, openDockGroup]
  );

  return (
    <>
      <nav
        className={`fixed bottom-0 left-0 right-0 z-40 flex items-center backdrop-blur-xl bg-white/80 dark:bg-slate-900/80 border-t border-slate-200/80 dark:border-slate-800/80 safe-area-pb py-2 lg:py-3 lg:left-1/2 lg:right-auto lg:bottom-6 lg:-translate-x-1/2 lg:rounded-2xl lg:border lg:border-slate-200/80 dark:lg:border-slate-800/80 lg:shadow-xl lg:max-w-2xl lg:w-full transition-transform duration-200 ease-out ${modalOpen ? 'translate-y-full opacity-0 pointer-events-none' : ''}`}
        aria-label={i18n.t('layout.navLabel')}
        aria-hidden={modalOpen}
      >
        <div className="flex justify-between items-center w-full px-2 sm:px-4 gap-1">
          {dockEntries.map(([groupKey, group], index) => {
            const Icon = getNavIcon(group.icon);
            const isOpen = dockFloatingGroupKey === groupKey;
            const label = i18n.t(group.labelKey);
            const isSmart = groupKey === 'smart';

            return (
              <div
                key={groupKey}
                ref={(el) => { segmentRefs.current[index] = el; }}
                className="relative flex-1 flex justify-center items-center min-w-0"
              >
                <motion.button
                  type="button"
                  onClick={() => (isSmart ? handleSmartClick(groupKey) : handleDockButtonClick(groupKey))}
                  onPointerDown={isSmart ? handleSmartPointerDown : undefined}
                  onPointerUp={isSmart ? handleSmartPointerUp : undefined}
                  onPointerLeave={isSmart ? handleSmartPointerUp : undefined}
                  className={`
                    flex flex-col items-center justify-center min-w-[48px] sm:min-w-[56px] lg:min-w-[64px] py-2 px-1 sm:px-2 rounded-2xl
                    transition-colors outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900
                    ${isOpen ? 'bg-indigo-100 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-400' : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white'}
                  `}
                  aria-label={label}
                  aria-expanded={isOpen}
                  whileHover={{ scale: 1.08 }}
                  whileTap={{ scale: 0.96 }}
                  transition={{ type: 'spring', stiffness: 400, damping: 17 }}
                >
                  <Icon size={24} className="shrink-0" aria-hidden />
                  <span className="text-[10px] font-medium mt-1 truncate max-w-full hidden sm:block">
                    {label}
                  </span>
                </motion.button>
              </div>
            );
          })}
        </div>
      </nav>

      {/* Portal no body: fixed dentro de <nav> com transform (ex.: lg:-translate-x-1/2) quebrava posição em produção */}
      {typeof document !== 'undefined' &&
        openGroup &&
        dockFloatingGroupKey &&
        dockFloatingGroupKey !== 'dashboard' &&
        cardStyle &&
        createPortal(
          <AnimatePresence>
            <motion.div
              key="dock-backdrop"
              className="fixed inset-0 z-[90]"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              onClick={() => openDockGroup(null)}
              aria-hidden
            />
            <motion.div
              key="dock-menu"
              className="fixed z-[100] px-4 py-3 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl pointer-events-auto overflow-hidden"
              style={{ left: cardStyle.left, bottom: cardStyle.bottom, width: cardStyle.width }}
              initial={{ opacity: 0, y: 8, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.96 }}
              transition={{ type: 'spring', stiffness: 400, damping: 30 }}
              role="menu"
              aria-label={i18n.t(openGroup.labelKey)}
            >
              <AnimatePresence>
                {logoutBusy && (
                  <motion.div
                    key="logout-overlay"
                    role="status"
                    aria-live="polite"
                    aria-busy="true"
                    className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 rounded-2xl bg-white/95 dark:bg-slate-900/95 backdrop-blur-sm px-4"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.2 }}
                  >
                    <Loader2 className="h-9 w-9 text-indigo-600 dark:text-indigo-400 animate-spin" aria-hidden />
                    <p className="text-sm font-semibold text-center text-slate-700 dark:text-slate-200">
                      {i18n.t('layout.loggingOut')}
                    </p>
                  </motion.div>
                )}
              </AnimatePresence>
              <p className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider px-2 pb-2 border-b border-slate-100 dark:border-slate-800 mb-2">
                {i18n.t(openGroup.labelKey)}
              </p>
              <div className={`flex flex-col gap-0.5 max-h-[min(60vh,320px)] overflow-y-auto ${logoutBusy ? 'pointer-events-none opacity-60' : ''}`}>
                {openGroup.items.map((item) => {
                  const isActive = location.pathname === item.path;
                  return (
                    <button
                      key={item.path}
                      type="button"
                      onClick={() => handleItemClick(item.path)}
                      disabled={logoutBusy}
                      className={`
                        flex items-center gap-3 w-full rounded-xl px-3 py-2.5 text-left text-sm font-medium transition-colors
                        ${isActive ? 'bg-indigo-600 text-white' : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'}
                        disabled:opacity-50 disabled:cursor-not-allowed
                      `}
                      role="menuitem"
                    >
                      {i18n.t(item.nameKey)}
                    </button>
                  );
                })}
                {dockFloatingGroupKey === 'smart' && onLogout && (
                  <motion.button
                    type="button"
                    disabled={logoutBusy}
                    onClick={async () => {
                      if (logoutBusy) return;
                      setLogoutBusy(true);
                      try {
                        await Promise.resolve(onLogout());
                      } catch (e) {
                        console.error(e);
                        setLogoutBusy(false);
                      }
                    }}
                    className="flex items-center gap-3 w-full rounded-xl px-3 py-2.5 text-left text-sm font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors border-t border-slate-100 dark:border-slate-800 mt-2 pt-2 disabled:opacity-70 disabled:cursor-wait"
                    role="menuitem"
                    whileTap={logoutBusy ? undefined : { scale: 0.98 }}
                    transition={{ type: 'spring', stiffness: 500, damping: 28 }}
                  >
                    {i18n.t('layout.logout')}
                  </motion.button>
                )}
              </div>
            </motion.div>
          </AnimatePresence>,
          document.body
        )}
    </>
  );
};

export default memo(SmartDock);
