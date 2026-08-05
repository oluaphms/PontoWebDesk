import React, { memo, useEffect, useCallback, useState, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useLanguage } from '../contexts/LanguageContext';
import { i18n } from '../../lib/i18n';
import { useSmartNavigationSelector } from './useSmartNavigation';
import { getNavIcon } from './iconMap';
import type { NavigationItemSchema } from './navigationSchema';

const CommandPalette: React.FC = () => {
  const navigate = useNavigate();
  useLanguage();
  const commandPaletteOpen = useSmartNavigationSelector((s) => s.commandPaletteOpen);
  const setCommandPaletteOpen = useSmartNavigationSelector((s) => s.setCommandPaletteOpen);
  const toggleCommandPalette = useSmartNavigationSelector((s) => s.toggleCommandPalette);
  const flatItems = useSmartNavigationSelector((s) => s.flatItems);
  const groups = useSmartNavigationSelector((s) => s.groups);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const results = useMemo(() => {
    const normalizedQuery = query.toLowerCase().trim();
    return normalizedQuery
      ? flatItems.filter((item) =>
          i18n.t(item.nameKey).toLowerCase().includes(normalizedQuery)
        )
      : flatItems;
  }, [flatItems, query]);

  const clampedIndex = Math.min(Math.max(0, selectedIndex), Math.max(0, results.length - 1));

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setCommandPaletteOpen(false);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        toggleCommandPalette();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [setCommandPaletteOpen, toggleCommandPalette]);

  useEffect(() => {
    if (commandPaletteOpen) {
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [commandPaletteOpen]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  const handleSelect = useCallback(
    (item: NavigationItemSchema) => {
      navigate(item.path);
      setCommandPaletteOpen(false);
    },
    [navigate, setCommandPaletteOpen]
  );

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!commandPaletteOpen) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, results.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const item = results[clampedIndex];
        if (item) handleSelect(item);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [commandPaletteOpen, results, clampedIndex, handleSelect]);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const selected = el.querySelector('[data-selected="true"]');
    selected?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [clampedIndex, results]);

  return (
    <AnimatePresence>
      {commandPaletteOpen && (
        <>
          <motion.div
            className="fixed inset-0 z-[100] bg-slate-900/60 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            onClick={() => setCommandPaletteOpen(false)}
            aria-hidden
          />
          <motion.div
            className="fixed left-1/2 top-[15%] z-[101] w-full max-w-lg -translate-x-1/2 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden"
            initial={{ opacity: 0, scale: 0.96, y: -8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: -8 }}
            transition={{ type: 'tween', duration: 0.2, ease: 'easeOut' }}
            role="dialog"
            aria-label={i18n.t('nav.commandPlaceholder')}
          >
            <div className="border-b border-slate-100 dark:border-slate-800">
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={i18n.t('nav.commandPlaceholder')}
                className="w-full h-12 px-4 text-base bg-transparent text-slate-900 dark:text-white placeholder:text-slate-400 outline-none border-0"
                aria-autocomplete="list"
                aria-controls="command-palette-list"
                aria-activedescendant={results[clampedIndex] ? `command-item-${clampedIndex}` : undefined}
              />
            </div>
            <div
              ref={listRef}
              id="command-palette-list"
              className="max-h-[min(60vh,400px)] overflow-y-auto py-2"
              role="listbox"
            >
              {results.length === 0 ? (
                <div className="py-8 text-center text-slate-500 dark:text-slate-400 text-sm">
                  Nenhum resultado.
                </div>
              ) : (
                results.map((item, index) => {
                  const group = Object.values(groups).find((g) =>
                    g.items.some((i) => i.path === item.path)
                  );
                  const Icon = group ? getNavIcon(group.icon) : getNavIcon('zap');
                  const isSelected = index === clampedIndex;

                  return (
                    <motion.button
                      key={item.path}
                      type="button"
                      id={`command-item-${index}`}
                      data-selected={isSelected}
                      onClick={() => handleSelect(item)}
                      className={`
                        flex items-center gap-3 w-full px-4 py-3 text-left text-sm font-medium transition-colors
                        ${isSelected ? 'bg-indigo-600 text-white' : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'}
                      `}
                      role="option"
                      aria-selected={isSelected}
                      whileHover={{ backgroundColor: isSelected ? undefined : undefined }}
                      initial={false}
                    >
                      <Icon size={18} className="shrink-0" aria-hidden />
                      {i18n.t(item.nameKey)}
                    </motion.button>
                  );
                })
              )}
            </div>
            <div className="px-4 py-2 border-t border-slate-100 dark:border-slate-800 flex items-center gap-4 text-[10px] text-slate-400">
              <span>
                <kbd className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 font-mono">↑</kbd>
                <kbd className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 font-mono ml-0.5">↓</kbd>
                {' '}navegar
              </span>
              <span>
                <kbd className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 font-mono">Enter</kbd>
                {' '}abrir
              </span>
              <span>
                <kbd className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 font-mono">Esc</kbd>
                {' '}fechar
              </span>
              <span>
                <kbd className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 font-mono">Ctrl</kbd>
                <kbd className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 font-mono ml-0.5">K</kbd>
                {' '}abrir
              </span>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};

export default memo(CommandPalette);
