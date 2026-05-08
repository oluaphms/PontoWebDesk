import {
  assertTenantScopedCacheKey,
  buildTenantGeoCacheKey,
  clearTenantScopedCaches,
  registerTenantScopedCache,
  type TenantScope,
} from '../../domain/operational/cache/tenantCacheIsolation';
import {
  appendOperationalTraceSpan,
  beginOperationalTrace,
  failOperationalTrace,
  finalizeOperationalTrace,
} from '../../domain/operational/tracing';
import { recordOperationalMetric } from '../../domain/operational/metrics';
import {
  degradedMode,
  operationalCircuitBreaker,
  retryBackoff,
  retryBudget,
} from '../../domain/operational/resilience';

export type GeocodeSnapshot = {
  street: string | null;
  district: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  country: string | null;
  provider: string;
  resolved_at: string;
  formatted: string;
};

type ReverseResult = {
  snapshot: GeocodeSnapshot;
  cacheHit: boolean;
};

const CACHE = new Map<string, GeocodeSnapshot>();
const IN_FLIGHT = new Map<string, Promise<GeocodeSnapshot>>();
const CACHE_MAX = 500;
const VERSION = 'v1';

function readCurrentUserScope(): TenantScope {
  if (typeof window === 'undefined') return { companyId: 'no-company', userId: 'no-user' };
  try {
    const raw = localStorage.getItem('current_user');
    if (!raw) return { companyId: 'no-company', userId: 'no-user' };
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const companyId = String(parsed.companyId ?? parsed.company_id ?? parsed.tenantId ?? '').trim() || 'no-company';
    const userId = String(parsed.id ?? '').trim() || 'no-user';
    const role = String(parsed.role ?? '').trim() || undefined;
    return { companyId, userId, role };
  } catch {
    return { companyId: 'no-company', userId: 'no-user' };
  }
}

function cacheKey(lat: number, lng: number, provider: string): string {
  const key = buildTenantGeoCacheKey({
    scope: readCurrentUserScope(),
    provider,
    lat,
    lng,
  });
  assertTenantScopedCacheKey(key);
  return key;
}

function getOrigin(): string {
  if (typeof window !== 'undefined' && window.location?.origin) return window.location.origin;
  return 'http://localhost:3010';
}

function logGeo(tag: string, payload: Record<string, unknown>): void {
  if (typeof console === 'undefined') return;
  console.info(tag, payload);
}

function toSnapshotFromAddress(
  addr: Record<string, unknown> | null | undefined,
  fallbackText: string,
  provider: string,
): GeocodeSnapshot {
  const street = [addr?.road, addr?.house_number].filter(Boolean).map(String).join(', ') || null;
  const district = (addr?.suburb ?? addr?.neighbourhood ?? null) as string | null;
  const city = (addr?.city ?? addr?.town ?? addr?.village ?? addr?.county ?? null) as string | null;
  const state = (addr?.state ?? null) as string | null;
  const postal = (addr?.postcode ?? null) as string | null;
  const country = (addr?.country ?? null) as string | null;
  const formatted =
    [street, district, city, state].filter((x) => x && String(x).trim()).join(' - ') || fallbackText;
  return {
    street,
    district,
    city,
    state,
    postal_code: postal,
    country,
    provider,
    resolved_at: new Date().toISOString(),
    formatted,
  };
}

