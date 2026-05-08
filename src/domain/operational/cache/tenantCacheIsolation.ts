export type TenantScope = {
  companyId: string;
  userId: string;
  tenantId?: string;
  role?: string;
};

type CacheClearFn = (scope?: Partial<TenantScope>) => void;
type CacheValidateFn = () => string[];

type CacheRegistryEntry = {
  name: string;
  clear: CacheClearFn;
  validate?: CacheValidateFn;
  countEntries?: () => number;
};

const CACHE_REGISTRY = new Map<string, CacheRegistryEntry>();
const GEO_COORD_PRECISION = 5;

function scopePart(value: unknown, fallback: string): string {
  const v = String(value ?? '').trim();
  return v.length > 0 ? v : fallback;
}

export function buildTenantCacheKey(scope: Partial<TenantScope>, ...parts: Array<string | number>): string {
  const company = scopePart(scope.companyId ?? scope.tenantId, 'no-company');
  const user = scopePart(scope.userId, 'no-user');
  return [company, user, ...parts.map((p) => String(p))].join(':');
}

export function buildTenantGeoCacheKey(params: {
  scope: Partial<TenantScope>;
  provider: string;
  lat: number;
  lng: number;
}): string {
  const latNorm = Number(params.lat).toFixed(GEO_COORD_PRECISION);
  const lngNorm = Number(params.lng).toFixed(GEO_COORD_PRECISION);
  const provider = scopePart(params.provider, 'unknown-provider');
  return buildTenantCacheKey(params.scope, provider, latNorm, lngNorm);
}

export function assertTenantScopedCacheKey(key: string): void {
  const parts = String(key ?? '').split(':').filter(Boolean);
  if (parts.length < 4) {
    throw new Error(`[TENANT CACHE ISOLATION FAILURE] cache key sem escopo mínimo: "${key}"`);
  }
  if (parts[0] === 'no-company' || parts[1] === 'no-user') {
    throw new Error(`[TENANT CACHE ISOLATION FAILURE] cache key sem tenant/user válidos: "${key}"`);
  }
}

export function registerTenantScopedCache(entry: CacheRegistryEntry): void {
  CACHE_REGISTRY.set(entry.name, entry);
}

export function clearTenantScopedCaches(scope?: Partial<TenantScope>): void {
  for (const entry of CACHE_REGISTRY.values()) {
    try {
      entry.clear(scope);
    } catch (error) {
      if (typeof console !== 'undefined') {
        console.warn('[TENANT CACHE RESET]', { cache: entry.name, error });
      }
    }
  }
  if (typeof console !== 'undefined') {
    console.info('[TENANT CACHE RESET]', {
      company_id: scope?.companyId ?? scope?.tenantId ?? null,
      user_id: scope?.userId ?? null,
      total_caches: CACHE_REGISTRY.size,
    });
  }
}

export function validateTenantMemoryIsolation(): { ok: boolean; issues: string[] } {
  const issues: string[] = [];
  for (const entry of CACHE_REGISTRY.values()) {
    if (!entry.validate) continue;
    try {
      const result = entry.validate();
      for (const issue of result) issues.push(`${entry.name}: ${issue}`);
    } catch (error) {
      issues.push(`${entry.name}: falha ao validar isolamento (${String(error)})`);
    }
  }
  return { ok: issues.length === 0, issues };
}

export function listTenantScopedCacheStats(): Array<{ name: string; entries: number | null }> {
  const out: Array<{ name: string; entries: number | null }> = [];
  for (const entry of CACHE_REGISTRY.values()) {
    let entries: number | null = null;
    if (entry.countEntries) {
      try {
        entries = entry.countEntries();
      } catch {
        entries = null;
      }
    }
    out.push({ name: entry.name, entries });
  }
  return out;
}
