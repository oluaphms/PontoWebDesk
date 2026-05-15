import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getSecureCorsHeaders, extractBearerToken, secureCompare } from './security.js';
import { getSupabaseConfig } from './getSupabaseConfig.js';

const ALLOWED_METHODS = 'GET, POST, OPTIONS';

type AnySupabase = SupabaseClient<any, any, any>;
type DeviceAuthResult = { ok: true; device: DeviceRow } | { ok: false; response: Response };

type DeviceRow = {
  id: string;
  company_id: string;
  api_key: string | null;
  status_runtime?: 'online' | 'offline' | 'unknown' | null;
  last_seen_at?: string | null;
};

type StructuredSyncError = {
  code: 'DEVICE_OFFLINE' | 'TIMEOUT' | 'DUPLICATE' | 'INVALID_IDENTIFIER' | 'UNKNOWN';
  message: string;
};

const SYNC_ERROR_CODES = new Set(['DEVICE_OFFLINE', 'TIMEOUT', 'DUPLICATE', 'INVALID_IDENTIFIER', 'UNKNOWN']);

function getBridgeToken(): string {
  return (process.env.REP_BRIDGE_TOKEN || process.env.REP_AGENT_TOKEN || process.env.API_KEY || '').trim();
}

async function authenticateDevice(
  supabase: AnySupabase,
  request: Request,
  deviceId: string
): Promise<DeviceAuthResult> {
  const token = extractBearerToken(request);
  if (!token) return { ok: false, response: Response.json({ error: 'Unauthorized' }, { status: 401 }) };

  const { data: requestedDevice, error: deviceErr } = await supabase
    .from('rep_devices')
    .select('id, company_id, api_key, status_runtime, last_seen_at')
    .eq('id', deviceId)
    .maybeSingle();
  if (deviceErr || !requestedDevice) {
    return { ok: false, response: Response.json({ error: 'Dispositivo não encontrado' }, { status: 404 }) };
  }

  const device = requestedDevice as DeviceRow;
  const bridgeToken = getBridgeToken();
  if (device.api_key && secureCompare(token, device.api_key)) return { ok: true, device };
  if (bridgeToken && secureCompare(token, bridgeToken)) return { ok: true, device };

  const { data: keyOwner, error: keyErr } = await supabase
    .from('rep_devices')
    .select('id, company_id')
    .eq('api_key', token)
    .maybeSingle();
  if (keyErr || !keyOwner) return { ok: false, response: Response.json({ error: 'Unauthorized' }, { status: 401 }) };
  if (keyOwner.company_id !== device.company_id) {
    return { ok: false, response: Response.json({ error: 'Acesso negado para este dispositivo' }, { status: 403 }) };
  }
  return { ok: true, device };
}

async function authenticateAdminJwtForDevice(supabase: AnySupabase, token: string, device: DeviceRow): Promise<boolean> {
  const { data: authData, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !authData.user?.id) return false;
  const { data: profile, error: profileErr } = await supabase
    .from('users')
    .select('company_id, role')
    .eq('id', authData.user.id)
    .maybeSingle();
  if (profileErr || !profile) return false;
  if (String(profile.company_id || '') !== String(device.company_id || '')) return false;
  const role = String(profile.role || '').toLowerCase();
  return role === 'admin' || role === 'hr';
}

async function authenticateDeviceOrAdmin(
  supabase: AnySupabase,
  request: Request,
  deviceId: string
): Promise<DeviceAuthResult> {
  const token = extractBearerToken(request);
  if (!token) return { ok: false, response: Response.json({ error: 'Unauthorized' }, { status: 401 }) };
  const baseAuth = await authenticateDevice(supabase, request, deviceId);
  if (baseAuth.ok) return baseAuth;
  const { data: deviceData } = await supabase
    .from('rep_devices')
    .select('id, company_id, api_key, status_runtime, last_seen_at')
    .eq('id', deviceId)
    .maybeSingle();
  if (!deviceData) return baseAuth;
  const isAdmin = await authenticateAdminJwtForDevice(supabase, token, deviceData as DeviceRow);
  return isAdmin ? { ok: true, device: deviceData as DeviceRow } : baseAuth;
}

function authResponse(auth: DeviceAuthResult): Response {
  return (auth as { ok: false; response: Response }).response;
}

function normalizeSyncError(raw: unknown): StructuredSyncError {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const codeCandidate = String((raw as { code?: unknown }).code || 'UNKNOWN').toUpperCase();
    const message = String((raw as { message?: unknown }).message || 'Erro não informado pelo agente').trim();
    return { code: (SYNC_ERROR_CODES.has(codeCandidate) ? codeCandidate : 'UNKNOWN') as StructuredSyncError['code'], message };
  }
  return { code: 'UNKNOWN', message: String(raw || 'Erro não informado pelo agente').trim() };
}

