import { observabilityConsole } from '../../src/shared/logger/observabilityConsole.js';
/**
 * POST /api/rep/heartbeat — sinal do agente local (alias simplificado).
 * Body: { device_id, company_id?, agent_version? }
 * Auth: Bearer API_KEY / REP_BRIDGE_TOKEN (mesmo do punch).
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseConfig } from './getSupabaseConfig.js';
import { getSecureCorsHeaders, extractBearerToken, secureCompare } from './security.js';
import { noCache } from './cache.js';

function cors(request: Request): Record<string, string> {
  return getSecureCorsHeaders(request, {
    allowMethods: 'POST, OPTIONS',
    allowHeaders: 'Content-Type, Authorization, X-REP-API-Key',
  });
}

function json(body: unknown, status: number, headers: Record<string, string>): Response {
  return noCache(Response.json(body, { status, headers: { ...headers, 'Content-Type': 'application/json' } }));
}

function getBridgeToken(): string {
  return (process.env.REP_BRIDGE_TOKEN || process.env.REP_AGENT_TOKEN || process.env.API_KEY || '').trim();
}

type HeartbeatAuthResult =
  | { ok: true; device: { id: string; company_id: string } }
  | { ok: false; response: Response };

async function authenticateAgent(
  request: Request,
  deviceId: string,
  supabase: SupabaseClient,
): Promise<HeartbeatAuthResult> {
  const headers = cors(request);
  const token = extractBearerToken(request);
  if (!token) {
    return { ok: false, response: json({ error: 'Unauthorized' }, 401, headers) };
  }

  const { data: device, error: deviceErr } = await supabase
    .from('rep_devices')
    .select('id, company_id, api_key')
    .eq('id', deviceId)
    .maybeSingle();

  if (deviceErr) {
    observabilityConsole.error('[REP HEARTBEAT ERROR] rep_devices query:', deviceErr.message);
    return { ok: false, response: json({ error: 'Falha ao consultar dispositivo', detail: deviceErr.message }, 500, headers) };
  }
  if (!device?.id) {
    return { ok: false, response: json({ error: 'Dispositivo não encontrado', device_id: deviceId }, 404, headers) };
  }

  const row = device as { id: string; company_id: string; api_key?: string | null };
  const bridgeToken = getBridgeToken();
  if (row.api_key && secureCompare(token, String(row.api_key).trim())) {
    return { ok: true, device: { id: String(row.id), company_id: String(row.company_id) } };
  }
  if (bridgeToken && secureCompare(token, bridgeToken)) {
    return { ok: true, device: { id: String(row.id), company_id: String(row.company_id) } };
  }

  return { ok: false, response: json({ error: 'Unauthorized' }, 401, headers) };
}

export async function handleRepHeartbeat(request: Request): Promise<Response> {
  const headers = cors(request);

  if (request.method === 'OPTIONS') {
    return noCache(new Response(null, { status: 204, headers }));
  }
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405, headers);
  }

  let body: { device_id?: string; company_id?: string; agent_version?: string } = {};
  try {
    const raw = await request.json();
    body = raw && typeof raw === 'object' ? raw : {};
  } catch {
    return json({ error: 'JSON inválido' }, 400, headers);
  }

  const url = new URL(request.url, 'https://local.invalid');
  const deviceId = String(body.device_id || url.searchParams.get('device_id') || '').trim();
  if (!deviceId) {
    return json({ error: 'device_id é obrigatório' }, 400, headers);
  }

  let supabase: SupabaseClient;
  try {
    const { url: supabaseUrl, serviceKey } = getSupabaseConfig();
    supabase = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    return json({ error: 'Supabase não configurado', detail }, 500, headers);
  }

  const auth = await authenticateAgent(request, deviceId, supabase);
  if (auth.ok === false) {
    return auth.response;
  }

  const companyId = String(body.company_id || auth.device.company_id || '').trim();
  if (companyId && companyId !== String(auth.device.company_id)) {
    return json({ error: 'company_id não corresponde ao dispositivo' }, 403, headers);
  }

  const now = new Date().toISOString();
  const agentVersion = String(body.agent_version || '').trim() || null;

  const { error: devErr } = await supabase
    .from('rep_devices')
    .update({ last_seen_at: now, status_runtime: 'online', updated_at: now })
    .eq('id', deviceId);

  if (devErr) {
    observabilityConsole.error('[REP HEARTBEAT ERROR] update rep_devices:', devErr.message, { device_id: deviceId });
    return json({ error: 'Falha ao registrar heartbeat', detail: devErr.message }, 500, headers);
  }

  const { error: hbErr } = await supabase.from('rep_device_heartbeats').upsert({
    device_id: deviceId,
    company_id: auth.device.company_id,
    last_seen_at: now,
    agent_version: agentVersion,
    updated_at: now,
  });
  if (hbErr) {
    observabilityConsole.warn('[rep/heartbeat] rep_device_heartbeats upsert:', hbErr.message);
  }

  return json(
    {
      ok: true,
      success: true,
      device_id: deviceId,
      company_id: auth.device.company_id,
      last_seen_at: now,
      last_heartbeat_at: now,
    },
    200,
    headers,
  );
}
