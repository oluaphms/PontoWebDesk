/**
 * Persistência da DLQ operacional (`operational_dead_letters`).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  OperationalDeadLetterPayloadV1,
  OperationalDeadLetterRow,
  OperationalDeadLetterStatus,
} from '../domain/operational/recovery/operationalDeadLetterQueue';

export async function insertOperationalDeadLetter(input: {
  companyId: string;
  operationId: string;
  correlationId: string;
  failedStage: string;
  payload: OperationalDeadLetterPayloadV1 | Record<string, unknown>;
  retryable: boolean;
  nextRetryAtIso: string | null;
  supabaseClient: SupabaseClient;
}): Promise<{ ok: boolean; duplicate?: boolean; error?: string }> {
  const row = {
    company_id: input.companyId.trim(),
    operation_id: input.operationId.trim(),
    correlation_id: input.correlationId.trim(),
    failed_stage: input.failedStage,
    payload: input.payload as Record<string, unknown>,
    retryable: input.retryable,
    status: 'pending' as const,
    next_retry_at: input.nextRetryAtIso,
    updated_at: new Date().toISOString(),
  };

  const { error } = await input.supabaseClient.from('operational_dead_letters').insert(row);
  if (error) {
    if (String(error.code) === '23505' || /duplicate key/i.test(error.message)) {
      return { ok: true, duplicate: true };
    }
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

export async function countOpenOperationalDeadLetters(
  client: SupabaseClient,
  companyId: string,
): Promise<number> {
  const { count, error } = await client
    .from('operational_dead_letters')
    .select('id', { count: 'exact', head: true })
    .eq('company_id', companyId.trim())
    .in('status', ['pending', 'retrying']);
  if (error) return 0;
  return count ?? 0;
}

export async function listOperationalDeadLettersForCompany(
  client: SupabaseClient,
  companyId: string,
  opts?: { limit?: number; status?: OperationalDeadLetterStatus | null },
): Promise<OperationalDeadLetterRow[]> {
  const lim = Math.min(500, Math.max(1, opts?.limit ?? 100));
  let q = client
    .from('operational_dead_letters')
    .select(
      'id,company_id,operation_id,correlation_id,failed_stage,payload,retry_count,retryable,status,last_error,next_retry_at,created_at,updated_at,recovered_at',
    )
    .eq('company_id', companyId.trim())
    .order('created_at', { ascending: false })
    .limit(lim);
  if (opts?.status) q = q.eq('status', opts.status);
  const { data, error } = await q;
  if (error || !data) return [];
  return data as OperationalDeadLetterRow[];
}

export async function claimOperationalDeadLetterRow(
  client: SupabaseClient,
  id: string,
  companyId: string,
): Promise<OperationalDeadLetterRow | null> {
  const { data: row, error: selErr } = await client
    .from('operational_dead_letters')
    .select(
      'id,company_id,operation_id,correlation_id,failed_stage,payload,retry_count,retryable,status,last_error,next_retry_at,created_at,updated_at,recovered_at',
    )
    .eq('id', id)
    .eq('company_id', companyId.trim())
    .eq('status', 'pending')
    .maybeSingle();
  if (selErr || !row) return null;
  const r = row as OperationalDeadLetterRow;
  if (r.next_retry_at && new Date(r.next_retry_at).getTime() > Date.now()) return null;

  const now = new Date().toISOString();
  const { data: updated, error: upErr } = await client
    .from('operational_dead_letters')
    .update({
      status: 'retrying',
      updated_at: now,
    })
    .eq('id', id)
    .eq('company_id', companyId.trim())
    .eq('status', 'pending')
    .select(
      'id,company_id,operation_id,correlation_id,failed_stage,payload,retry_count,retryable,status,last_error,next_retry_at,created_at,updated_at,recovered_at',
    )
    .maybeSingle();
  if (upErr || !updated) return null;
  return updated as OperationalDeadLetterRow;
}

export async function markOperationalDeadLetterRecovered(
  client: SupabaseClient,
  id: string,
  companyId: string,
): Promise<void> {
  const now = new Date().toISOString();
  await client
    .from('operational_dead_letters')
    .update({
      status: 'recovered',
      recovered_at: now,
      updated_at: now,
    })
    .eq('id', id)
    .eq('company_id', companyId.trim());
}

export async function markOperationalDeadLetterFailed(
  client: SupabaseClient,
  id: string,
  companyId: string,
  lastError: string,
): Promise<void> {
  const now = new Date().toISOString();
  await client
    .from('operational_dead_letters')
    .update({
      status: 'failed',
      last_error: lastError.slice(0, 2000),
      updated_at: now,
    })
    .eq('id', id)
    .eq('company_id', companyId.trim());
}

export async function requeueOperationalDeadLetter(
  client: SupabaseClient,
  id: string,
  companyId: string,
  input: { retryCount: number; lastError: string; nextRetryAtIso: string | null },
): Promise<void> {
  const now = new Date().toISOString();
  await client
    .from('operational_dead_letters')
    .update({
      status: 'pending',
      retry_count: input.retryCount,
      last_error: input.lastError.slice(0, 2000),
      next_retry_at: input.nextRetryAtIso,
      updated_at: now,
    })
    .eq('id', id)
    .eq('company_id', companyId.trim());
}

export async function ignoreOperationalDeadLetter(
  client: SupabaseClient,
  id: string,
  companyId: string,
): Promise<void> {
  const now = new Date().toISOString();
  await client
    .from('operational_dead_letters')
    .update({ status: 'ignored', updated_at: now })
    .eq('id', id)
    .eq('company_id', companyId.trim());
}
