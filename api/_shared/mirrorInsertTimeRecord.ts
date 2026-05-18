/**
 * POST /api/mirror-insert-time-record
 * Batida manual admin/HR via service role (contorna 404 PostgREST no browser).
 */

import { createClient } from '@supabase/supabase-js';
import { getSupabaseConfig, getSupabaseUrlForServer } from './getSupabaseConfig.js';
import { getCallerContext, isAdminOrHr } from './callerContext.js';
import { getSecureCorsHeaders, requireTrustedOrigin } from './security.js';
import { noCache } from './cache.js';
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

function buildRow(body: MirrorInsertBody): Record<string, unknown> {
  const timestampIso = String(body.timestampIso ?? '').trim();
  const recordId = crypto.randomUUID();
  const row: Record<string, unknown> = {
    id: recordId,
    user_id: body.userId,
    company_id: body.companyId,
    timestamp: timestampIso,
    type: String(body.type ?? '').trim(),
    source: body.source ?? 'manual',
    method: body.method ?? 'admin',
    created_at: timestampIso,
    updated_at: timestampIso,
    is_manual: true,
  };
  if (body.fraudScore != null) row.fraud_score = body.fraudScore;
  if (body.fraudFlags != null) row.fraud_flags = body.fraudFlags;
  if (body.manualReason != null && String(body.manualReason).trim()) {
    row.manual_reason = String(body.manualReason).trim();
  }
  if (body.latitude != null) row.latitude = body.latitude;
  if (body.longitude != null) row.longitude = body.longitude;
  return row;
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

  const row = buildRow({ ...body, userId, companyId, type, timestampIso });
  const recordId = String(row.id);

  const { error: insertError } = await serviceClient.from('time_records').insert(row);
  if (insertError) {
    console.error('[mirror-insert-time-record] insert', insertError);
    return json(
      {
        error: insertError.message,
        code: insertError.code,
        details: insertError.details,
        hint: insertError.hint,
      },
      insertError.code === 'PGRST205' || insertError.code === 'PGRST202' ? 503 : 500,
      corsHeaders,
    );
  }

  return json(
    {
      success: true,
      id: recordId,
      record_id: recordId,
      timestamp: timestampIso,
      via: 'api',
    },
    200,
    corsHeaders,
  );
}
