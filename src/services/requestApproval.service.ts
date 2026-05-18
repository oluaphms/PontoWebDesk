import type { SupabaseClient } from '@supabase/supabase-js';

export async function registerApprovedAdjustmentPunch(
  client: SupabaseClient,
  params: {
    userId: string;
    companyId: string;
    dbType: string;
    timestampIso: string;
    requestId: string;
    reason: string;
  },
): Promise<void> {
  const { data, error } = await client.rpc('insert_time_record_for_user', {
    p_user_id: params.userId,
    p_company_id: params.companyId,
    p_type: params.dbType,
    p_method: 'admin',
    p_source: 'request',
    p_timestamp: params.timestampIso,
    p_manual_reason: `Aprovado via solicitação ${params.requestId}: ${params.reason}`,
  });
  if (!error && data && typeof data === 'object') return;

  const msg = String(error?.message ?? '').toLowerCase();
  const useFallback =
    error &&
    (error.code === '42883' ||
      error.code === 'PGRST202' ||
      msg.includes('does not exist') ||
      msg.includes('could not find the function') ||
      (msg.includes('operator does not exist') && msg.includes('uuid')));

  if (!useFallback) {
    if (error) throw error;
    return;
  }

  const { error: insertError } = await client.from('time_records').insert({
    user_id: params.userId,
    company_id: params.companyId,
    type: params.dbType,
    method: 'admin',
    source: 'request',
    timestamp: params.timestampIso,
    created_at: params.timestampIso,
    updated_at: params.timestampIso,
    is_manual: true,
    manual_reason: `Aprovado via solicitação ${params.requestId}: ${params.reason}`,
  });
  if (insertError) throw insertError;
}
