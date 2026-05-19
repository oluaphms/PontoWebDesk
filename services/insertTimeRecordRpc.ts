/**
 * RPC `insert_time_record_for_user` — assinatura canônica única (6 params).
 * Sem fallback REST em time_records (evita 404 / PGRST203 / uuid=text).
 */

import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function assertValidUuid(id: string, label: string): string {
  const trimmed = String(id ?? '').trim();
  if (!trimmed || !UUID_RE.test(trimmed)) {
    throw new Error(`${label} inválido (UUID esperado).`);
  }
  return trimmed;
}

function wrapPostgrestError(context: string, error: PostgrestError): Error {
  const code = String(error.code ?? '');
  const status = Number((error as PostgrestError & { status?: number }).status ?? 0);
  const msg = String(error.message ?? 'erro desconhecido');
  const details = error.details ? ` Detalhe: ${error.details}` : '';
  const hint = error.hint ? ` ${error.hint}` : '';

  const schemaCacheMiss =
    code === 'PGRST202' ||
    code === 'PGRST203' ||
    code === 'PGRST205' ||
    code === '42883' ||
    status === 404 ||
    /could not find the function/i.test(msg) ||
    /could not choose the best candidate/i.test(msg) ||
    (/not found/i.test(msg) && /function|relation|schema cache/i.test(msg));

  if (schemaCacheMiss) {
    return new Error(
      `${context}: RPC não encontrada ou ambígua (cache PostgREST). ` +
        `Supabase Dashboard → Settings → API → Reload schema. ` +
        `Confirme a migration 20260520340000_manual_punch_insert_rpc_final.sql.${details}${hint}`,
    );
  }

  if (code === '42804' || code === '22P02' || /operator does not exist.*uuid/i.test(msg)) {
    return new Error(
      `${context}: incompatibilidade de tipo UUID (aplique migrations recentes de time_records).${details}${hint}`,
    );
  }

  return new Error(`${context}: ${msg}${details}${hint}`);
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
};

export function parseInsertTimeRecordRpcResult(
  rpcData: unknown,
): { id: string; timestamp?: string | number | null } | null {
  if (!rpcData || typeof rpcData !== 'object') return null;
  const row = rpcData as Record<string, unknown>;
  if (row.success === false) return null;
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

/** Parâmetros RPC — UUIDs como string canônica; PostgREST envia como uuid. */
export function buildInsertTimeRecordRpcArgs(params: {
  userId: string;
  companyId: string;
  timestampIso: string;
  type: string;
  source?: string | null;
  metadata?: Record<string, unknown> | null;
}): Record<string, unknown> {
  return {
    p_user_id: params.userId,
    p_company_id: params.companyId,
    p_timestamp: params.timestampIso,
    p_type: params.type,
    p_source: params.source ?? 'manual',
    p_metadata: params.metadata ?? {},
  };
}

/**
 * Insere batida manual via RPC (único caminho suportado).
 */
export async function insertTimeRecordForUser(
  client: SupabaseClient,
  params: InsertTimeRecordRpcParams,
): Promise<InsertTimeRecordRpcResult> {
  const userId = assertValidUuid(String(params.userId ?? '').trim(), 'user_id');
  const companyId = assertValidUuid(String(params.companyId ?? '').trim(), 'company_id');
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
    source: params.source ?? 'manual',
    metadata: {
      method: params.method ?? null,
      manual_reason: params.manualReason ?? null,
      latitude: params.latitude ?? null,
      longitude: params.longitude ?? null,
      accuracy: params.accuracy ?? null,
      device_id: params.deviceId ?? null,
      device_type: params.deviceType ?? null,
      ip_address: params.ipAddress ?? null,
      location: params.location ?? null,
      photo_url: params.photoUrl ?? null,
      fraud_score: params.fraudScore ?? null,
      fraud_flags: params.fraudFlags ?? null,
    },
  });

  const { data: rpcData, error: rpcError } = await client.rpc(
    'insert_time_record_for_user',
    rpcArgs,
  );

  if (rpcError) {
    throw wrapPostgrestError('insert_time_record_for_user', rpcError);
  }

  const parsed = parseInsertTimeRecordRpcResult(rpcData);
  if (!parsed) {
    throw new Error(
      'insert_time_record_for_user: resposta sem id/success. Verifique permissões e schema da RPC.',
    );
  }

  return {
    id: parsed.id,
    timestamp: resolveTimestampFromRpc(timestampIso, parsed.timestamp),
  };
}

/** @deprecated Use insertTimeRecordForUser */
export const insertTimeRecordForUserWithFallback = insertTimeRecordForUser;
