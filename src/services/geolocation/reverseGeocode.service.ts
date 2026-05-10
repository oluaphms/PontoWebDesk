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
import {
  normalizeOperationalAddressCached,
  normalizeOperationalAddressShape,
  operationalGeocodeResolvedAtIso,
  type OperationalAddressShape,
} from './addressNormalizer.service';
import { opLog } from '../../utils/operationalLogger';

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
  reverse_geocode_status?: 'ok' | 'partial' | 'timeout' | 'provider_error';
  formatted_address?: string | null;
};

type ReverseResult = {
  snapshot: GeocodeSnapshot;
  cacheHit: boolean;
};

const CACHE = new Map<string, GeocodeSnapshot>();
const IN_FLIGHT = new Map<string, Promise<GeocodeSnapshot>>();
const CACHE_MAX = 500;
const VERSION = 'v2';

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

function hasValidTenantScope(scope: TenantScope): boolean {
  return (
    Boolean(scope.companyId && scope.companyId !== 'no-company') &&
    Boolean(scope.userId && scope.userId !== 'no-user')
  );
}

function cacheKey(lat: number, lng: number, provider: string): string | null {
  const scope = readCurrentUserScope();
  if (!hasValidTenantScope(scope)) {
    return null;
  }
  const providerVersioned = `${String(provider).replace(/[^a-z0-9_-]/gi, '_')}_v${VERSION.replace(/[^a-z0-9_-]/gi, '')}`;
  const key = buildTenantGeoCacheKey({
    scope,
    provider: providerVersioned,
    lat,
    lng,
  });
  assertTenantScopedCacheKey(key);
  return key;
}

function finalizeGeocodeSnapshotWithNormalizer(lat: number, lng: number, provider: string, base: GeocodeSnapshot): GeocodeSnapshot {
  const scopeKey = cacheKey(lat, lng, provider);
  const dedupeKey = `${scopeKey ?? `no_scope|${lat}|${lng}|${provider}`}|addr_norm`;
  const shape: OperationalAddressShape = {
    street: base.street,
    district: base.district,
    city: base.city,
    state: base.state,
    postal_code: base.postal_code,
    country: base.country,
    formatted: base.formatted,
    formatted_address: base.formatted_address ?? base.formatted,
  };
  const norm = normalizeOperationalAddressCached(dedupeKey, shape);
  return {
    street: norm.street,
    district: norm.district,
    city: norm.city,
    state: norm.state,
    postal_code: norm.postal_code,
    country: norm.country,
    provider: base.provider,
    resolved_at: operationalGeocodeResolvedAtIso(),
    formatted: norm.formatted,
    formatted_address: norm.formatted_address ?? norm.formatted,
    reverse_geocode_status: base.reverse_geocode_status,
  };
}

function getOrigin(): string {
  if (typeof window !== 'undefined' && window.location?.origin) return window.location.origin;
  return 'http://localhost:3010';
}

function logGeo(tag: string, payload: Record<string, unknown>): void {
  // Tag aqui chega no formato "[GEO CACHE INVALIDATION]"; opLog adiciona seus próprios colchetes.
  const cleanTag = tag.replace(/^\[/, '').replace(/\]$/, '');
  opLog.diag(cleanTag, payload);
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
  const norm = normalizeOperationalAddressShape({
    street,
    district,
    city,
    state,
    postal_code: postal,
    country,
    formatted,
    formatted_address: formatted,
  });
  return {
    street: norm.street,
    district: norm.district,
    city: norm.city,
    state: norm.state,
    postal_code: norm.postal_code,
    country: norm.country,
    provider,
    resolved_at: operationalGeocodeResolvedAtIso(),
    formatted: norm.formatted,
    reverse_geocode_status: 'ok',
    formatted_address: norm.formatted_address ?? norm.formatted,
  };
}

type NormalizedReverseAddress = {
  street: string | null;
  district: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  country: string | null;
  formatted_address: string | null;
};

function buildFormattedAddress(parts: {
  street?: string | null;
  district?: string | null;
  city?: string | null;
  state?: string | null;
}): string | null {
  const text = [parts.street, parts.district, parts.city, parts.state]
    .filter((v) => Boolean(v && String(v).trim()))
    .join(' — ')
    .trim();
  return text || null;
}

function pickAddressComponent(
  components: Array<{ long_name?: string; short_name?: string; types?: string[] }>,
  targetTypes: string[],
): string | null {
  const found = components.find((c) => (c.types ?? []).some((t) => targetTypes.includes(t)));
  if (!found) return null;
  return String(found.long_name ?? found.short_name ?? '').trim() || null;
}

