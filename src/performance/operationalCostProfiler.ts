/**
 * Governança de custo operacional — agregados em memória (sem PII).
 */

type Counter = { n: number; sum: number };

const supabaseReads = createCounter();
const supabaseWrites = createCounter();
const realtimeMessages = createCounter();
let idbBytesEstimate = 0;
let queryCacheEntries = 0;
let lastAggregateLog = 0;

function createCounter(): Counter {
  return { n: 0, sum: 0 };
}

function bump(c: Counter, delta = 1): void {
  c.n += 1;
  c.sum += delta;
}

export const operationalCostProfiler = {
  recordSupabaseRead(rowsHint = 1): void {
    bump(supabaseReads, rowsHint);
  },

  recordSupabaseWrite(opsHint = 1): void {
    bump(supabaseWrites, opsHint);
  },

  recordRealtimeIngress(messages = 1): void {
    bump(realtimeMessages, messages);
  },

  /** Estimativa grosseira após operação IndexedDB (bytes). */
  setIndexedDbFootprintEstimate(bytes: number): void {
    if (Number.isFinite(bytes) && bytes >= 0) idbBytesEstimate = Math.round(bytes);
  },

  setQueryCacheEntryCount(count: number): void {
    if (Number.isFinite(count) && count >= 0) queryCacheEntries = Math.round(count);
  },

  snapshot(): Record<string, unknown> {
    return {
      supabase_reads: { calls: supabaseReads.n, rows_hint: supabaseReads.sum },
      supabase_writes: { calls: supabaseWrites.n, ops_hint: supabaseWrites.sum },
      realtime_ingress: { batches: realtimeMessages.n, messages: realtimeMessages.sum },
      idb_bytes_estimate: idbBytesEstimate,
      query_cache_entries: queryCacheEntries,
    };
  },

  maybeLogAggregate(intervalMs = 300_000): void {
    const t = Date.now();
    if (t - lastAggregateLog < intervalMs) return;
    lastAggregateLog = t;
    if (supabaseReads.n === 0 && supabaseWrites.n === 0 && realtimeMessages.n === 0) return;
    console.info('[OPERATIONAL COST AGG]', this.snapshot());
  },
};
