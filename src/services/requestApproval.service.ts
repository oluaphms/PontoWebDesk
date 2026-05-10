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
  const { error } = await client.rpc('insert_time_record_for_user', {
    p_user_id: params.userId,
    p_company_id: params.companyId,
    p_type: params.dbType,
    p_method: 'admin',
    p_source: 'request',
    p_timestamp: params.timestampIso,
    p_manual_reason: `Aprovado via solicitação ${params.requestId}: ${params.reason}`,
  });
  if (error) throw error;
}
