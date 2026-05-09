import type { QueryClient, InvalidateQueryFilters } from '@tanstack/react-query';
import { isPostLoginQueryCooldownActive, isCriticalReactQueryKey } from '../app/postLoginQueryGate';
import { reportDeviceOperationalReputationFromMonitoringContext } from '../services/deviceOperationalReputation.service';
import { reportGeoCircuitSignal } from '../domain/operational/geo/geoOperationalCircuitBreaker';

type InvalidationRecord = { t: number; kind: string; detail: string };

const WINDOW_MS = 2000;
const STORM_THRESHOLD = 8;

const recent: InvalidationRecord[] = [];

function trim(now: number): void {
  while (recent.length && now - recent[0].t > WINDOW_MS) {
    recent.shift();
  }
}

function bump(kind: string, detail: string): void {
  const t = Date.now();
  recent.push({ t, kind, detail });
  trim(t);
  if (recent.length >= STORM_THRESHOLD && typeof console !== 'undefined') {
    console.warn('[QUERY INVALIDATION STORM]', {
      count: recent.length,
      windowMs: WINDOW_MS,
      threshold: STORM_THRESHOLD,
      sample: recent.slice(-6),
    });
    reportGeoCircuitSignal('stream_congestion');
    reportDeviceOperationalReputationFromMonitoringContext('query_invalidation_storm');
  }
}

export function recordMemoryCacheInvalidation(prefix: string, removed: number): void {
  if (removed <= 0) return;
  bump('memory_cache', `${prefix} (${removed})`);
}

let patched = false;

export function patchQueryClientInvalidationAudit(queryClient: QueryClient): void {
  if (patched) return;
  patched = true;
  const orig = queryClient.invalidateQueries.bind(queryClient);
  queryClient.invalidateQueries = async (filters?: InvalidateQueryFilters, options?: unknown) => {
    if (isPostLoginQueryCooldownActive()) {
      const key = filters?.queryKey as readonly unknown[] | undefined;
      if (!isCriticalReactQueryKey(key)) {
        if (typeof console !== 'undefined') {
          console.info('[QUERY INVALIDATION COOLDOWN SKIP]', {
            queryKey: key !== undefined ? JSON.stringify(key).slice(0, 200) : undefined,
          });
        }
        return Promise.resolve();
      }
    }
    try {
      const key = filters?.queryKey;
      const detail =
        key !== undefined ? `queryKey:${JSON.stringify(key).slice(0, 240)}` : JSON.stringify(filters ?? {}).slice(0, 200);
      bump('react_query', detail);
    } catch {
      bump('react_query', 'unknown');
    }
    return orig(filters as never, options as never);
  };
}
