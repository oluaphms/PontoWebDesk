import React, { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { MasterSidebar } from '../components/MasterSidebar';
import { MasterTopbar } from '../components/MasterTopbar';
import { MasterPaymentsNavigation } from '../components/MasterPaymentsNavigation';
import { MASTER_MENU } from '../menu';
import { ThemeService } from '../../../services/themeService';
import { readMasterUxPrefs, setSidebarCollapsed } from '../ux/masterUxStorage';
import { masterUi } from '../ui/masterUi';

function titleFromPath(pathname: string, search: string): string {
  if (pathname === '/master') return 'Página inicial';
  if (pathname === '/master/hub') return 'Central Master';
  if (pathname === '/master/tenants/new') return 'Cadastrar empresa';
  if (pathname.endsWith('/edit') && pathname.includes('/tenants/')) return 'Editar empresa';
  if (pathname.startsWith('/master/tenants/') && pathname !== '/master/tenants') return 'Empresa';
  const section = new URLSearchParams(search).get('section');
  if (pathname === '/master/admin' && section) {
    const hit = MASTER_MENU.find((i) => i.to.includes(`section=${section}`));
    if (hit) return hit.label;
    if (section === 'deployment') return 'Implantação';
    if (section === 'settings') return 'Configurações';
  }
  const exact = MASTER_MENU.find((item) => item.to === pathname);
  if (exact) return exact.label;
  const prefix = MASTER_MENU.find(
    (item) => item.to !== '/master' && pathname.startsWith(`${item.to.split('?')[0]}/`),
  );
  return prefix?.label ?? 'Painel Master';
}

export function MasterLayout() {
  const location = useLocation();
  const title = titleFromPath(location.pathname, location.search);
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const saved = ThemeService.readStoredTheme();
    if (saved === 'light' || saved === 'dark') return saved;
    return ThemeService.getSystemTheme();
  });
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => readMasterUxPrefs().sidebarCollapsed);
  const isDark = theme === 'dark';
  const isPaymentsArea = location.pathname === '/master/payments';

  useEffect(() => {
    ThemeService.applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  function toggleTheme() {
    setTheme((current) => (current === 'dark' ? 'light' : 'dark'));
  }

  function toggleSidebar() {
    if (typeof window !== 'undefined' && window.matchMedia('(max-width: 1023px)').matches) {
      setMobileOpen((v) => !v);
      return;
    }
    setCollapsed((c) => {
      const next = !c;
      setSidebarCollapsed(next);
      return next;
    });
  }

  return (
    <div className="flex min-h-screen bg-transparent text-foreground transition-colors duration-300">
      <MasterSidebar
        isDark={isDark}
        collapsed={mobileOpen ? false : collapsed}
        mobileOpen={mobileOpen}
        onCloseMobile={() => setMobileOpen(false)}
      />
      <div className="relative z-10 flex min-w-0 flex-1 flex-col bg-transparent">
        <MasterTopbar
          title={title}
          isDark={isDark}
          onToggleTheme={toggleTheme}
          onToggleSidebar={toggleSidebar}
        />
        <main className="min-h-0 flex-1 overflow-auto bg-transparent">
          {/* Mesmo envelope de conteúdo do Layout operacional */}
          <div className="mx-auto w-full max-w-7xl min-h-full space-y-6 p-4 md:p-6 lg:p-10">
            {isPaymentsArea && <MasterPaymentsNavigation />}
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
