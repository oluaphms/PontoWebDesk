/**
 * GET /api/operational-risk?company_id=...
 */

import { cachePrivate, noCache, varyAuthorization } from '../cache.js';
import { getSecureCorsHeaders, checkRateLimit, getClientIP, extractBearerToken, secureCompare } from '../security.js';
import { resolveRequestUrl } from '../getRequestBaseUrl.js';
import { getSupabaseConfig } from '../getSupabaseConfig.js';
import { getCallerContext, isAdminOrHr } from '../callerContext.js';
import { evaluateCompanyRisk } from '../../../modules/alerts/operationalRiskEngine';
import {
  createOperationalServiceClient,
  degradedObjectResponse,
  logOperationalApiError,
  OPERATIONAL_QUERY_LIMIT,
  verifyOperationalCoreTables,
  withQueryTimeout,
  isOperationalTimeoutError,
} from '../operationalApiResilience.js';
import { OPERATIONAL_ALERT_COLUMNS, OPERATIONAL_SLA_CONFIG_COLUMNS } from '../operationalSelectColumns.js';

const ALLOWED_METHODS = 'GET, OPTIONS';
const ROUTE = 'operational-risk';

async function handler(request: Request): Promise<Response> {
  const corsHeaders = getSecureCorsHeaders(request, {
    allowMethods: ALLOWED_METHODS,
    allowHeaders: 'Content-Type, Authorization',
  });

  try {
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
    console.log('[OP API START]', { route: ROUTE, query: Object.fromEntries(sp.entries()) });
    const companyId = sp.get('company_id')?.trim() || '';
    if (!companyId) {
      return noCache(Response.json({ success: false, error: 'MISSING_COMPANY_ID' }, { status: 400, headers: corsHeaders }));
    }

    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      console.error('[CONFIG ERROR] SERVICE_ROLE_KEY_MISSING', { route: ROUTE });
      return degradedObjectResponse(corsHeaders, ROUTE, { level: 'unknown', score: 0, sla: null }, 'SUPABASE_SERVICE_ROLE_KEY missing');
    }

    let url: string;
    try {
      ({ url } = getSupabaseConfig());
    } catch {
      return degradedObjectResponse(corsHeaders, ROUTE, { level: 'unknown', score: 0, sla: null }, 'SUPABASE_ENV_MISSING');
    }

    const anonKey = (process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '').trim();
    const apiKey = (process.env.API_KEY || '').trim();
    const bearer = extractBearerToken(request);
    const useServiceRole = !!(apiKey && bearer && secureCompare(bearer, apiKey));

    const supabase = createOperationalServiceClient();

    const schema = await verifyOperationalCoreTables(supabase);
    if (!schema.ok) {
      return degradedObjectResponse(corsHeaders, ROUTE, { level: 'unknown', score: 0, sla: null }, `missing_tables:${schema.missing.join(',')}`);
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

    const { data: alerts, error: aErr } = await withQueryTimeout(
      supabase
        .from('operational_alerts')
        .select(OPERATIONAL_ALERT_COLUMNS)
        .eq('company_id', companyId)
        .eq('resolved', false)
        .limit(OPERATIONAL_QUERY_LIMIT),
      `${ROUTE}.alerts`,
    );

    if (aErr) {
      console.error('[api/operational-risk] alerts', aErr);
      return degradedObjectResponse(corsHeaders, ROUTE, { level: 'unknown', score: 0, sla: null }, aErr.message);
    }

    const { data: sla, error: sErr } = await withQueryTimeout(
      supabase.from('operational_sla_config').select(OPERATIONAL_SLA_CONFIG_COLUMNS).eq('company_id', companyId).maybeSingle(),
      `${ROUTE}.sla`,
    );

    if (sErr) {
      console.error('[api/operational-risk] sla', sErr);
      return degradedObjectResponse(corsHeaders, ROUTE, { level: 'unknown', score: 0, sla: null }, sErr.message);
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
  } catch (error) {
    logOperationalApiError(ROUTE, error);
    if (isOperationalTimeoutError(error)) {
      return degradedObjectResponse(corsHeaders, ROUTE, { level: 'unknown', score: 0, sla: null }, (error as Error).message);
    }
    return degradedObjectResponse(corsHeaders, ROUTE, { level: 'unknown', score: 0, sla: null }, (error as { message?: string } | null)?.message);
  }
}

export default { fetch: handler };