async function markOfflineDevices(supabase: AnySupabase, companyId?: string): Promise<void> {
  let query = supabase
    .from('rep_devices')
    .update({ status_runtime: 'offline', updated_at: new Date().toISOString() })
    .lt('last_seen_at', new Date(Date.now() - 5 * 60 * 1000).toISOString())
    .neq('status_runtime', 'offline');
  if (companyId) query = query.eq('company_id', companyId);
  await query;
}

async function handlePendingUsers(request: Request, supabase: AnySupabase, deviceId: string, headers: Record<string, string>) {
  if (request.method !== 'GET') return Response.json({ error: 'Method not allowed' }, { status: 405, headers });
  const auth = await authenticateDevice(supabase, request, deviceId);
  if (!auth.ok) {
    const res = authResponse(auth);
    return new Response(await res.text(), { status: res.status, headers: { ...headers, 'Content-Type': 'application/json' } });
  }
  const { data: claimedRows, error } = await supabase.rpc('claim_device_user_sync_batch', { p_device_id: deviceId, p_limit: 100 });
  if (error) return Response.json({ error: 'Falha ao buscar pendências' }, { status: 500, headers });
  const claimed = Array.isArray(claimedRows) ? claimedRows : [];
  const userIds = claimed.map((row) => String((row as { user_id?: string }).user_id || ''));
  let namesById = new Map<string, string>();
  if (userIds.length > 0) {
    const { data: usersData } = await supabase.from('users').select('id, nome').in('id', userIds);
    if (Array.isArray(usersData)) namesById = new Map(usersData.map((u) => [String(u.id), String(u.nome || 'Sem nome')]));
  }
  return Response.json(
    {
      success: true,
      users: claimed.map((row) => {
        const r = row as {
          sync_id: string; user_id: string; identifier: string; identifier_type: 'cpf' | 'pis' | 'both'; external_id_on_device: string | null;
        };
        return {
          sync_id: r.sync_id,
          user_id: r.user_id,
          name: namesById.get(r.user_id) || 'Sem nome',
          identifier: r.identifier,
          identifier_type: r.identifier_type,
          external_id_on_device: r.external_id_on_device || null,
        };
      }),
    },
    { status: 200, headers }
  );
}

async function handleAckSync(request: Request, supabase: AnySupabase, deviceId: string, headers: Record<string, string>) {
  if (request.method !== 'POST') return Response.json({ error: 'Method not allowed' }, { status: 405, headers });
  const auth = await authenticateDevice(supabase, request, deviceId);
  if (!auth.ok) {
    const res = authResponse(auth);
    return new Response(await res.text(), { status: res.status, headers: { ...headers, 'Content-Type': 'application/json' } });
  }
  let body: { sync_id?: string; success?: boolean; external_id_on_device?: string; error?: string | StructuredSyncError };
  try { body = await request.json(); } catch { return Response.json({ error: 'Body inválido' }, { status: 400, headers }); }
  const syncId = String(body.sync_id || '').trim();
  const success = body.success === true;
  const normalizedError = normalizeSyncError(body.error);
  const externalId = String(body.external_id_on_device || '').trim() || null;
  if (!syncId) return Response.json({ error: 'sync_id é obrigatório' }, { status: 400, headers });
  const { data: existing, error: existingErr } = await supabase
    .from('device_user_sync')
    .select('id, device_id, sync_attempts, sync_status, sync_error, external_id_on_device')
    .eq('id', syncId)
    .maybeSingle();
  if (existingErr || !existing) return Response.json({ error: 'sync_id não encontrado' }, { status: 404, headers });
  if (existing.device_id !== deviceId) return Response.json({ error: 'sync_id não pertence ao dispositivo' }, { status: 403, headers });
  if (success) {
    if (existing.sync_status === 'sent' && String(existing.external_id_on_device || '') === String(externalId || '')) {
      return Response.json({ success: true, idempotent: true }, { status: 200, headers });
    }
    const { error } = await supabase.from('device_user_sync').update({
      sync_status: 'sent', sync_error: null, external_id_on_device: externalId, last_sync_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }).eq('id', syncId);
    if (error) return Response.json({ error: 'Falha ao confirmar sincronização' }, { status: 500, headers });
    return Response.json({ success: true }, { status: 200, headers });
  }
  const existingError = existing.sync_error as StructuredSyncError | null;
  const sameErrorAlready =
    existing.sync_status === 'error' &&
    String(existingError?.code || '') === normalizedError.code &&
    String(existingError?.message || '') === normalizedError.message;
  if (sameErrorAlready) return Response.json({ success: true, idempotent: true }, { status: 200, headers });
  const nextAttempts = Math.min(Number(existing.sync_attempts || 0) + 1, 5);
  const { error } = await supabase.from('device_user_sync').update({
    sync_status: 'error', sync_attempts: nextAttempts, sync_error: normalizedError, last_sync_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }).eq('id', syncId);
  if (error) return Response.json({ error: 'Falha ao registrar erro de sincronização' }, { status: 500, headers });
  return Response.json({ success: true }, { status: 200, headers });
}

