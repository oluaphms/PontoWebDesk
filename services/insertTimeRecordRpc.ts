/**
 * RPC `insert_time_record_for_user` (4 params) + fallback insert em `time_records`.
 * Anti-42883: UUID validado no TS; RPC com assinatura única; fallback com payload mínimo.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function assertValidUuid(id: string, label: string): string {
  const trimmed = String(id ?? '').trim();
  if (!trimmed || !UUID_RE.test(trimmed)) {
    throw new Error(`${label} inválido (UUID esperado).`);
  }
  return trimmed;
}

export function isInsertTimeRecordRpcUnavailable(
  error: { code?: string; message?: string; status?: number } | null,
): boolean {
  if (!error) return false;
  const code = String(error.code ?? '');
  const msg = String(error.message ?? '').toLowerCase();
  const status = Number(error.status ?? 0);
  if (
    code === '42883' ||
    code === 'PGRST202' ||
    code === 'PGRST203' ||
    code === 'PGRST204' ||
    code === '404' ||
    status === 404
  ) {
    return true;
  }
  if (msg.includes('could not find the function') || msg.includes('does not exist')) return true;
  if (msg.includes('could not choose the best candidate')) return true;
  if (msg.includes('not found') && msg.includes('function')) return true;
  if (msg.includes('operator does not exist') && msg.includes('uuid')) return true;
  return false;
}

export type InsertTimeRecordRpcParams = {
  userId: string;
  companyId: string;
  type: string;
  timestampIso: string;
  method?: string;
  source?: string;
  manualReason?: string | null;
  location?: Record<string, unknown> | null;
  photoUrl?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  accuracy?: number | null;
  deviceId?: string | null;
  deviceType?: string | null;
  ipAddress?: string | null;
  fraudScore?: number;
  fraudFlags?: unknown;
};

export type InsertTimeRecordRpcResult = {
  id: string;
  timestamp: string;
  via: 'rpc' | 'insert';
};

export function parseInsertTimeRecordRpcResult(
  rpcData: unknown,
): { id: string; timestamp?: string | number | null } | null {
  if (!rpcData || typeof rpcData !== 'object') return null;
  const row = rpcData as Record<string, unknown>;
  const rawId = row.record_id ?? row.id;
  if (rawId == null || String(rawId).trim() === '') return null;
  return {
    id: String(rawId),
    timestamp: row.timestamp as string | number | null | undefined,
  };
}

function resolveTimestampFromRpc(
  fallbackIso: string,
  rpcTimestamp: string | number | null | undefined,
): string {
  if (typeof rpcTimestamp === 'string' && rpcTimestamp.trim()) return rpcTimestamp;
  if (rpcTimestamp != null && (typeof rpcTimestamp === 'number' || typeof rpcTimestamp === 'object')) {
    return new Date(rpcTimestamp as number | Date).toISOString();
  }
  return fallbackIso;
}

/** Payload REST alinhado ao schema (user_id text, company_id uuid, method NOT NULL). */
export function buildTimeRecordInsertRow(
  params: InsertTimeRecordRpcParams & { userId: string; companyId: string },
): Record<string, unknown> {
  const userId = params.userId;
  const companyId = params.companyId;
  const type = String(params.type ?? '').trim();
  const timestampIso = String(params.timestampIso ?? '').trim();
  const recordId = crypto.randomUUID();

  const row: Record<string, unknown> = {
    id: recordId,
    user_id: userId,
    company_id: companyId,
    timestamp: timestampIso,
    type,
    source: params.source ?? 'manual',
    method: params.method ?? 'admin',
    created_at: timestampIso,
    updated_at: timestampIso,
    is_manual: true,
  };

  if (params.manualReason != null && String(params.manualReason).trim()) {
    row.manual_reason = String(params.manualReason).trim();
  }
  if (params.location != null) row.location = params.location;
  if (params.photoUrl != null) row.photo_url = params.photoUrl;
  if (params.latitude != null) row.latitude = params.latitude;
  if (params.longitude != null) row.longitude = params.longitude;
  if (params.accuracy != null) row.accuracy = params.accuracy;
  if (params.deviceId != null) row.device_id = params.deviceId;
  if (params.deviceType != null) row.device_type = params.deviceType;
  if (params.ipAddress != null) row.ip_address = params.ipAddress;
  if (params.fraudScore != null) row.fraud_score = params.fraudScore;
  if (params.fraudFlags != null) row.fraud_flags = params.fraudFlags;

  return row;
}

export async function insertTimeRecordForUserWithFallback(
  client: SupabaseClient,
  params: InsertTimeRecordRpcParams,
): Promise<InsertTimeRecordRpcResult> {
  const userId = assertValidUuid(params.userId, 'user_id');
  const companyId = assertValidUuid(params.companyId, 'company_id');
  const type = String(params.type ?? '').trim();
  const timestampIso = String(params.timestampIso ?? '').trim();
  if (!type || !timestampIso) {
    throw new Error('type e timestamp são obrigatórios.');
  }

  const rpcPayload = {
    p_user_id: userId,
    p_company_id: companyId,
    p_timestamp: timestampIso,
    p_type: type,
  };

  const { data: rpcData, error: rpcError } = await client.rpc(
    'insert_time_record_for_user',
    rpcPayload,
  );

  if (!rpcError) {
    const parsed = parseInsertTimeRecordRpcResult(rpcData);
    if (parsed) {
      return {
        id: parsed.id,
        timestamp: resolveTimestampFromRpc(timestampIso, parsed.timestamp),
        via: 'rpc',
      };
    }
  }

  if (rpcError) {
    console.error('[TIME RECORD ERROR]', rpcError);
    if (!isInsertTimeRecordRpcUnavailable(rpcError)) {
      throw new Error(`insert_time_record_for_user: ${rpcError.message}`);
    }
    console.warn('[RPC FAILED] tentando insert direto', rpcError);
  }

  const row = buildTimeRecordInsertRow({
    ...params,
    userId,
    companyId,
    type,
    timestampIso,
  });
  const recordId = String(row.id);

  const { error: insertError } = await client.from('time_records').insert(row);
  if (insertError) {
    console.error('[TIME RECORD ERROR]', insertError);
    throw new Error(`time_records.insert: ${insertError.message}`);
  }

  return { id: recordId, timestamp: timestampIso, via: 'insert' };
}
