const STORAGE_KEY = 'pontowebdesk:help_behavior';

export type BehaviorEventType = 'route_visit' | 'doc_open' | 'error_help' | 'search';

interface BehaviorStore {
  routes: Record<string, number>;
  docs: Record<string, number>;
  errors: Record<string, number>;
  lastRoute?: string;
  updatedAt: number;
}

function emptyStore(): BehaviorStore {
  return { routes: {}, docs: {}, errors: {}, updatedAt: 0 };
}

/** Garante maps válidos — localStorage legado pode vir sem `routes`/`docs`/`errors`. */
function normalizeStore(raw: unknown): BehaviorStore {
  if (!raw || typeof raw !== 'object') return emptyStore();
  const data = raw as Partial<BehaviorStore>;
  return {
    routes: data.routes && typeof data.routes === 'object' ? data.routes : {},
    docs: data.docs && typeof data.docs === 'object' ? data.docs : {},
    errors: data.errors && typeof data.errors === 'object' ? data.errors : {},
    lastRoute: typeof data.lastRoute === 'string' ? data.lastRoute : undefined,
    updatedAt: typeof data.updatedAt === 'number' ? data.updatedAt : Date.now(),
  };
}

function readStore(): BehaviorStore {
  if (typeof window === 'undefined') {
    return emptyStore();
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyStore();
    return normalizeStore(JSON.parse(raw));
  } catch {
    return { ...emptyStore(), updatedAt: Date.now() };
  }
}

function writeStore(store: BehaviorStore): void {
  if (typeof window === 'undefined') return;
  const normalized = normalizeStore(store);
  window.localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ ...normalized, updatedAt: Date.now() }),
  );
}

function bump(map: Record<string, number> | undefined, key: string): Record<string, number> {
  const safe = map && typeof map === 'object' ? map : {};
  return { ...safe, [key]: (safe[key] ?? 0) + 1 };
}

export function trackBehaviorRoute(pathname: string): void {
  const store = readStore();
  writeStore({
    ...store,
    routes: bump(store.routes, pathname),
    lastRoute: pathname,
  });
}

export function trackBehaviorDoc(doc: string): void {
  const store = readStore();
  writeStore({ ...store, docs: bump(store.docs, doc) });
}

export function trackBehaviorError(code: string): void {
  const store = readStore();
  writeStore({ ...store, errors: bump(store.errors, code) });
}

export function getTopBehaviorRoutes(limit = 3): { path: string; count: number }[] {
  const store = readStore();
  return Object.entries(store.routes)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([path, count]) => ({ path, count }));
}

export function getTopBehaviorDocs(limit = 3): { doc: string; count: number }[] {
  const store = readStore();
  return Object.entries(store.docs)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([doc, count]) => ({ doc, count }));
}

export interface BehaviorSuggestion {
  id: string;
  message: string;
  route?: string;
  doc?: string;
}

const ROUTE_LABELS: Record<string, string> = {
  '/admin/bank-hours': 'Banco de Horas',
  '/admin/timesheet': 'Espelho de Ponto',
  '/admin/time-attendance-audit': 'Auditoria de Jornada',
  '/admin/employees': 'Colaboradores',
  '/admin/rep-devices': 'Relógios REP',
};

export function getBehaviorSuggestions(): BehaviorSuggestion[] {
  const top = getTopBehaviorRoutes(1)[0];
  if (!top || top.count < 5) return [];

  const label = ROUTE_LABELS[top.path] ?? top.path.replace('/admin/', '');
  return [
    {
      id: 'frequent-route',
      message: `Você costuma acessar ${label} — use o menu inferior para chegar mais rápido.`,
      route: top.path,
    },
  ];
}
