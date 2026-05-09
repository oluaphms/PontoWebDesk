import React, { memo, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useLanguage } from '../contexts/LanguageContext';
import { i18n } from '../../lib/i18n';
import { useSmartNavigationSelector } from './useSmartNavigation';
import { getNavIcon } from './iconMap';

const RADIUS = 140;
const CENTER_SIZE = 56;

const RadialMenu: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  useLanguage();
  const radialOpen = useSmartNavigationSelector((s) => s.radialOpen);
  const setRadialOpen = useSmartNavigationSelector((s) => s.setRadialOpen);
  const flatItems = useSmartNavigationSelector((s) => s.flatItems);
  const groups = useSmartNavigationSelector((s) => s.groups);

  const handleSelect = useCallback(
    (path: string) => {
      navigate(path);
      setRadialOpen(false);
    },
    [navigate, setRadialOpen]
  );

  const totalItems = flatItems.length;
  if (totalItems === 0) return null;

  return (
    <AnimatePresence>
      {radialOpen && (
        <>
          <motion.div
            className="fixed inset-0 z-[60] bg-slate-900/70 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={() => setRadialOpen(false)}
            aria-hidden
          />
          <motion.div
            className="fixed inset-0 z-[61] flex items-center justify-center pointer-events-none"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            aria-label={i18n.t('nav.radialHint')}
          >
            <div className="relative w-[320px] h-[320px] pointer-events-auto">
              {/* Centro: botão fechar */}
              <motion.button
                type="button"
                onClick={() => setRadialOpen(false)}
                className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-14 h-14 rounded-full bg-indigo-600 dark:bg-indigo-500 text-white shadow-xl flex items-center justify-center font-bold text-lg z-10 outline-none focus-visible:ring-2 focus-visible:ring-white"
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                exit={{ scale: 0 }}
                transition={{ type: 'spring', stiffness: 400, damping: 25 }}
                aria-label={i18n.t('nav.close')}
              >
                ✕
              </motion.button>

              {/* Itens radiais */}
              {flatItems.map((item, index) => {
                const angle = (index / totalItems) * 360 - 90;
                const isActive = location.pathname === item.path;
                const group = Object.values(groups).find((g) => g.items.some((i) => i.path === item.path));
                const Icon = group ? getNavIcon(group.icon) : getNavIcon('zap');

                return (
                  <motion.button
                    key={item.path}
                    type="button"
                    onClick={() => handleSelect(item.path)}
                    className="absolute left-1/2 top-1/2 flex flex-col items-center justify-center w-12 h-12 -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-white dark:bg-slate-800 border-2 border-slate-200 dark:border-slate-700 shadow-lg text-slate-700 dark:text-slate-200 hover:border-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 focus-visible:ring-2 focus-visible:ring-indigo-500 outline-none"
                    style={{
                      transform: `rotate(${angle}deg) translate(${RADIUS}px) rotate(${-angle}deg)`,
                    }}
                    initial={{ scale: 0, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0, opacity: 0 }}
                    transition={{
                      type: 'spring',
                      stiffness: 400,
                      damping: 25,
                      delay: index * 0.02,
                    }}
                    whileHover={{ scale: 1.15 }}
                    whileTap={{ scale: 0.95 }}
                    aria-label={i18n.t(item.nameKey)}
                  >
                    <Icon size={22} className="shrink-0" aria-hidden />
                    <span className="text-[9px] font-medium mt-0.5 truncate max-w-[64px] text-center leading-tight hidden sm:block">
                      {i18n.t(item.nameKey)}
                    </span>
                  </motion.button>
                );
              })}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};

export default memo(RadialMenu);
