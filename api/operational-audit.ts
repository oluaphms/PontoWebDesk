/**
 * GET /api/operational-audit?company_id=...&entity_type=&entity_id=
 */

import { createClient } from '@supabase/supabase-js';
import { cachePrivate, noCache, varyAuthorization } from './_shared/cache.js';
import { getSecureCorsHeaders, checkRateLimit, getClientIP, extractBearerToken, secureCompare } from './_shared/security.js';
import { resolveRequestUrl } from './_shared/getRequestBaseUrl.js';
import { getSupabaseConfig } from './_shared/getSupabaseConfig.js';
import { getCallerContext, isAdminOrHr } from './_shared/callerContext.js';

const ALLOWED_METHODS = 'GET, OPTIONS';

type AuditRow = Record<string, unknown> & {
  id: string;
  actor_id: string | null;
};

async function handler(request: Request): Promise<Response> {
  const corsHeaders = getSecureCorsHeaders(request, {
    allowMethods: ALLOWED_METHODS,
    allowHeaders: 'Content-Type, Authorization',
  });

  if (request.method === 'OPTIONS') {
    return noCache(new Response(null, { status: 204, headers: corsHeaders }));
  }

  const clientIP = getClientIP(request);
  const rateLimit = checkRateLimit(clientIP, 'api');
  if (!rateLimit.allowed) {
    return noCache(
      Response.json(
        { success: false, error: 'RATE_LIMIT', retryAfter: Math.ceil((rateLimit.resetAt - Date.now()) / 1000) },
        { status: 429, headers: corsHeaders },
      ),
    );
  }

  let url: string;
  let serviceKey: string;
  try {
    ({ url, serviceKey } = getSupabaseConfig());
  } catch {
    return noCache(Response.json({ success: false, error: 'SUPABASE_ENV_MISSING' }, { status: 500, headers: corsHeaders }));
  }

  const anonKey = (process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '').trim();
  const apiKey = (process.env.API_KEY || '').trim();
  const bearer = extractBearerToken(request);
  const useServiceRole = !!(apiKey && bearer && secureCompare(bearer, apiKey));

  const supabase = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  if (request.method !== 'GET') {
    return noCache(Response.json({ success: false, error: 'METHOD_NOT_ALLOWED' }, { status: 405, headers: corsHeaders }));
  }

  const reqUrl = resolveRequestUrl(request);
  const companyId = reqUrl.searchParams.get('company_id')?.trim() || '';
  if (!companyId) {
    return noCache(Response.json({ success: false, error: 'MISSING_COMPANY_ID' }, { status: 400, headers: corsHeaders }));
  }

  if (!useServiceRole) {
    if (!bearer || !anonKey) {
      return noCache(Response.json({ success: false, error: 'UNAUTHORIZED' }, { status: 401, headers: corsHeaders }));
    }
    const caller = await getCallerContext(url, anonKey, supabase, bearer);
    if (!caller || !isAdminOrHr(caller.role) || caller.companyId !== companyId) {
      return noCache(Response.json({ success: false, error: 'FORBIDDEN' }, { status: 403, headers: corsHeaders }));
    }
  }

  const entityType = reqUrl.searchParams.get('entity_type')?.trim() || '';
  const entityId = reqUrl.searchParams.get('entity_id')?.trim() || '';
  const limitRaw = Number(reqUrl.searchParams.get('limit') ?? '100');
  const limit = Math.min(100, Math.max(1, Number.isFinite(limitRaw) ? limitRaw : 100));

  let q = supabase
    .from('operational_audit_log')
    .select('*')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (entityType) {
    q = q.eq('entity_type', entityType);
  }
  if (entityId) {
    q = q.eq('entity_id', entityId);
  }

  const { data: rows, error } = await q;

  if (error) {
    console.error('[api/operational-audit]', error);
    return noCache(Response.json({ success: false, error: 'DB_ERROR' }, { status: 500, headers: corsHeaders }));
  }

  const list = (rows ?? []) as AuditRow[];
  const actorIds = [...new Set(list.map((r) => String(r.actor_id || '').trim()).filter(Boolean))];
  let actorNameById: Record<string, string | null> = {};
  if (actorIds.length > 0) {
    const { data: users } = await supabase.from('users').select('id,nome').eq('company_id', companyId).in('id', actorIds);
    actorNameById = Object.fromEntries((users ?? []).map((u: { id: string; nome: string | null }) => [u.id, u.nome ?? null]));
  }

  const data = list.map((row) => ({
    ...row,
    actor_name: row.actor_id ? actorNameById[String(row.actor_id)] ?? null : null,
  }));

  let res = Response.json({ success: true, data }, { status: 200, headers: corsHeaders });
  varyAuthorization(res);
  res = cachePrivate(res, 5);
  return res;
}

export default { fetch: handler };
