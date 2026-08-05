/**
 * GET sync-status leve — uma linha em rep_devices (last_seen_at).
 * online = true se last_seen_at < 2 minutos.
 */

import { createClient } from '@supabase/supabase-js';
import { getSupabaseConfig, getSupabaseUrlForServer } from './getSupabaseConfig.js';
import { getSecureCorsHeaders, extractBearerToken } from './security.js';
import { noCache } from './cache.js';
import { getCallerContext, isAdminOrHr } from './callerContext.js';
import { verifyRepAgentToken } from './repAgentAuth.js';
import { logRepApi } from './repApiResilience.js';

export const REP_SYNC_STATUS_ONLINE_MS = 2 * 60_000;

export type SyncStatusPayload = {
  online: boolean;
  last_seen: string | null;
  ok?: boolean;
  success?: boolean;
  degraded?: boolean;
  reason?: string;
  device_status?: 'online' | 'offline';
  last_seen_at?: string | null;
  last_heartbeat_at?: string | null;
};

function cors(request: Request): Record<string, string> {
  return getSecureCorsHeaders(request, {
    allowMethods: 'GET, OPTIONS',
    allowHeaders: 'Content-Type, Authorization',
  });
}

function json(body: SyncStatusPayload & Record<string, unknown>, headers: Record<string, string>): Response {
  return noCache(Response.json(body, { status: 200, headers: { ...headers, 'Content-Type': 'application/json' } }));
}

export function resolveSyncStatusOnline(lastSeenAt: string | null | undefined): boolean {
  if (!lastSeenAt) return false;
  const t = Date.parse(lastSeenAt);
  if (!Number.isFinite(t)) return false;
  return Date.now() - t < REP_SYNC_STATUS_ONLINE_MS;
}

function offlinePayload(reason?: string): SyncStatusPayload {
  return {
    online: false,
    last_seen: null,
    ok: true,
    success: true,
    degraded: true,
    device_status: 'offline',
    last_seen_at: null,
    last_heartbeat_at: null,
    ...(reason ? { reason } : {}),
  };
}

async function authorizeOptional(
  request: Request,
  deviceId: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const token = extractBearerToken(request);
  if (!token) return { ok: false, reason: 'missing_token' };

  let url: string;
  let serviceKey: string;
  try {
    ({ url, serviceKey } = getSupabaseConfig());
  } catch {
    return { ok: false, reason: 'supabase_env' };
  }

  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });
  if (await verifyRepAgentToken(supabase, token, deviceId)) return { ok: true };

  const anonKey = (process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '').trim();
  const supabaseUrl = getSupabaseUrlForServer();
  if (!anonKey) return { ok: false, reason: 'missing_anon_key' };

  const caller = await getCallerContext(supabaseUrl, anonKey, supabase, token);
  if (!caller || !isAdminOrHr(caller.role)) return { ok: false, reason: 'unauthorized' };

  const { data: device, error } = await supabase
    .from('rep_devices')
    .select('company_id')
    .eq('id', deviceId)
    .maybeSingle();
  if (error || !device) return { ok: false, reason: 'device_not_found' };

  const devCompany = String(device.company_id ?? '').trim().toLowerCase();
  const callerCompany = String(caller.companyId ?? '').trim().toLowerCase();
  if (devCompany !== callerCompany) return { ok: false, reason: 'company_mismatch' };
  return { ok: true };
}

/**
 * Handler principal: GET sync-status por device_id (query ou argumento).
 * Sempre HTTP 200 — nunca 404/500 (degraded quando infra falha).
 */
export async function handleSyncStatus(request: Request, deviceId: string): Promise<Response> {
  const headers = cors(request);

  if (request.method === 'OPTIONS') {
    return noCache(new Response(null, { status: 204, headers }));
  }
  if (request.method !== 'GET') {
    return json(offlinePayload('method_not_allowed'), headers);
  }

  const id = String(deviceId || '').trim();
  if (!id) {
    logRepApi('warn', '/api/rep/sync-status', { op: 'handleSyncStatus', reason: 'device_id_required' });
    return json(offlinePayload('device_id_required'), headers);
  }

  const auth = await authorizeOptional(request, id);
  if (auth.ok === false) {
    const authReason = auth.reason;
    logRepApi('warn', '/api/rep/sync-status', {
      op: 'handleSyncStatus',
      device_id: id,
      auth: authReason,
    });
    return json(offlinePayload(authReason), headers);
  }

  try {
    const { url, serviceKey } = getSupabaseConfig();
    const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });
    const { data, error } = await supabase
      .from('rep_devices')
      .select('last_seen_at')
      .eq('id', id)
      .maybeSingle();

    if (error) {
      logRepApi('error', '/api/rep/sync-status', { device_id: id, message: error.message });
      return json(offlinePayload('supabase_error'), headers);
    }
    if (!data) {
      logRepApi('warn', '/api/rep/sync-status', { device_id: id, reason: 'device_not_found' });
      return json(offlinePayload('device_not_found'), headers);
    }

    const lastSeen = (data.last_seen_at as string | null) ?? null;
    const online = resolveSyncStatusOnline(lastSeen);

    logRepApi('info', '/api/rep/sync-status', { device_id: id, online, last_seen: lastSeen });

    return json(
      {
        online,
        last_seen: lastSeen,
        ok: true,
        success: true,
        device_status: online ? 'online' : 'offline',
        last_seen_at: lastSeen,
        last_heartbeat_at: lastSeen,
      },
      headers,
    );
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    logRepApi('error', '/api/rep/sync-status', { device_id: id, message: detail });
    return json(offlinePayload('internal_error'), headers);
  }
}

/** @deprecated use handleSyncStatus */
export const handleRepDeviceSyncStatusLite = handleSyncStatus;
