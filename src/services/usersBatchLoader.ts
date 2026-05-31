import { observabilityConsole } from '../shared/logger/observabilityConsole';
/**
 * Carrega usuários por empresa em lotes com timeout curto (performance).
 */

import { getSupabaseClient } from './supabaseClient';
import { withTimeout } from '../utils/withTimeout';
import { isCloudEnabled } from './cloudService';
import { cloudFallback } from './cloudFallback';
import { listCachedEmployeesByCompany } from './localDb';

const BATCH_LIMIT = 100;
const BATCH_TIMEOUT_MS = 10_000;

export type UserBatchRow = {
  id: string;
  company_id: string;
  status?: string | null;
  role?: string | null;
  nome?: string | null;
};

/** Paginação por empresa: select explícito + eq company_id + limit 100. */
export async function loadUsersBatchesForCompany(
  companyId: string,
  onBatch: (rows: UserBatchRow[]) => void | Promise<void>,
): Promise<void> {
  if (!isCloudEnabled()) {
    const cached = await listCachedEmployeesByCompany(companyId);
    await onBatch(cached as UserBatchRow[]);
    return;
  }
  const client = getSupabaseClient();
  if (!client || !companyId) return;

  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const start = Date.now();
    const controller = new AbortController();

    let batch: UserBatchRow[] = [];
    try {
      const res = await withTimeout(
        client
          .from('users')
          .select('id, company_id, status, role')
          .eq('company_id', companyId)
          .range(offset, offset + BATCH_LIMIT - 1)
          .abortSignal(controller.signal),
        BATCH_TIMEOUT_MS,
        `users_batch(${companyId})`,
      );
      if (res.error) {
        observabilityConsole.info('[DB PERF] users_batch_loaded', {
          company_id: companyId,
          count: 0,
          duration_ms: Date.now() - start,
          error: res.error.message,
        });
        break;
      }
      batch = (res.data ?? []) as UserBatchRow[];
    } catch (e) {
      controller.abort();
      observabilityConsole.info('[DB PERF] users_batch_loaded', {
        company_id: companyId,
        count: 0,
        duration_ms: Date.now() - start,
        error: e instanceof Error ? e.message : String(e),
      });
      break;
    }

    observabilityConsole.info('[DB PERF] users_batch_loaded', {
      company_id: companyId,
      count: batch.length,
      duration_ms: Date.now() - start,
      offset,
    });

    if (batch.length) {
      await onBatch(batch);
    }

    hasMore = batch.length === BATCH_LIMIT;
    offset += batch.length;
    if (!batch.length) hasMore = false;
  }
}

/** Coleta company_ids para jobs multi-tenant (scan paginado apenas de company_id). */
export async function collectDistinctCompanyIdsFromUsers(): Promise<string[]> {
  if (!isCloudEnabled()) return cloudFallback([]);
  const client = getSupabaseClient();
  if (!client) return [];

  const seen = new Set<string>();
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const start = Date.now();
    const controller = new AbortController();
    try {
      const res = await withTimeout(
        client
          .from('users')
          .select('company_id')
          .not('company_id', 'is', null)
          .range(offset, offset + BATCH_LIMIT - 1)
          .abortSignal(controller.signal),
        BATCH_TIMEOUT_MS,
        'users_company_scan',
      );
      if (res.error) break;
      const rows = (res.data ?? []) as { company_id?: string | null }[];

      observabilityConsole.info('[DB PERF] users_batch_loaded', {
        phase: 'distinct_company_scan',
        count: rows.length,
        duration_ms: Date.now() - start,
        offset,
      });

      for (const r of rows) {
        const cid = r.company_id ? String(r.company_id).trim() : '';
        if (cid) seen.add(cid);
      }

      hasMore = rows.length === BATCH_LIMIT;
      offset += rows.length;
      if (!rows.length) hasMore = false;
    } catch {
      controller.abort();
      break;
    }
  }

  return [...seen];
}