async function fetchFromApi(lat: number, lng: number): Promise<GeocodeSnapshot> {
  const u = new URL('/api/reverse-geocode', getOrigin());
  u.searchParams.set('lat', String(lat));
  u.searchParams.set('lon', String(lng));
  const res = await fetch(u.toString(), { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`reverse_geocode_http_${res.status}`);
  const data = (await res.json()) as { address?: string; address_parts?: Record<string, unknown>; provider?: string };
  const formatted = String(data.address || '').trim() || `Coordenadas: ${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  return toSnapshotFromAddress(data.address_parts, formatted, data.provider || 'nominatim');
}

let reverseGeoCacheIsolationBootstrapped = false;
function bootstrapReverseGeoCacheIsolation(): void {
  if (reverseGeoCacheIsolationBootstrapped || typeof window === 'undefined') return;
  reverseGeoCacheIsolationBootstrapped = true;
  registerTenantScopedCache({
    name: 'reverse_geocode_cache',
    clear: () => {
      CACHE.clear();
      IN_FLIGHT.clear();
    },
    validate: () => {
      const issues: string[] = [];
      for (const key of CACHE.keys()) {
        try {
          assertTenantScopedCacheKey(key);
        } catch (error) {
          issues.push(String(error));
        }
      }
      return issues;
    },
    countEntries: () => CACHE.size + IN_FLIGHT.size,
  });
  window.addEventListener('current_user_changed', () => {
    clearTenantScopedCaches();
  });
}

export async function reverseGeocodeSnapshot(lat: number, lng: number): Promise<ReverseResult> {
  bootstrapReverseGeoCacheIsolation();
  const scope = readCurrentUserScope();
  const trace = beginOperationalTrace({
    company_id: scope.companyId,
    employee_id: scope.userId,
    correlation_id: null,
    operation_id: null,
    source: 'reverseGeocodeSnapshot',
  });
  const key = cacheKey(lat, lng, 'nominatim');
  const cached = CACHE.get(key);
  if (cached) {
    appendOperationalTraceSpan({
      trace_id: trace.trace_id,
      type: 'CACHE_ACCESS',
      source: 'reverseGeocodeSnapshot',
      status: 'ok',
      finished_at: new Date().toISOString(),
      metadata: { hit: true, provider: 'nominatim' },
    });
    recordOperationalMetric('cache_hit_ratio', 1, {
      company_id: scope.companyId,
      employee_id: scope.userId,
      source: 'reverse_geocode',
      operation_type: 'cache',
    });
    logGeo('[GEO TENANT CACHE]', { lat, lng, key, source: 'app', hit: true });
    finalizeOperationalTrace(trace.trace_id);
    return { snapshot: cached, cacheHit: true };
  }
  recordOperationalMetric('cache_hit_ratio', 0, {
    company_id: scope.companyId,
    employee_id: scope.userId,
    source: 'reverse_geocode',
    operation_type: 'cache',
  });
  const pending = IN_FLIGHT.get(key);
  if (pending) {
    appendOperationalTraceSpan({
      trace_id: trace.trace_id,
      type: 'CACHE_ACCESS',
      source: 'reverseGeocodeSnapshot',
      status: 'ok',
      finished_at: new Date().toISOString(),
      metadata: { hit: true, inflight: true, provider: 'nominatim' },
    });
    const snap = await pending;
    finalizeOperationalTrace(trace.trace_id);
    return { snapshot: snap, cacheHit: true };
  }
  const geoSpanStart = Date.now();
  const run = (async () => {
    let attempt = 0;
    const snap = await operationalCircuitBreaker.execute({
      key: 'reverse_geocode_api',
      companyId: scope.companyId,
      fn: async () => {
        attempt += 1;
        if (!retryBudget.allow(`reverse_geocode:${scope.companyId}`, 120)) {
          throw new Error('retry_budget_exceeded_reverse_geocode');
        }
        try {
          return await fetchFromApi(lat, lng);
        } catch (error) {
          if (attempt < 3) {
            await new Promise((resolve) => setTimeout(resolve, retryBackoff.computeDelayMs(attempt)));
            return fetchFromApi(lat, lng);
          }
          throw error;
        }
      },
    });
    const latency = Date.now() - geoSpanStart;
    recordOperationalMetric('reverse_geocode_latency_ms', latency, {
      company_id: scope.companyId,
      employee_id: scope.userId,
      source: 'reverse_geocode',
      operation_type: 'rpc_call',
    });
    if (CACHE.size >= CACHE_MAX) {
      const first = CACHE.keys().next().value;
      if (first !== undefined) CACHE.delete(first);
    }
    CACHE.set(key, snap);
    logGeo('[GEO CACHE ISOLATION]', { lat, lng, provider: snap.provider, key, version: VERSION, source: 'app' });
    return snap;
  })();
  IN_FLIGHT.set(key, run);
  try {
    const snapshot = await run;
    appendOperationalTraceSpan({
      trace_id: trace.trace_id,
      type: 'RPC_CALL',
      source: 'reverseGeocodeSnapshot',
      status: 'ok',
      finished_at: new Date().toISOString(),
      metadata: { provider: snapshot.provider, degraded_tenant: degradedMode.isTenantDegraded(scope.companyId) },
    });
    finalizeOperationalTrace(trace.trace_id);
    return { snapshot, cacheHit: false };
  } catch (error) {
    appendOperationalTraceSpan({
      trace_id: trace.trace_id,
      type: 'RPC_CALL',
      source: 'reverseGeocodeSnapshot',
      status: 'error',
      finished_at: new Date().toISOString(),
      metadata: { error: error instanceof Error ? error.message : String(error) },
    });
    failOperationalTrace(trace.trace_id, error);
    throw error;
  } finally {
    IN_FLIGHT.delete(key);
  }
}

export function clearGeocodeCache(): void {
  CACHE.clear();
  IN_FLIGHT.clear();
  logGeo('[GEO CACHE INVALIDATION]', { source: 'app', cache: 'reverse_geocode' });
}

