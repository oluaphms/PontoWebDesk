/**
 * Proteção contra rajadas de queries / invalidações (custo em produção).
 */

import type { QueryClient, InvalidateQueryFilters, RefetchQueryFilters } from '@tanstack/react-query';
import { recordRealtimeInvalidateBurst } from './realtimeLoadShedding';

type KeyStat = { count: number; windowStart: number };
const FETCH_COUNTS = new Map<string, KeyStat>();
const DUP_TRACK = new Map<string, number>();
const WINDOW_MS = 60_000;
const STORM_PER_MIN = 120;
const DUP_THRESHOLD = 6;

let patched = false;

function minuteWindowKey(): string {
  return String(Math.floor(Date.now() / WINDOW_MS));
}

function stableKeyLabel(key: unknown): string {
  try {
    return JSON.stringify(key);
  } catch {
    return String(key);
  }
}

function bumpFetch(queryKey: readonly unknown[] | undefined): void {
  if (!queryKey) return;
  const label = stableKeyLabel(queryKey);
  const wk = minuteWindowKey();
  const mapKey = `${wk}::${label}`;
  const cur = FETCH_COUNTS.get(mapKey) ?? { count: 0, windowStart: Date.now() };
  cur.count += 1;
  FETCH_COUNTS.set(mapKey, cur);

  const dup = (DUP_TRACK.get(label) ?? 0) + 1;
  DUP_TRACK.set(label, dup);
  if (dup === DUP_THRESHOLD) {
    console.warn('[DUPLICATE QUERY]', { queryKey: label.slice(0, 240), hits: dup });
  }

  let sum = 0;
  for (const [k, v] of FETCH_COUNTS) {
    if (k.startsWith(`${wk}::`)) sum += v.count;
  }
  if (sum === STORM_PER_MIN || sum === STORM_PER_MIN * 2) {
    console.warn('[QUERY STORM]', { approx_observations: sum, window_ms: WINDOW_MS });
  }
}

export function getQueryCostTopKeys(limit = 12): Array<{ key: string; count: number }> {
  const wk = minuteWindowKey();
  const rows: Array<{ key: string; count: number }> = [];
  for (const [k, v] of FETCH_COUNTS) {
    if (!k.startsWith(`${wk}::`)) continue;
    const key = k.slice(`${wk}::`.length);
    rows.push({ key, count: v.count });
  }
  return rows.sort((a, b) => b.count - a.count).slice(0, limit);
}

export function patchQueryCostGuard(queryClient: QueryClient): void {
  if (patched) return;
  patched = true;

  const origInv = queryClient.invalidateQueries.bind(queryClient);
  queryClient.invalidateQueries = async (filters?: InvalidateQueryFilters, options?: unknown) => {
    const key = filters?.queryKey as readonly unknown[] | undefined;
    recordRealtimeInvalidateBurst(1);
    const label = key ? stableKeyLabel(key) : 'all';
    const statKey = `inv:${minuteWindowKey()}::${label}`;
    const cur = FETCH_COUNTS.get(statKey) ?? { count: 0, windowStart: Date.now() };
    cur.count += 1;
    FETCH_COUNTS.set(statKey, cur);
    if (cur.count === 40 || cur.count === 80) {
      console.warn('[QUERY COST HIGH]', { kind: 'invalidate', count: cur.count, queryKey: label.slice(0, 200) });
    }
    return origInv(filters as never, options as never);
  };

  const origRefetch = queryClient.refetchQueries.bind(queryClient);
  queryClient.refetchQueries = async (filters?: RefetchQueryFilters, options?: unknown) => {
    const key = filters?.queryKey as readonly unknown[] | undefined;
    recordRealtimeInvalidateBurst(1);
    bumpFetch(key);
    return origRefetch(filters as never, options as never);
  };
}
