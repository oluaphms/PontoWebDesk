/**
 * RPC `insert_time_record_for_user` + fallback insert direto em `time_records`.
 * Centraliza detecção de RPC indisponível (404 / overload / uuid=text).
 */

import type { SupabaseClient } from '@supabase/supabase-js';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function assertValidUuid(id: string, label: string): string {
  const trimmed = String(id ?? '').trim();
  if (!UUID_RE.test(trimmed)) {
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

  const { data: rpcData, error: rpcError } = await client.rpc('insert_time_record_for_user', {
    p_user_id: userId,
    p_company_id: companyId,
    p_type: type,
    p_method: params.method ?? 'admin',
    p_location: params.location ?? null,
    p_photo_url: params.photoUrl ?? null,
    p_source: params.source ?? 'manual',
    p_timestamp: timestampIso,
    p_latitude: params.latitude ?? null,
    p_longitude: params.longitude ?? null,
    p_accuracy: params.accuracy ?? null,
    p_device_id: params.deviceId ?? null,
    p_device_type: params.deviceType ?? null,
    p_ip_address: params.ipAddress ?? null,
    p_fraud_score: params.fraudScore ?? 0,
    p_fraud_flags: params.fraudFlags ?? [],
    p_manual_reason: params.manualReason ?? null,
  });

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
    if (typeof import.meta !== 'undefined' && import.meta.env?.DEV) {
      console.warn('[insertTimeRecordRpc] fallback insert:', rpcError);
    }
  }

  const mergeId = crypto.randomUUID();
  const row = {
    id: mergeId,
    user_id: userId,
    company_id: companyId,
    type,
    method: params.method ?? 'admin',
    source: params.source ?? 'manual',
    timestamp: timestampIso,
    created_at: timestampIso,
    updated_at: timestampIso,
    is_manual: true,
    manual_reason: params.manualReason ?? null,
    location: params.location ?? null,
    photo_url: params.photoUrl ?? null,
    latitude: params.latitude ?? null,
    longitude: params.longitude ?? null,
    accuracy: params.accuracy ?? null,
    device_id: params.deviceId ?? null,
    device_type: params.deviceType ?? null,
    ip_address: params.ipAddress ?? null,
    fraud_score: params.fraudScore ?? 0,
    fraud_flags: params.fraudFlags ?? [],
  };

  const { error: insertError } = await client.from('time_records').insert(row);
  if (insertError) {
    console.error('[TIME RECORD ERROR]', insertError);
    throw new Error(`time_records.insert: ${insertError.message}`);
  }

  return { id: mergeId, timestamp: timestampIso, via: 'insert' };
}
