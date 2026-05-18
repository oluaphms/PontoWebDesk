/**
 * RPC `insert_time_record_for_user` — assinatura canônica (6 params) + fallback REST.
 * Envia todos os parâmetros na RPC para evitar PGRST203 (ambiguidade PostgREST).
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
  if (msg.includes('could not choose the best candidate') || msg.includes('best candidate')) return true;
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
  fraudScore?: number | null;
  fraudFlags?: unknown | null;
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

/** Payload REST mínimo (fallback) — method NOT NULL no schema. */
export function buildTimeRecordInsertRow(
  params: InsertTimeRecordRpcParams & { userId: string; companyId: string },
): Record<string, unknown> {
  const timestampIso = String(params.timestampIso ?? '').trim();
  const recordId = crypto.randomUUID();

  const row: Record<string, unknown> = {
    id: recordId,
    user_id: params.userId,
    company_id: params.companyId,
    timestamp: timestampIso,
    type: String(params.type ?? '').trim(),
    source: params.source ?? 'manual',
    method: params.method ?? 'admin',
    created_at: timestampIso,
    updated_at: timestampIso,
    is_manual: true,
  };

  if (params.fraudScore != null) row.fraud_score = params.fraudScore;
  if (params.fraudFlags != null) row.fraud_flags = params.fraudFlags;

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

  return row;
}

/** Parâmetros RPC canônicos — sempre os 6 campos (evita ambiguidade PostgREST). */
export function buildInsertTimeRecordRpcArgs(params: {
  userId: string;
  companyId: string;
  timestampIso: string;
  type: string;
  fraudScore?: number | null;
  fraudFlags?: unknown | null;
}): Record<string, unknown> {
  return {
    p_user_id: params.userId,
    p_company_id: params.companyId,
    p_timestamp: params.timestampIso,
    p_type: params.type,
    p_fraud_score: params.fraudScore ?? null,
    p_fraud_flags: params.fraudFlags ?? null,
  };
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

  const rpcArgs = buildInsertTimeRecordRpcArgs({
    userId,
    companyId,
    timestampIso,
    type,
    fraudScore: params.fraudScore,
    fraudFlags: params.fraudFlags,
  });

  const { data: rpcData, error: rpcError } = await client.rpc(
    'insert_time_record_for_user',
    rpcArgs,
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
