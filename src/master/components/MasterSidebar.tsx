import React from 'react';
import { NavLink, Link, useLocation } from 'react-router-dom';
import { ExternalLink, LogOut, Star, X } from 'lucide-react';
import { hasMasterPermission, masterLogout } from '../api/masterApi';
import { MASTER_DAILY_MENU } from '../menu';
import { readMasterUxPrefs, type MasterRecentCompany } from '../ux/masterUxStorage';
import { cx, masterUi } from '../ui/masterUi';

type MasterSidebarProps = {
  collapsed?: boolean;
  isDark?: boolean;
  mobileOpen?: boolean;
  onCloseMobile?: () => void;
};

function pathOf(to: string): string {
  return to.split('?')[0] || to;
}

function sectionOf(to: string): string | null {
  try {
    const q = to.includes('?') ? new URLSearchParams(to.split('?')[1]) : null;
    return q?.get('section') ?? null;
  } catch {
    return null;
  }
}

function isItemActive(pathname: string, search: string, to: string): boolean {
  const base = pathOf(to);
  const wantSection = sectionOf(to);
  if (base === '/master') {
    return pathname === '/master';
  }
  if (pathname !== base) return false;
  const current = new URLSearchParams(search).get('section');
  if (wantSection) return current === wantSection;
  if (base === '/master/admin') return !current || current === 'settings';
  return true;
}

/**
 * Sidebar do Painel Master — mesmo DS visual do operacional.
 */
export function MasterSidebar({
  collapsed = false,
  mobileOpen = false,
  onCloseMobile,
}: MasterSidebarProps) {
  const location = useLocation();
  const [favorites, setFavorites] = React.useState<MasterRecentCompany[]>([]);

  React.useEffect(() => {
    setFavorites(readMasterUxPrefs().favorites);
  }, [location.pathname]);

  async function logout() {
    await masterLogout();
    window.location.assign('/');
  }

  const aside = (
    <aside className={cx(masterUi.sidebar, collapsed ? 'w-[72px]' : 'w-64')}>
      <div className={masterUi.sidebarHeader}>
        <Link to="/master" className="flex min-w-0 items-center gap-2" onClick={onCloseMobile}>
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-600 to-violet-600 text-sm font-bold text-white shadow-sm">
            M
          </div>
          {!collapsed && (
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-foreground">PontoWebDesk</p>
              <p className="text-[10px] font-medium uppercase tracking-wider text-indigo-600 dark:text-indigo-300">
                Plataforma
              </p>
            </div>
          )}
        </Link>
        {onCloseMobile && (
          <button
            type="button"
            className={cx(masterUi.iconBtn, 'lg:hidden')}
            onClick={onCloseMobile}
            aria-label="Fechar menu"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      <nav className="flex-1 overflow-y-auto px-2 py-3">
        <div className="space-y-1">
          {MASTER_DAILY_MENU.filter(
            (item) => !item.permission || hasMasterPermission(item.permission),
          ).map((item) => {
            const Icon = item.icon;
            const active = isItemActive(location.pathname, location.search, item.to);
            return (
              <React.Fragment key={item.id}>
                {item.separatorBefore && (
                  <div className="my-3 border-t border-border" role="separator" aria-hidden />
                )}
                <NavLink
                  to={item.to}
                  end={item.to === '/master'}
                  onClick={onCloseMobile}
                  className={cx(
                    'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-150',
                    active ? masterUi.navActive : masterUi.navIdle,
                  )}
                  title={item.label}
                >
                  <Icon
                    className={cx(
                      'h-4 w-4 shrink-0',
                      active ? 'text-indigo-600 dark:text-indigo-300' : 'text-foreground-muted',
                    )}
                  />
                  {!collapsed && <span className="truncate">{item.label}</span>}
                </NavLink>
              </React.Fragment>
            );
          })}
        </div>

        {!collapsed && favorites.length > 0 && (
          <div className="mt-4 space-y-1">
            <p className={cx(masterUi.label, 'flex items-center gap-1.5 px-3')}>
              <Star className="h-3 w-3 text-amber-500" /> Favoritos
            </p>
            {favorites.slice(0, 6).map((f) => (
              <Link
                key={f.id}
                to={`/master/tenants/${f.id}`}
                onClick={onCloseMobile}
                className="block truncate rounded-xl px-3 py-2 text-xs text-foreground-secondary transition-colors hover:bg-surface-muted"
              >
                {f.name}
              </Link>
            ))}
          </div>
        )}
      </nav>

      <div className={masterUi.sidebarFooter}>
        <Link
          to="/"
          className={cx(
            'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors',
            masterUi.navIdle,
          )}
          title="Abrir PontoWebDesk"
        >
          <ExternalLink className="h-4 w-4 shrink-0 text-foreground-muted" />
          {!collapsed && <span className="truncate">Abrir PontoWebDesk</span>}
        </Link>
        <button
          type="button"
          onClick={() => void logout()}
          className={cx(
            'flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors',
            masterUi.navIdle,
          )}
          title="Sair"
        >
          <LogOut className="h-4 w-4 shrink-0 text-foreground-muted" />
          {!collapsed && <span className="truncate">Sair</span>}
        </button>
      </div>
    </aside>
  );

  return (
    <>
      <div className="hidden lg:flex">{aside}</div>
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-slate-950/40 backdrop-blur-sm"
            aria-label="Fechar menu"
            onClick={onCloseMobile}
          />
          <div className="absolute inset-y-0 left-0 flex shadow-elevated">{aside}</div>
        </div>
      )}
    </>
  );
}
