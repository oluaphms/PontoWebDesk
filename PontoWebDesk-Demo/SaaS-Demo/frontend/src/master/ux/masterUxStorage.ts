/**
 * Preferências visuais do Painel Master (FASE 32).
 * Apenas localStorage — sem alterar APIs ou regras comerciais.
 */

export type MasterRecentCompany = {
  id: string;
  name: string;
  at: string;
};

export type MasterDashboardWidgetId =
  | 'companies'
  | 'licenses'
  | 'revenue'
  | 'shortcuts'
  | 'favorites'
  | 'recentClients'
  | 'recentImplants'
  | 'recentPayments';

export type MasterUxPrefs = {
  favorites: MasterRecentCompany[];
  recentClients: MasterRecentCompany[];
  recentImplants: MasterRecentCompany[];
  dashboardWidgets: MasterDashboardWidgetId[];
  sidebarCollapsed: boolean;
};

const STORAGE_KEY = 'pwd_master_ux_prefs';
const MAX_RECENT = 8;

export const DEFAULT_DASHBOARD_WIDGETS: MasterDashboardWidgetId[] = [
  'shortcuts',
  'companies',
  'licenses',
  'revenue',
  'favorites',
  'recentClients',
  'recentImplants',
  'recentPayments',
];

const DEFAULT_PREFS: MasterUxPrefs = {
  favorites: [],
  recentClients: [],
  recentImplants: [],
  dashboardWidgets: [...DEFAULT_DASHBOARD_WIDGETS],
  sidebarCollapsed: false,
};

function pushUnique(
  list: MasterRecentCompany[],
  item: MasterRecentCompany,
  max = MAX_RECENT,
): MasterRecentCompany[] {
  const next = [{ ...item, at: item.at || new Date().toISOString() }, ...list.filter((x) => x.id !== item.id)];
  return next.slice(0, max);
}

export function readMasterUxPrefs(): MasterUxPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_PREFS, dashboardWidgets: [...DEFAULT_DASHBOARD_WIDGETS] };
    const parsed = JSON.parse(raw) as Partial<MasterUxPrefs>;
    const widgets = Array.isArray(parsed.dashboardWidgets)
      ? (parsed.dashboardWidgets.filter((w) =>
          DEFAULT_DASHBOARD_WIDGETS.includes(w as MasterDashboardWidgetId),
        ) as MasterDashboardWidgetId[])
      : [...DEFAULT_DASHBOARD_WIDGETS];
    return {
      favorites: Array.isArray(parsed.favorites) ? parsed.favorites.slice(0, MAX_RECENT) : [],
      recentClients: Array.isArray(parsed.recentClients)
        ? parsed.recentClients.slice(0, MAX_RECENT)
        : [],
      recentImplants: Array.isArray(parsed.recentImplants)
        ? parsed.recentImplants.slice(0, MAX_RECENT)
        : [],
      dashboardWidgets: widgets.length ? widgets : [...DEFAULT_DASHBOARD_WIDGETS],
      sidebarCollapsed: Boolean(parsed.sidebarCollapsed),
    };
  } catch {
    return { ...DEFAULT_PREFS, dashboardWidgets: [...DEFAULT_DASHBOARD_WIDGETS] };
  }
}

export function writeMasterUxPrefs(prefs: MasterUxPrefs): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    /* ignore quota */
  }
}

export function touchRecentClient(id: string, name: string): MasterUxPrefs {
  const prefs = readMasterUxPrefs();
  prefs.recentClients = pushUnique(prefs.recentClients, {
    id,
    name,
    at: new Date().toISOString(),
  });
  writeMasterUxPrefs(prefs);
  return prefs;
}

/** Remove um cliente da lista "Últimos clientes acessados". */
export function removeRecentClient(id: string): MasterUxPrefs {
  const prefs = readMasterUxPrefs();
  prefs.recentClients = prefs.recentClients.filter((c) => c.id !== id);
  writeMasterUxPrefs(prefs);
  return prefs;
}

export function touchRecentImplant(id: string, name: string): MasterUxPrefs {
  const prefs = readMasterUxPrefs();
  prefs.recentImplants = pushUnique(prefs.recentImplants, {
    id,
    name,
    at: new Date().toISOString(),
  });
  writeMasterUxPrefs(prefs);
  return prefs;
}

export function toggleFavorite(id: string, name: string): MasterUxPrefs {
  const prefs = readMasterUxPrefs();
  const exists = prefs.favorites.some((f) => f.id === id);
  prefs.favorites = exists
    ? prefs.favorites.filter((f) => f.id !== id)
    : pushUnique(prefs.favorites, { id, name, at: new Date().toISOString() });
  writeMasterUxPrefs(prefs);
  return prefs;
}

export function isFavorite(id: string): boolean {
  return readMasterUxPrefs().favorites.some((f) => f.id === id);
}

export function setDashboardWidgets(widgets: MasterDashboardWidgetId[]): MasterUxPrefs {
  const prefs = readMasterUxPrefs();
  prefs.dashboardWidgets = widgets.length ? widgets : [...DEFAULT_DASHBOARD_WIDGETS];
  writeMasterUxPrefs(prefs);
  return prefs;
}

export function setSidebarCollapsed(collapsed: boolean): MasterUxPrefs {
  const prefs = readMasterUxPrefs();
  prefs.sidebarCollapsed = collapsed;
  writeMasterUxPrefs(prefs);
  return prefs;
}

export const DASHBOARD_WIDGET_LABELS: Record<MasterDashboardWidgetId, string> = {
  shortcuts: 'Atalhos rápidos',
  companies: 'Empresas',
  licenses: 'Licenças',
  revenue: 'Receita',
  favorites: 'Favoritos',
  recentClients: 'Últimos clientes',
  recentImplants: 'Últimas implantações',
  recentPayments: 'Últimos pagamentos',
};
