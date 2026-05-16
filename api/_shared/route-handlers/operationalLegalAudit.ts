/**
 * POST /api/operational/legal-audit
 * Insere em operational_legal_audit_trail via service_role (evita 403 RLS no browser).
 */

import { noCache } from '../cache.js';
import { getSecureCorsHeaders, checkRateLimit, getClientIP, extractBearerToken } from '../security.js';
import { getSupabaseConfig } from '../getSupabaseConfig.js';
import { getCallerContext, isAdminOrHr } from '../callerContext.js';
import {
  createOperationalServiceClient,
  degradedMutationResponse,
  logOperationalApiError,
} from '../operationalApiResilience.js';

const ALLOWED_METHODS = 'POST, OPTIONS';
const ROUTE = 'operational-legal-audit';

type Body = {
  company_id?: string;
  action?: string;
  source?: string | null;
  ip_address?: string | null;
  device_key?: string | null;
  payload_before?: Record<string, unknown> | null;
  payload_after?: Record<string, unknown> | null;
  correlation_id?: string | null;
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
    if (request.method !== 'POST') {
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

    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return degradedMutationResponse(corsHeaders, ROUTE, 'CONFIG_ERROR', 'SUPABASE_SERVICE_ROLE_KEY missing');
    }

    let url: string;
    try {
      ({ url } = getSupabaseConfig());
    } catch {
      return degradedMutationResponse(corsHeaders, ROUTE, 'SUPABASE_ENV_MISSING');
    }

    const anonKey = (process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '').trim();
    const bearer = extractBearerToken(request);
    if (!bearer || !anonKey) {
      return noCache(Response.json({ success: false, error: 'UNAUTHORIZED' }, { status: 401, headers: corsHeaders }));
    }

    const supabase = createOperationalServiceClient();
    const caller = await getCallerContext(url, anonKey, supabase, bearer);
    if (!caller || !isAdminOrHr(caller.role)) {
      return noCache(Response.json({ success: false, error: 'FORBIDDEN' }, { status: 403, headers: corsHeaders }));
    }

    let body: Body = {};
    try {
      body = (await request.json()) as Body;
    } catch {
      return noCache(Response.json({ success: false, error: 'INVALID_JSON' }, { status: 400, headers: corsHeaders }));
    }

    const companyId = String(body.company_id ?? caller.companyId).trim();
    const action = String(body.action ?? '').trim();
    if (!companyId || !action) {
      return noCache(Response.json({ success: false, error: 'MISSING_FIELDS' }, { status: 400, headers: corsHeaders }));
    }
    if (companyId !== caller.companyId) {
      return noCache(Response.json({ success: false, error: 'FORBIDDEN' }, { status: 403, headers: corsHeaders }));
    }

    const { error } = await supabase.from('operational_legal_audit_trail').insert({
      company_id: companyId,
      actor_id: caller.userId,
      action,
      source: body.source ?? null,
      ip_address: body.ip_address ?? null,
      device_key: body.device_key ?? null,
      payload_before: body.payload_before ?? null,
      payload_after: body.payload_after ?? null,
      correlation_id: body.correlation_id ?? null,
    });

    if (error) {
      console.error('[api/operational-legal-audit]', error);
      return degradedMutationResponse(corsHeaders, ROUTE, 'DB_ERROR', error.message);
    }

    return noCache(Response.json({ success: true }, { status: 200, headers: corsHeaders }));
  } catch (error) {
    logOperationalApiError(ROUTE, error);
    return degradedMutationResponse(corsHeaders, ROUTE, 'INTERNAL_ERROR', (error as { message?: string } | null)?.message);
  }
}

export default { fetch: handler };
