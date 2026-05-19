/**
 * POST /api/mirror-insert-time-record
 * Batida manual admin/HR via RPC (JWT do caller — auth.uid() na função SECURITY DEFINER).
 */

import { createClient } from '@supabase/supabase-js';
import { getSupabaseConfig, getSupabaseUrlForServer } from './getSupabaseConfig.js';
import { getCallerContext, isAdminOrHr } from './callerContext.js';
import { getSecureCorsHeaders, requireTrustedOrigin } from './security.js';
import { noCache } from './cache.js';
import {
  buildInsertTimeRecordRpcArgs,
  parseInsertTimeRecordRpcResult,
} from '../../services/insertTimeRecordRpc.js';

export type MirrorInsertBody = {
  userId: string;
  companyId: string;
  timestampIso: string;
  type: string;
  method?: string;
  source?: string;
  manualReason?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  fraudScore?: number | null;
  fraudFlags?: unknown | null;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function json(body: unknown, status: number, headers: Record<string, string>): Response {
  return noCache(
    Response.json(body, {
      status,
      headers: { ...headers, 'Content-Type': 'application/json' },
    }),
  );
}

export async function handleMirrorInsertTimeRecord(request: Request): Promise<Response> {
  const corsHeaders = getSecureCorsHeaders(request, {
    allowMethods: 'POST, OPTIONS',
    allowHeaders: 'Content-Type, Authorization',
  });

  if (request.method === 'OPTIONS') {
    return noCache(new Response(null, { status: 204, headers: corsHeaders }));
  }

  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405, corsHeaders);
  }

  const blocked = requireTrustedOrigin(request, corsHeaders);
  if (blocked) return blocked;

  const token = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) {
    return json({ error: 'Authorization Bearer obrigatório' }, 401, corsHeaders);
  }

  let body: MirrorInsertBody;
  try {
    body = (await request.json()) as MirrorInsertBody;
  } catch {
    return json({ error: 'JSON inválido' }, 400, corsHeaders);
  }

  const userId = String(body.userId ?? '').trim();
  const companyId = String(body.companyId ?? '').trim();
  const type = String(body.type ?? '').trim();
  const timestampIso = String(body.timestampIso ?? '').trim();

  if (!userId || !companyId || !UUID_RE.test(userId) || !UUID_RE.test(companyId)) {
    return json({ error: 'IDs inválidos (UUID esperado)' }, 400, corsHeaders);
  }
  if (!type || !timestampIso) {
    return json({ error: 'type e timestampIso são obrigatórios' }, 400, corsHeaders);
  }

  const supabaseUrl = getSupabaseUrlForServer();
  const anonKey = (process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '').trim();
  if (!supabaseUrl || !anonKey) {
    return json({ error: 'Supabase não configurado no servidor' }, 500, corsHeaders);
  }

  let serviceClient;
  try {
    const { url, serviceKey } = getSupabaseConfig();
    serviceClient = createClient(url, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  } catch {
    return json({ error: 'SUPABASE_SERVICE_ROLE_KEY ausente no servidor' }, 500, corsHeaders);
  }

  const caller = await getCallerContext(supabaseUrl, anonKey, serviceClient, token);
  if (!caller || !isAdminOrHr(caller.role)) {
    return json({ error: 'Não autorizado: apenas admin/HR' }, 403, corsHeaders);
  }
  if (caller.companyId !== companyId) {
    return json({ error: 'Empresa do token diferente da empresa informada' }, 403, corsHeaders);
  }

  const { data: employee, error: empErr } = await serviceClient
    .from('users')
    .select('id, company_id')
    .eq('id', userId)
    .maybeSingle();

  if (empErr) {
    console.error('[mirror-insert-time-record] users lookup', empErr);
    return json({ error: empErr.message, code: empErr.code }, 500, corsHeaders);
  }
  if (!employee || String(employee.company_id ?? '') !== companyId) {
    return json({ error: 'Funcionário não pertence à empresa' }, 403, corsHeaders);
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const rpcArgs = buildInsertTimeRecordRpcArgs({
    userId,
    companyId,
    timestampIso,
    type,
    source: body.source ?? 'manual',
    metadata: {
      method: body.method ?? null,
      manual_reason: body.manualReason ?? null,
      latitude: body.latitude ?? null,
      longitude: body.longitude ?? null,
      fraud_score: body.fraudScore ?? null,
      fraud_flags: body.fraudFlags ?? null,
    },
  });

  const { data: rpcData, error: rpcError } = await userClient.rpc(
    'insert_time_record_for_user',
    rpcArgs,
  );

  if (rpcError) {
    console.error('[mirror-insert-time-record] rpc', rpcError);
    return json(
      {
        error: rpcError.message,
        code: rpcError.code,
        details: rpcError.details,
        hint: rpcError.hint,
      },
      rpcError.code === 'PGRST205' || rpcError.code === 'PGRST202' || rpcError.code === 'PGRST203'
        ? 503
        : 500,
      corsHeaders,
    );
  }

  const parsed = parseInsertTimeRecordRpcResult(rpcData);
  if (!parsed) {
    return json({ error: 'RPC sem id na resposta', rpcData }, 500, corsHeaders);
  }

  return json(
    {
      success: true,
      id: parsed.id,
      record_id: parsed.id,
      timestamp:
        typeof parsed.timestamp === 'string' && parsed.timestamp.trim()
          ? parsed.timestamp
          : timestampIso,
      via: 'rpc',
    },
    200,
    corsHeaders,
  );
}