export function normalizeReverseGeocodeAddress(payload: {
  provider?: string;
  address_parts?: Record<string, unknown> | null;
  response?: unknown;
  address?: string | null;
}): NormalizedReverseAddress {
  const provider = String(payload.provider ?? '').toLowerCase();
  const response = payload.response as Record<string, unknown> | null;
  const fallbackFormatted = String(payload.address ?? '').trim() || null;
  if (provider.includes('google')) {
    const components = Array.isArray(response?.address_components)
      ? (response?.address_components as Array<{ long_name?: string; short_name?: string; types?: string[] }>)
      : [];
    const street = pickAddressComponent(components, ['route']);
    const number = pickAddressComponent(components, ['street_number']);
    const district = pickAddressComponent(components, ['sublocality', 'sublocality_level_1', 'neighborhood', 'administrative_area_level_3']);
    const city = pickAddressComponent(components, ['locality', 'administrative_area_level_2', 'administrative_area_level_1']);
    const state = pickAddressComponent(components, ['administrative_area_level_1']);
    const postalCode = pickAddressComponent(components, ['postal_code']);
    const country = pickAddressComponent(components, ['country']);
    const streetWithNumber = [street, number].filter(Boolean).join(', ') || null;
    const formatted = String(response?.formatted_address ?? fallbackFormatted ?? '').trim() || null;
    const built = buildFormattedAddress({
      street: streetWithNumber,
      district,
      city,
      state,
    });
    const finalFormatted = built || formatted;
    return {
      street: streetWithNumber,
      district,
      city,
      state,
      postal_code: postalCode,
      country,
      formatted_address: finalFormatted,
    };
  }
  if (provider.includes('mapbox')) {
    const features = Array.isArray(response?.features) ? (response?.features as Array<Record<string, unknown>>) : [];
    const first = features[0] ?? null;
    const context = Array.isArray(first?.context) ? (first?.context as Array<Record<string, unknown>>) : [];
    const district = context.find((c) => String(c.id ?? '').startsWith('neighborhood'))?.text;
    const city = context.find((c) => String(c.id ?? '').startsWith('place'))?.text;
    const state = context.find((c) => String(c.id ?? '').startsWith('region'))?.text;
    const postal = context.find((c) => String(c.id ?? '').startsWith('postcode'))?.text;
    const country = context.find((c) => String(c.id ?? '').startsWith('country'))?.text;
    const built = buildFormattedAddress({
      street: String(first?.text ?? '').trim() || null,
      district: String(district ?? '').trim() || null,
      city: String(city ?? '').trim() || null,
      state: String(state ?? '').trim() || null,
    });
    const formatted = String(first?.place_name ?? fallbackFormatted ?? '').trim() || null;
    return {
      street: String(first?.text ?? '').trim() || null,
      district: String(district ?? '').trim() || null,
      city: String(city ?? '').trim() || null,
      state: String(state ?? '').trim() || null,
      postal_code: String(postal ?? '').trim() || null,
      country: String(country ?? '').trim() || null,
      formatted_address: built || formatted,
    };
  }
  const addr = payload.address_parts ?? {};
  const baseStreet =
    addr.road ??
    addr.pedestrian ??
    addr.residential ??
    addr.footway ??
    addr.path ??
    null;
  const street = [baseStreet, addr.house_number].filter(Boolean).map(String).join(', ') || null;
  const district = (addr.suburb ?? addr.neighbourhood ?? addr.city_district ?? addr.quarter ?? null) as string | null;
  const city = (addr.city ?? addr.town ?? addr.municipality ?? addr.village ?? addr.county ?? null) as string | null;
  const state = (addr.state ?? null) as string | null;
  const postal = (addr.postcode ?? addr.postal_code ?? addr.zip ?? null) as string | null;
  const country = (addr.country ?? null) as string | null;
  const formattedAddress = buildFormattedAddress({ street, district, city, state }) || fallbackFormatted;
  const normalized = {
    street,
    district,
    city,
    state,
    postal_code: postal,
    country,
    formatted_address: formattedAddress,
  };
  return normalized;
}

