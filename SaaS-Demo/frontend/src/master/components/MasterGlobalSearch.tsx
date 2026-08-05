import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Building2, KeyRound, Banknote, BarChart3, Search, Command, X } from 'lucide-react';
import { MASTER_DAILY_MENU } from '../menu';
import { hasMasterPermission } from '../api/masterApi';
import { MasterTenantsService } from '../services/masterTenantsService';
import { readMasterUxPrefs } from '../ux/masterUxStorage';
import { cx, masterUi } from '../ui/masterUi';

type Hit = {
  id: string;
  label: string;
  hint?: string;
  to: string;
  group: string;
  icon: React.ComponentType<{ className?: string }>;
  permission?: string;
};

const QUICK: Hit[] = [
  { id: 'q-tenants', label: 'Empresas', to: '/master/tenants', group: 'Atalhos', icon: Building2, permission: 'tenants:read' },
  { id: 'q-licenses', label: 'Licenças', to: '/master/licenses', group: 'Atalhos', icon: KeyRound, permission: 'licenses:read' },
  { id: 'q-payments', label: 'Pagamentos', to: '/master/payments', group: 'Atalhos', icon: Banknote, permission: 'payments:read' },
  { id: 'q-finance', label: 'Relatórios', to: '/master/finance', group: 'Atalhos', icon: BarChart3, permission: 'payments:read' },
  ...MASTER_DAILY_MENU.map((m) => ({
    id: `menu-${m.id}`,
    label: m.label,
    hint: m.description,
    to: m.to,
    group: 'Menu',
    icon: m.icon,
    permission: m.permission,
  })),
];

/**
 * Pesquisa global instantânea (Ctrl/Cmd+K). Filtra menu + empresas locais + favoritos/recentes.
 */
export function MasterGlobalSearch() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [companyHits, setCompanyHits] = useState<Hit[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<number | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen(true);
      }
      if (e.key === 'Escape') setOpen(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (!open) return;
    setQ('');
    window.setTimeout(() => inputRef.current?.focus(), 30);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    const term = q.trim();
    if (term.length < 1) {
      setCompanyHits([]);
      return;
    }
    debounceRef.current = window.setTimeout(() => {
      void (async () => {
        setLoading(true);
        try {
          const rows = await MasterTenantsService.list({ q: term });
          setCompanyHits(
            rows.slice(0, 8).map((r) => ({
              id: `co-${r.id}`,
              label: r.empresa,
              hint: `${r.status} · ${r.plano}`,
              to: `/master/tenants/${r.id}`,
              group: 'Empresas',
              icon: Building2,
            })),
          );
        } catch {
          setCompanyHits([]);
        } finally {
          setLoading(false);
        }
      })();
    }, 180);
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [q, open]);

  const prefsHits = useMemo(() => {
    if (!open) return [];
    const prefs = readMasterUxPrefs();
    const fromFav = prefs.favorites.map((f) => ({
      id: `fav-${f.id}`,
      label: f.name,
      hint: 'Favorito',
      to: `/master/tenants/${f.id}`,
      group: 'Favoritos',
      icon: Building2,
    }));
    const fromRecent = prefs.recentClients.map((f) => ({
      id: `rec-${f.id}`,
      label: f.name,
      hint: 'Recente',
      to: `/master/tenants/${f.id}`,
      group: 'Recentes',
      icon: Building2,
    }));
    return [...fromFav, ...fromRecent];
  }, [open]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    const permitted = QUICK.filter(
      (hit) => !hit.permission || hasMasterPermission(hit.permission),
    );
    const base = term
      ? permitted.filter(
          (h) =>
            h.label.toLowerCase().includes(term) ||
            (h.hint || '').toLowerCase().includes(term),
        )
      : permitted.filter((h) => h.group === 'Atalhos');
    const local = term
      ? prefsHits.filter((h) => h.label.toLowerCase().includes(term))
      : prefsHits.slice(0, 6);
    const seen = new Set<string>();
    const all = [...companyHits, ...local, ...base].filter((h) => {
      if (seen.has(h.to + h.label)) return false;
      seen.add(h.to + h.label);
      return true;
    });
    return all.slice(0, 14);
  }, [q, companyHits, prefsHits]);

  function go(to: string) {
    setOpen(false);
    navigate(to);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2 text-left text-sm text-foreground-muted shadow-sm transition-all duration-150 hover:border-indigo-200 hover:bg-surface-sunken dark:hover:border-indigo-500/30 sm:max-w-md"
        aria-label="Pesquisar no painel"
      >
        <Search className="h-4 w-4 shrink-0" />
        <span className="truncate">Pesquisar empresas, menu…</span>
        <span className="ml-auto hidden items-center gap-0.5 rounded-md border border-border px-1.5 py-0.5 text-[10px] text-foreground-disabled sm:inline-flex">
          <Command className="h-2.5 w-2.5" />K
        </span>
      </button>

      {open && (
        <div className="fixed inset-0 z-[80] flex items-start justify-center bg-slate-950/40 p-4 pt-[12vh] backdrop-blur-sm">
          <div
            role="dialog"
            aria-modal
            aria-label="Pesquisa global"
            className="w-full max-w-xl overflow-hidden rounded-2xl border border-border bg-surface shadow-elevated"
          >
            <div className="flex items-center gap-2 border-b border-border px-3 py-2">
              <Search className="h-4 w-4 text-foreground-muted" />
              <input
                ref={inputRef}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Busca instantânea…"
                className="min-w-0 flex-1 bg-transparent py-2 text-sm text-foreground outline-none placeholder:text-foreground-disabled"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && filtered[0]) go(filtered[0].to);
                }}
              />
              {loading && <span className="text-[10px] text-foreground-disabled">…</span>}
              <button
                type="button"
                onClick={() => setOpen(false)}
                className={masterUi.iconBtn}
                aria-label="Fechar"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <ul className="max-h-[50vh] overflow-y-auto py-2">
              {filtered.map((hit) => {
                const Icon = hit.icon;
                return (
                  <li key={hit.id}>
                    <button
                      type="button"
                      onClick={() => go(hit.to)}
                      className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-indigo-50 dark:hover:bg-indigo-500/10"
                    >
                      <Icon className="h-4 w-4 shrink-0 text-indigo-600 dark:text-indigo-300" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-foreground">
                          {hit.label}
                        </span>
                        <span className={cx(masterUi.helper, 'block truncate')}>
                          {hit.group}
                          {hit.hint ? ` · ${hit.hint}` : ''}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
              {filtered.length === 0 && (
                <li className={cx(masterUi.subtitle, 'px-4 py-8 text-center')}>Nenhum resultado.</li>
              )}
            </ul>
          </div>
          <button
            type="button"
            className="absolute inset-0 -z-10 cursor-default"
            aria-label="Fechar pesquisa"
            onClick={() => setOpen(false)}
          />
        </div>
      )}
    </>
  );
}
