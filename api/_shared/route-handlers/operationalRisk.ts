/**
 * GET /api/operational-risk?company_id=...
 * Agrega alertas não resolvidos + SLA e devolve avaliação de risco.
 */

import { createClient } from '@supabase/supabase-js';
import { cachePrivate, noCache, varyAuthorization } from '../cache.js';
import { getSecureCorsHeaders, checkRateLimit, getClientIP, extractBearerToken, secureCompare } from '../security.js';
import { resolveRequestUrl } from '../getRequestBaseUrl.js';
import { getSupabaseConfig } from '../getSupabaseConfig.js';
import { getCallerContext, isAdminOrHr } from '../callerContext.js';
import { evaluateCompanyRisk } from '../../../modules/alerts/operationalRiskEngine';

const ALLOWED_METHODS = 'GET, OPTIONS';

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

  const { data: alerts, error: aErr } = await supabase
    .from('operational_alerts')
    .select('*')
    .eq('company_id', companyId)
    .eq('resolved', false);

  if (aErr) {
    console.error('[api/operational-risk] alerts', aErr);
    return noCache(Response.json({ success: false, error: 'DB_ERROR' }, { status: 500, headers: corsHeaders }));
  }

  const { data: sla, error: sErr } = await supabase
    .from('operational_sla_config')
    .select('*')
    .eq('company_id', companyId)
    .maybeSingle();

  if (sErr) {
    console.error('[api/operational-risk] sla', sErr);
    return noCache(Response.json({ success: false, error: 'DB_ERROR' }, { status: 500, headers: corsHeaders }));
  }

  const result = evaluateCompanyRisk({ alerts: alerts ?? [], sla: sla ?? null });

  let res = Response.json(
    {
      success: true,
      data: {
        ...result,
        sla: sla ?? null,
      },
    },
    { status: 200, headers: corsHeaders },
  );
  varyAuthorization(res);
  res = cachePrivate(res, 5);
  return res;
}

export default { fetch: handler };