async function fetchFromApi(lat: number, lng: number): Promise<GeocodeSnapshot> {
  const u = new URL('/api/reverse-geocode', getOrigin());
  u.searchParams.set('lat', String(lat));
  u.searchParams.set('lon', String(lng));
  console.info('[GEO REVERSE REQUEST]', { lat, lng, provider: 'api_reverse_geocode', url: u.toString() });
  const res = await fetch(u.toString(), { headers: { Accept: 'application/json' } });
  if (!res.ok) {
    console.info('[GEO REVERSE HTTP ERROR]', { lat, lng, status: res.status, status_text: res.statusText });
    throw new Error(`reverse_geocode_http_${res.status}`);
  }
  const data = (await res.json()) as {
    address?: string;
    address_parts?: Record<string, unknown> | null;
    provider?: string;
    status?: 'ok' | 'partial' | 'timeout' | 'provider_error';
    response?: unknown;
  };
  console.info('[GEO REVERSE RAW RESPONSE]', {
    lat,
    lng,
    provider: data.provider ?? 'unknown',
    response: data.response ?? data,
  });
  console.info('[GEO REVERSE RESPONSE]', {
    lat,
    lng,
    provider: data.provider ?? 'unknown',
    response: data,
  });
  const normalized = normalizeReverseGeocodeAddress({
    provider: data.provider,
    address_parts: data.address_parts,
    response: data.response,
    address: data.address,
  });
  console.info('[GEO ADDRESS PARSED]', {
    lat,
    lng,
    street: normalized.street,
    district: normalized.district,
    city: normalized.city,
    state: normalized.state,
    postal_code: normalized.postal_code,
  });
  const hasAnyAddressPart = Boolean(
    normalized.street ||
      normalized.district ||
      normalized.city ||
      normalized.state ||
      normalized.postal_code ||
      normalized.country ||
      normalized.formatted_address,
  );
  if (data.status === 'timeout') {
    console.info('[GEO PROVIDER TIMEOUT]', { lat, lng, provider: data.provider ?? 'unknown' });
  }
  const finalAddress = finalizeGeocodeSnapshotWithNormalizer(lat, lng, data.provider || 'nominatim', {
    street: normalized.street,
    district: normalized.district,
    city: normalized.city,
    state: normalized.state,
    postal_code: normalized.postal_code,
    country: normalized.country,
    provider: data.provider || 'nominatim',
    resolved_at: '',
    formatted: normalized.formatted_address || '',
    formatted_address: normalized.formatted_address,
    reverse_geocode_status: data.status ?? (hasAnyAddressPart ? 'ok' : 'partial'),
  });
  console.info('[GEO ADDRESS FINAL]', {
    lat,
    lng,
    street: finalAddress.street,
    district: finalAddress.district,
    city: finalAddress.city,
    state: finalAddress.state,
    postal_code: finalAddress.postal_code,
    formatted_address: finalAddress.formatted_address,
    provider: finalAddress.provider,
    status: finalAddress.reverse_geocode_status,
  });
  console.info('[GEO FORMATTED ADDRESS]', {
    lat,
    lng,
    formatted_address: finalAddress.formatted_address,
  });
  console.info('[GEO POSTAL CODE]', {
    lat,
    lng,
    postal_code: finalAddress.postal_code,
  });
  return finalAddress;
}

async function fetchDirectFromNominatim(lat: number, lng: number): Promise<GeocodeSnapshot> {
  const url = new URL('https://nominatim.openstreetmap.org/reverse');
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('lat', String(lat));
  url.searchParams.set('lon', String(lng));
  url.searchParams.set('accept-language', 'pt-BR');
  console.info('[GEO REVERSE REQUEST]', {
    lat,
    lng,
    provider: 'nominatim_direct',
    url: url.toString(),
  });
  console.info('[GEO REVERSE DIRECT PROVIDER FALLBACK]', { lat, lng, url: url.toString() });
  const res = await fetch(url.toString(), { headers: { Accept: 'application/json' } });
  if (!res.ok) {
    throw new Error(`reverse_geocode_direct_http_${res.status}`);
  }
  const response = (await res.json()) as Record<string, unknown>;
  console.info('[GEO REVERSE RAW RESPONSE]', {
    lat,
    lng,
    provider: 'nominatim_direct',
    response,
  });
  console.info('[GEO REVERSE RESPONSE]', {
    lat,
    lng,
    provider: 'nominatim_direct',
    response,
  });
  const normalized = normalizeReverseGeocodeAddress({
    provider: 'nominatim',
    address_parts: (response.address as Record<string, unknown> | undefined) ?? null,
    response,
    address: String(response.display_name ?? ''),
  });
  console.info('[GEO ADDRESS PARSED]', {
    lat,
    lng,
    street: normalized.street,
    district: normalized.district,
    city: normalized.city,
    state: normalized.state,
    postal_code: normalized.postal_code,
  });
  const hasAnyAddressPart = Boolean(
    normalized.street ||
      normalized.district ||
      normalized.city ||
      normalized.state ||
      normalized.postal_code ||
      normalized.country ||
      normalized.formatted_address,
  );
  const finalAddress = finalizeGeocodeSnapshotWithNormalizer(lat, lng, 'nominatim_direct', {
    street: normalized.street,
    district: normalized.district,
    city: normalized.city,
    state: normalized.state,
    postal_code: normalized.postal_code,
    country: normalized.country,
    provider: 'nominatim_direct',
    resolved_at: '',
    formatted: normalized.formatted_address || '',
    formatted_address: normalized.formatted_address,
    reverse_geocode_status: hasAnyAddressPart ? 'ok' : 'partial',
  });
  console.info('[GEO ADDRESS FINAL]', {
    lat,
    lng,
    street: finalAddress.street,
    district: finalAddress.district,
    city: finalAddress.city,
    state: finalAddress.state,
    postal_code: finalAddress.postal_code,
    formatted_address: finalAddress.formatted_address,
    provider: finalAddress.provider,
    status: finalAddress.reverse_geocode_status,
  });
  console.info('[GEO FORMATTED ADDRESS]', {
    lat,
    lng,
    formatted_address: finalAddress.formatted_address,
  });
  console.info('[GEO POSTAL CODE]', {
    lat,
    lng,
    postal_code: finalAddress.postal_code,
  });
  return finalAddress;
}