async function handleHeartbeat(request: Request, supabase: AnySupabase, deviceId: string, headers: Record<string, string>) {
  if (request.method !== 'POST') return Response.json({ error: 'Method not allowed' }, { status: 405, headers });
  const auth = await authenticateDevice(supabase, request, deviceId);
  if (!auth.ok) {
    const res = authResponse(auth);
    return new Response(await res.text(), { status: res.status, headers: { ...headers, 'Content-Type': 'application/json' } });
  }
  const now = new Date().toISOString();
  const { error } = await supabase.from('rep_devices').update({ last_seen_at: now, status_runtime: 'online', updated_at: now })
    .eq('id', deviceId).eq('company_id', auth.device.company_id);
  if (error) return Response.json({ error: 'Falha ao registrar heartbeat' }, { status: 500, headers });
  return Response.json({ success: true }, { status: 200, headers });
}

async function handleSyncStatus(request: Request, supabase: AnySupabase, deviceId: string, headers: Record<string, string>) {
  if (request.method !== 'GET') return Response.json({ error: 'Method not allowed' }, { status: 405, headers });
  const auth = await authenticateDeviceOrAdmin(supabase, request, deviceId);
  if (!auth.ok) {
    const res = authResponse(auth);
    return new Response(await res.text(), { status: res.status, headers: { ...headers, 'Content-Type': 'application/json' } });
  }
  await markOfflineDevices(supabase, auth.device.company_id);
  const { data: rows, error } = await supabase.from('device_user_sync').select('sync_status, last_sync_at').eq('device_id', deviceId);
  if (error) return Response.json({ error: 'Falha ao carregar métricas de sincronização' }, { status: 500, headers });
  const pending = (rows || []).filter((r) => r.sync_status === 'pending').length;
  const sent = (rows || []).filter((r) => r.sync_status === 'sent').length;
  const errorCount = (rows || []).filter((r) => r.sync_status === 'error').length;
  const lastSyncAt = (rows || []).map((r) => r.last_sync_at).filter(Boolean).sort().at(-1) || null;
  const { data: deviceNow } = await supabase.from('rep_devices').select('status_runtime, last_seen_at').eq('id', deviceId).maybeSingle();
  return Response.json(
    {
      success: true,
      pending,
      sent,
      error: errorCount,
      last_sync_at: lastSyncAt,
      device_status: (deviceNow?.status_runtime || 'unknown') as 'online' | 'offline' | 'unknown',
      last_seen_at: deviceNow?.last_seen_at || null,
    },
    { status: 200, headers }
  );
}

async function handleForceSync(request: Request, supabase: AnySupabase, deviceId: string, headers: Record<string, string>) {
  if (request.method !== 'POST') return Response.json({ error: 'Method not allowed' }, { status: 405, headers });
  const auth = await authenticateDeviceOrAdmin(supabase, request, deviceId);
  if (!auth.ok) {
    const res = authResponse(auth);
    return new Response(await res.text(), { status: res.status, headers: { ...headers, 'Content-Type': 'application/json' } });
  }
  const { error } = await supabase.from('device_user_sync').update({
    sync_status: 'pending', sync_attempts: 0, sync_error: null, external_id_on_device: null, updated_at: new Date().toISOString(),
  }).eq('device_id', deviceId).in('sync_status', ['error', 'sent']);
  if (error) return Response.json({ error: 'Falha ao forçar reprocessamento' }, { status: 500, headers });
  return Response.json({ success: true }, { status: 200, headers });
}

export async function handleDeviceSyncRoute(request: Request, repSlug: string): Promise<Response> {
  const corsHeaders = getSecureCorsHeaders(request, {
    allowMethods: ALLOWED_METHODS,
    allowHeaders: 'Content-Type, Authorization',
  });
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
  let url: string;
  let serviceKey: string;
  try {
    ({ url, serviceKey } = getSupabaseConfig());
  } catch {
    return Response.json({ error: 'Supabase não configurado' }, { status: 500, headers: corsHeaders });
  }
  const supabase: AnySupabase = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const parts = repSlug.split('/').filter(Boolean);
  if (parts.length < 3 || parts[0] !== 'devices') {
    return Response.json({ error: 'Rota inválida' }, { status: 404, headers: corsHeaders });
  }
  const deviceId = decodeURIComponent(parts[1] || '');
  const action = decodeURIComponent(parts[2] || '');
  if (!deviceId) return Response.json({ error: 'device_id é obrigatório' }, { status: 400, headers: corsHeaders });
  if (action === 'pending-users') return handlePendingUsers(request, supabase, deviceId, corsHeaders);
  if (action === 'ack-sync') return handleAckSync(request, supabase, deviceId, corsHeaders);
  if (action === 'heartbeat') return handleHeartbeat(request, supabase, deviceId, corsHeaders);
  if (action === 'sync-status') return handleSyncStatus(request, supabase, deviceId, corsHeaders);
  if (action === 'force-sync') return handleForceSync(request, supabase, deviceId, corsHeaders);
  return Response.json({ error: 'Rota não encontrada' }, { status: 404, headers: corsHeaders });
}
