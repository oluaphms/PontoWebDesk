/**
 * GET /api/operational-status?company_id=...&date=YYYY-MM-DD (opcional)
 * Lista snapshots consolidados; valida API_KEY (service) ou sessão admin/RH do mesmo tenant.
 */

import { createClient } from '@supabase/supabase-js';
import { cachePrivate, noCache, varyAuthorization } from '../cache.js';
import { getSecureCorsHeaders, checkRateLimit, getClientIP, extractBearerToken, secureCompare } from '../security.js';
import { resolveRequestUrl } from '../getRequestBaseUrl.js';
import { getSupabaseConfig } from '../getSupabaseConfig.js';
import { getCallerContext, isAdminOrHr } from '../callerContext.js';

const ALLOWED_METHODS = 'GET, OPTIONS';

type OperationalStatusRow = Record<string, unknown> & {
  employee_id: string;
};

async function handler(request: Request): Promise<Response> {
  const corsHeaders = getSecureCorsHeaders(request, {
    allowMethods: ALLOWED_METHODS,
    allowHeaders: 'Content-Type, Authorization',
  });

  if (request.method === 'OPTIONS') {
    return noCache(new Response(null, { status: 204, headers: corsHeaders }));
  }
  if (request.method !== 'GET') {
    return noCache(Response.json({ success: false, error: 'METHOD_NOT_ALLOWED' }, { status: 405, headers: corsHeaders }));
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

  const sp = resolveRequestUrl(request).searchParams;
  const companyId = sp.get('company_id')?.trim() || '';
  const date = sp.get('date')?.trim() || null;

  if (!companyId) {
    return noCache(Response.json({ success: false, error: 'MISSING_COMPANY_ID' }, { status: 400, headers: corsHeaders }));
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

  if (!useServiceRole) {
    if (!bearer || !anonKey) {
      return noCache(Response.json({ success: false, error: 'UNAUTHORIZED' }, { status: 401, headers: corsHeaders }));
    }
    const caller = await getCallerContext(url, anonKey, supabase, bearer);
    if (!caller || !isAdminOrHr(caller.role) || caller.companyId !== companyId) {
      return noCache(Response.json({ success: false, error: 'FORBIDDEN' }, { status: 403, headers: corsHeaders }));
    }
  }

  let q = supabase
    .from('operational_day_status')
    .select('*')
    .eq('company_id', companyId)
    .order('date', { ascending: false })
    .limit(100);

  if (date) {
    q = q.eq('date', date);
  }

  const { data: rows, error } = await q;
  if (error) {
    console.error('[api/operational-status]', error);
    return noCache(Response.json({ success: false, error: 'DB_ERROR' }, { status: 500, headers: corsHeaders }));
  }

  const list = (rows ?? []) as OperationalStatusRow[];
  const ids = [...new Set(list.map((r) => String(r.employee_id || '').trim()).filter(Boolean))];
  let nameById: Record<string, string | null> = {};
  if (ids.length > 0) {
    const { data: users } = await supabase.from('users').select('id,nome').eq('company_id', companyId).in('id', ids);
    nameById = Object.fromEntries((users ?? []).map((u: { id: string; nome: string | null }) => [u.id, u.nome ?? null]));
  }

  const data = list.map((row) => ({
    ...row,
    employee_name: nameById[String(row.employee_id)] ?? null,
  }));

  let res = Response.json({ success: true, data }, { status: 200, headers: corsHeaders });
  varyAuthorization(res);
  res = cachePrivate(res, 5);
  return res;
}

export default { fetch: handler };