let reverseGeoCacheIsolationBootstrapped = false;
let reverseGeoCacheDevResetDone = false;
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
  if (import.meta.env?.DEV && !reverseGeoCacheDevResetDone) {
    reverseGeoCacheDevResetDone = true;
    CACHE.clear();
    IN_FLIGHT.clear();
    logGeo('[GEO CACHE INVALIDATION]', { reason: 'dev_boot_clear_legacy', version: VERSION });
  }
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
  if (!key) {
    logGeo('[GEO CACHE BYPASS]', {
      reason: 'missing_tenant_scope',
      lat,
      lng,
      company_id: scope.companyId,
      user_id: scope.userId,
    });
  }
  const cached = key ? CACHE.get(key) : null;
  if (key && cached) {
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
    logGeo('[GEO CACHE HIT]', { lat, lng, key, source: 'app', hit: true, version: VERSION });
    finalizeOperationalTrace(trace.trace_id);
    return { snapshot: cached, cacheHit: true };
  }
  recordOperationalMetric('cache_hit_ratio', 0, {
    company_id: scope.companyId,
    employee_id: scope.userId,
    source: 'reverse_geocode',
    operation_type: 'cache',
  });
  const pending = key ? IN_FLIGHT.get(key) : null;
  if (key && pending) {
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
          try {
            return await fetchFromApi(lat, lng);
          } catch (apiError) {
            console.error('[GEO REVERSE ERROR RAW]', apiError);
            console.error('[GEO REVERSE ERROR DETAILS]', {
              name: apiError instanceof Error ? apiError.name : null,
              message: apiError instanceof Error ? apiError.message : String(apiError),
              stack: apiError instanceof Error ? apiError.stack : null,
              cause:
                apiError instanceof Error
                  ? (apiError as Error & { cause?: unknown }).cause ?? null
                  : null,
              lat,
              lng,
              provider: 'api_reverse_geocode',
            });
            console.info('[GEO REVERSE API FALLBACK]', {
              lat,
              lng,
              error: apiError instanceof Error ? apiError.message : String(apiError),
            });
            return await fetchDirectFromNominatim(lat, lng);
          }
        } catch (error) {
          if (attempt < 3) {
            await new Promise((resolve) => setTimeout(resolve, retryBackoff.computeDelayMs(attempt)));
            try {
              return await fetchFromApi(lat, lng);
            } catch (apiError) {
              console.error('[GEO REVERSE ERROR RAW]', apiError);
              console.error('[GEO REVERSE ERROR DETAILS]', {
                name: apiError instanceof Error ? apiError.name : null,
                message: apiError instanceof Error ? apiError.message : String(apiError),
                stack: apiError instanceof Error ? apiError.stack : null,
                cause:
                  apiError instanceof Error
                    ? (apiError as Error & { cause?: unknown }).cause ?? null
                    : null,
                lat,
                lng,
                provider: 'api_reverse_geocode',
              });
              console.info('[GEO REVERSE API FALLBACK]', {
                lat,
                lng,
                error: apiError instanceof Error ? apiError.message : String(apiError),
                retry_attempt: attempt,
              });
              return fetchDirectFromNominatim(lat, lng);
            }
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
    if (key) {
      CACHE.set(key, snap);
      logGeo('[GEO CACHE ISOLATION]', { lat, lng, provider: snap.provider, key, version: VERSION, source: 'app' });
    }
    return snap;
  })();
  if (key) {
    IN_FLIGHT.set(key, run);
  }
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
    console.info('[GEO REVERSE FETCH ERROR]', {
      lat,
      lng,
      error: error instanceof Error ? error.message : String(error),
    });
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
    if (key) {
      IN_FLIGHT.delete(key);
    }
  }
}

export function clearGeocodeCache(): void {
  CACHE.clear();
  IN_FLIGHT.clear();
  logGeo('[GEO CACHE INVALIDATION]', { source: 'app', cache: 'reverse_geocode' });
}

