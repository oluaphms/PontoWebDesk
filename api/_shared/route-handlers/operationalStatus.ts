/**
 * GET /api/operational-status?company_id=...&date=YYYY-MM-DD (opcional)
 */

import { cachePrivate, noCache, varyAuthorization } from '../cache.js';
import { getSecureCorsHeaders, checkRateLimit, getClientIP, extractBearerToken, secureCompare } from '../security.js';
import { resolveRequestUrl } from '../getRequestBaseUrl.js';
import { getSupabaseConfig } from '../getSupabaseConfig.js';
import { getCallerContext, isAdminOrHr } from '../callerContext.js';
import {
  createOperationalServiceClient,
  degradedListResponse,
  fetchUserNamesByIds,
  logOperationalApiError,
  OPERATIONAL_QUERY_LIMIT,
  verifyOperationalCoreTables,
  withQueryTimeout,
  isOperationalTimeoutError,
} from '../operationalApiResilience.js';

const ALLOWED_METHODS = 'GET, OPTIONS';
const ROUTE = 'operational-status';

type OperationalStatusRow = Record<string, unknown> & {
  employee_id: string;
};

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
    const date = sp.get('date')?.trim() || null;

    if (!companyId) {
      return noCache(Response.json({ success: false, error: 'MISSING_COMPANY_ID' }, { status: 400, headers: corsHeaders }));
    }

    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      console.error('[CONFIG ERROR] SERVICE_ROLE_KEY_MISSING', { route: ROUTE });
      return degradedListResponse(corsHeaders, ROUTE, 'SUPABASE_SERVICE_ROLE_KEY missing');
    }

    let url: string;
    try {
      ({ url } = getSupabaseConfig());
    } catch {
      return degradedListResponse(corsHeaders, ROUTE, 'SUPABASE_ENV_MISSING');
    }

    const anonKey = (process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '').trim();
    const apiKey = (process.env.API_KEY || '').trim();
    const bearer = extractBearerToken(request);
    const useServiceRole = !!(apiKey && bearer && secureCompare(bearer, apiKey));

    const supabase = createOperationalServiceClient();

    const schema = await verifyOperationalCoreTables(supabase);
    if (!schema.ok) {
      console.error('[DB SCHEMA]', { route: ROUTE, missing: schema.missing });
      return degradedListResponse(corsHeaders, ROUTE, `missing_tables:${schema.missing.join(',')}`);
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

    let q = supabase
      .from('operational_day_status')
      .select('*')
      .eq('company_id', companyId)
      .order('date', { ascending: false })
      .limit(OPERATIONAL_QUERY_LIMIT);

    if (date) {
      q = q.eq('date', date);
    }

    const { data: rows, error } = await withQueryTimeout(q, `${ROUTE}.list`);
    if (error) {
      console.error('[api/operational-status]', error);
      return degradedListResponse(corsHeaders, ROUTE, error.message);
    }

    const list = (rows ?? []) as OperationalStatusRow[];
    const ids = [...new Set(list.map((r) => String(r.employee_id || '').trim()).filter(Boolean))];
    let nameById: Record<string, string | null> = {};
    try {
      nameById = await fetchUserNamesByIds(supabase, companyId, ids);
    } catch (nameErr) {
      logOperationalApiError(`${ROUTE}.users`, nameErr);
    }

    const data = list.map((row) => ({
      ...row,
      employee_name: nameById[String(row.employee_id)] ?? null,
    }));

    let res = Response.json({ success: true, data }, { status: 200, headers: corsHeaders });
    varyAuthorization(res);
    res = cachePrivate(res, 5);
    return res;
  } catch (error) {
    logOperationalApiError(ROUTE, error);
    if (isOperationalTimeoutError(error)) {
      return degradedListResponse(corsHeaders, ROUTE, (error as Error).message);
    }
    return degradedListResponse(corsHeaders, ROUTE, (error as { message?: string } | null)?.message);
  }
}

export default { fetch: handler };
