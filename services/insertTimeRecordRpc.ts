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
  const isTypeMismatch =
    code === '42804' ||
    code === '22P02' ||
    /operator does not exist.*uuid/i.test(msg) ||
    /operator does not exist.*text\s*=\s*uuid/i.test(msg);

  const schemaCacheMiss =
    code === 'PGRST202' ||
    code === 'PGRST203' ||
    code === 'PGRST205' ||
    (code === '42883' && !isTypeMismatch) ||
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

  if (isTypeMismatch) {
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
  allowOutOfOrder?: boolean;
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
  allowOutOfOrder?: boolean;
}): Record<string, unknown> {
  const sourceRaw = String(params.source ?? '').trim().toLowerCase();
  const source = sourceRaw === 'admin' || sourceRaw.startsWith('admin_') ? 'admin' : 'manual';
  const allowOutOfOrder =
    params.allowOutOfOrder ?? source === 'manual';
  return {
    p_user_id: params.userId,
    p_company_id: params.companyId,
    p_timestamp: params.timestampIso,
    p_type: params.type,
    p_source: source,
    p_metadata: params.metadata ?? {},
    p_allow_out_of_order: Boolean(allowOutOfOrder),
  };
}

function normalizeTimestampIsoNotFuture(rawIso: string): string {
  const parsed = new Date(rawIso);
  if (Number.isNaN(parsed.getTime())) return rawIso;
  const now = new Date();
  if (parsed.getTime() <= now.getTime()) return parsed.toISOString();
  return now.toISOString();
}

function isMonotonicRegressionError(error: unknown): boolean {
  const msg =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : JSON.stringify(error);
  return /MONOTONIC|last_event_at regression/i.test(msg);
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
  const timestampIsoRaw = String(params.timestampIso ?? '').trim();
  if (!type || !timestampIsoRaw) {
    throw new Error('type e timestamp são obrigatórios.');
  }
  const timestampIso = normalizeTimestampIsoNotFuture(timestampIsoRaw);

  const rpcArgs = buildInsertTimeRecordRpcArgs({
    userId,
    companyId,
    timestampIso,
    type,
    source: params.source ?? 'manual',
    allowOutOfOrder: params.allowOutOfOrder ?? false,
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

  const { data: sessionData } = await client.auth.getSession();
  if (!sessionData?.session?.user?.id) {
    throw new Error('Sessão inválida — abortando RPC');
  }

  let rpcData: unknown;
  let rpcError: PostgrestError | null = null;
  ({ data: rpcData, error: rpcError } = await client.rpc('insert_time_record_for_user_v2', rpcArgs));

  // Retry seguro: só força manual quando a origem não é manual.
  if (
    rpcError &&
    isMonotonicRegressionError(rpcError) &&
    String(rpcArgs.p_source ?? '').toLowerCase() !== 'manual'
  ) {
    console.warn('FORCED MANUAL INSERT', rpcArgs);
    const fallbackArgs = {
      ...rpcArgs,
      p_source: 'manual',
      p_allow_out_of_order: true,
    };
    ({ data: rpcData, error: rpcError } = await client.rpc('insert_time_record_for_user_v2', fallbackArgs));
  }

  if (rpcError) {
    console.error('[RPC ERROR FULL]', {
      code: rpcError.code,
      message: rpcError.message,
      details: rpcError.details,
      hint: rpcError.hint,
    });
    throw wrapPostgrestError('insert_time_record_for_user_v2', rpcError);
  }

  const parsed = parseInsertTimeRecordRpcResult(rpcData);
  if (!parsed) {
    throw new Error(
      'insert_time_record_for_user_v2: resposta sem id/success. Verifique permissões e schema da RPC.',
    );
  }

  return {
    id: parsed.id,
    timestamp: resolveTimestampFromRpc(timestampIso, parsed.timestamp),
  };
}

/** @deprecated Use insertTimeRecordForUser */
export const insertTimeRecordForUserWithFallback = insertTimeRecordForUser;
