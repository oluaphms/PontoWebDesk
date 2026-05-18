import type { SupabaseClient } from '@supabase/supabase-js';
import { insertTimeRecordForUserWithFallback } from '../../services/insertTimeRecordRpc';

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
  await insertTimeRecordForUserWithFallback(client, {
    userId: params.userId,
    companyId: params.companyId,
    type: params.dbType,
    timestampIso: params.timestampIso,
    method: 'admin',
    source: 'request',
    manualReason: `Aprovado via solicitação ${params.requestId}: ${params.reason}`,
  });
}
