import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Clock, Search, User } from 'lucide-react';
import type { User as AppUser } from '../../types';
import { i18n } from '../../lib/i18n';
import { useCompanyEmployees } from '../hooks/useCompanyEmployees';
import { getFlatNavigationByRole } from '../navigation/navigationSchema';
import { resolveTenantId } from '../services/tenantScope';
import { hasAdminAccess } from '../utils/accessProfile';
import { persistAdminTimesheetEmployeeFilter } from '../utils/adminTimesheetFilters';

type SearchResult =
  | { kind: 'employee'; id: string; label: string; hint?: string }
  | { kind: 'page'; path: string; label: string };

const TIME_PATH_PREFIXES = ['/admin/timesheet', '/admin/calculos', '/admin/cartao-ponto', '/admin/time-attendance', '/admin/time-attendance-audit', '/admin/bank-hours', '/employee/timesheet', '/employee/clock', '/employee/time-balance', '/employee/work-schedule'];

function normalizeQuery(value: string): string {
  return value.trim().toLowerCase();
}

function matchesEmployee(nome: string, email: string | undefined, query: string): boolean {
  if (!query) return false;
  if (nome.toLowerCase().includes(query)) return true;
  if (email && email.toLowerCase().includes(query)) return true;
  return false;
}

function isTimeRelatedPath(path: string): boolean {
  return TIME_PATH_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

interface HeaderSearchProps {
  user: AppUser;
}

const HeaderSearch: React.FC<HeaderSearchProps> = ({ user }) => {
  const navigate = useNavigate();
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);

  const isAdmin = hasAdminAccess(user.role);
  const companyId = resolveTenantId(user);
  const { employees, loadingEmployees } = useCompanyEmployees(isAdmin ? companyId : undefined);

  const results = useMemo<SearchResult[]>(() => {
    const q = normalizeQuery(query);
    if (q.length < 2) return [];

    const out: SearchResult[] = [];

    if (isAdmin) {
      for (const emp of employees) {
        if (!matchesEmployee(emp.nome, emp.email, q)) continue;
        out.push({
          kind: 'employee',
          id: emp.id,
          label: emp.nome,
          hint: emp.email,
        });
        if (out.length >= 8) break;
      }
    }

    const navItems = getFlatNavigationByRole(user.role ?? 'employee');
    for (const item of navItems) {
      if (!isTimeRelatedPath(item.path)) continue;
      const label = i18n.t(item.nameKey);
      if (!label.toLowerCase().includes(q)) continue;
      if (out.some((r) => r.kind === 'page' && r.path === item.path)) continue;
      out.push({ kind: 'page', path: item.path, label });
      if (out.length >= 12) break;
    }

    return out;
  }, [query, employees, isAdmin, user.role]);

  const clampedIndex = Math.min(Math.max(0, selectedIndex), Math.max(0, results.length - 1));

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, []);

  const selectResult = useCallback(
    (result: SearchResult) => {
      if (result.kind === 'employee') {
        persistAdminTimesheetEmployeeFilter(user.id, result.id);
        navigate(`/admin/timesheet?user_id=${encodeURIComponent(result.id)}`);
      } else {
        navigate(result.path);
      }
      setQuery('');
      setOpen(false);
      inputRef.current?.blur();
    },
    [navigate, user.id],
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Escape') {
        setOpen(false);
        inputRef.current?.blur();
        return;
      }
      if (!open || results.length === 0) {
        if (event.key === 'Enter' && normalizeQuery(query).length >= 2 && results.length === 0) {
          event.preventDefault();
        }
        return;
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, results.length - 1));
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (event.key === 'Enter') {
        event.preventDefault();
        const item = results[clampedIndex];
        if (item) selectResult(item);
      }
    },
    [clampedIndex, open, query, results, selectResult],
  );

  const showDropdown = open && normalizeQuery(query).length >= 2;

  return (
    <div ref={containerRef} className="relative flex-1 hidden sm:block max-w-xs">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" size={18} aria-hidden="true" />
      <input
        ref={inputRef}
        type="search"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
        placeholder={i18n.t('layout.searchPlaceholder')}
        aria-label={i18n.t('layout.searchField')}
        aria-expanded={showDropdown}
        aria-controls="header-search-results"
        aria-autocomplete="list"
        autoComplete="off"
        className="w-full pl-10 pr-4 py-2 bg-slate-100 dark:bg-slate-800 border-none rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500/30 transition-all text-slate-900 dark:text-white"
      />

      {showDropdown && (
        <div
          id="header-search-results"
          role="listbox"
          className="absolute left-0 right-0 top-full mt-2 z-50 max-h-72 overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-xl"
        >
          {loadingEmployees && isAdmin && results.length === 0 ? (
            <div className="px-4 py-3 text-sm text-slate-500 dark:text-slate-400">
              {i18n.t('layout.searchLoading')}
            </div>
          ) : results.length === 0 ? (
            <div className="px-4 py-3 text-sm text-slate-500 dark:text-slate-400">
              {i18n.t('layout.searchNoResults')}
            </div>
          ) : (
            results.map((result, index) => {
              const isSelected = index === clampedIndex;
              const Icon = result.kind === 'employee' ? User : Clock;
              return (
                <button
                  key={result.kind === 'employee' ? `emp-${result.id}` : `page-${result.path}`}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onMouseEnter={() => setSelectedIndex(index)}
                  onClick={() => selectResult(result)}
                  className={`flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors ${
                    isSelected
                      ? 'bg-indigo-600 text-white'
                      : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                >
                  <Icon size={16} className="shrink-0 opacity-80" aria-hidden />
                  <span className="flex-1 min-w-0">
                    <span className="block truncate font-medium">{result.label}</span>
                    {result.kind === 'employee' ? (
                      <span className={`block truncate text-xs ${isSelected ? 'text-indigo-100' : 'text-slate-500 dark:text-slate-400'}`}>
                        {i18n.t('layout.searchEmployeeHint')}
                        {result.hint ? ` · ${result.hint}` : ''}
                      </span>
                    ) : null}
                  </span>
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
};

export default memo(HeaderSearch);
