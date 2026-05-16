/**
 * GET /api/operational-alerts?company_id=...
 * PATCH /api/operational-alerts/:id/resolve
 */

import { createClient } from '@supabase/supabase-js';
import { cachePrivate, noCache, varyAuthorization } from '../cache.js';
import { getSecureCorsHeaders, checkRateLimit, getClientIP, extractBearerToken, secureCompare } from '../security.js';
import { resolveRequestUrl } from '../getRequestBaseUrl.js';
import { getSupabaseConfig } from '../getSupabaseConfig.js';
import { getCallerContext, isAdminOrHr } from '../callerContext.js';
import { evaluateAndNotifyCompanyOperationalRisk } from '../../../modules/alerts/operationalAlertsEngine';
import { runRiskOnce } from '../../../modules/alerts/riskExecutionGuard';
import { logAudit } from '../../../modules/audit/auditLogger';

const ALLOWED_METHODS = 'GET, PATCH, OPTIONS';

type AlertRow = Record<string, unknown> & {
  id: string;
  employee_id: string;
};

async function handler(request: Request): Promise<Response> {
  const route = 'operational-alerts';
  const corsHeaders = getSecureCorsHeaders(request, {
    allowMethods: ALLOWED_METHODS,
    allowHeaders: 'Content-Type, Authorization',
  });

  try {
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

    const reqUrl = resolveRequestUrl(request);
    const pathname = reqUrl.pathname.replace(/\/+$/, '') || '';
    const resolveMatch = pathname.match(/^\/api\/operational-alerts\/([^/]+)\/resolve$/);
    console.log('[OP API START]', {
      route,
      query: Object.fromEntries(reqUrl.searchParams.entries()),
      pathname,
      method: request.method,
    });

    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      console.error('[CONFIG ERROR] SERVICE_ROLE_KEY_MISSING');
      return noCache(
        Response.json(
          { success: false, error: 'CONFIG_ERROR', detail: 'SUPABASE_SERVICE_ROLE_KEY missing' },
          { status: 500, headers: corsHeaders },
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

    const { error: testError } = await supabase.from('operational_day_status').select('id').limit(1);
    if (testError) {
      console.error('[DB ERROR]', testError);
      return noCache(
        Response.json(
          { success: false, error: 'DB_ERROR', detail: testError.message },
          { status: 500, headers: corsHeaders },
        ),
      );
    }

    if (request.method === 'PATCH' && resolveMatch) {
    const alertId = resolveMatch[1]?.trim();
    if (!alertId) {
      return noCache(Response.json({ success: false, error: 'MISSING_ALERT_ID' }, { status: 400, headers: corsHeaders }));
    }

    const { data: alertRow, error: preErr } = await supabase
      .from('operational_alerts')
      .select('id, company_id, resolved')
      .eq('id', alertId)
      .maybeSingle();

    if (preErr || !alertRow) {
      return noCache(Response.json({ success: false, error: 'NOT_FOUND' }, { status: 404, headers: corsHeaders }));
    }

    const alertCompanyId = String((alertRow as { company_id: string }).company_id);
    let actorId: string | null = null;

    if (!useServiceRole) {
      if (!bearer || !anonKey) {
        return noCache(Response.json({ success: false, error: 'UNAUTHORIZED' }, { status: 401, headers: corsHeaders }));
      }
      const caller = await getCallerContext(url, anonKey, supabase, bearer);
      if (!caller || !isAdminOrHr(caller.role)) {
        return noCache(Response.json({ success: false, error: 'FORBIDDEN' }, { status: 403, headers: corsHeaders }));
      }
      if (caller.companyId !== alertCompanyId) {
        return noCache(Response.json({ success: false, error: 'FORBIDDEN' }, { status: 403, headers: corsHeaders }));
      }
      actorId = caller.userId;
    }

    const resolvedAt = new Date().toISOString();
    const { data: alertResolvedRows, error: updErr } = await supabase
      .from('operational_alerts')
      .update({ resolved: true, resolved_at: resolvedAt })
      .eq('id', alertId)
      .eq('resolved', false)
      .select('id');

    if (updErr) {
      console.error('[api/operational-alerts]', updErr);
      return noCache(Response.json({ success: false, error: 'DB_ERROR' }, { status: 500, headers: corsHeaders }));
    }

    const didResolveAlertThisRequest = Array.isArray(alertResolvedRows) && alertResolvedRows.length > 0;

    const { error: taskCloseErr } = await supabase
      .from('operational_tasks')
      .update({
        status: 'done',
        resolved_at: resolvedAt,
        updated_at: resolvedAt,
      })
      .eq('related_alert_id', alertId)
      .neq('status', 'done');

    if (taskCloseErr) {
      console.error('[api/operational-alerts] close linked tasks', taskCloseErr);
      if (didResolveAlertThisRequest) {
        await supabase
          .from('operational_alerts')
          .update({ resolved: false, resolved_at: null })
          .eq('id', alertId);
      }
      return noCache(Response.json({ success: false, error: 'DB_ERROR' }, { status: 500, headers: corsHeaders }));
    }

    try {
      await runRiskOnce(alertCompanyId, async () => {
        await evaluateAndNotifyCompanyOperationalRisk(supabase, alertCompanyId);
      });
    } catch (e) {
      console.error('[api/operational-alerts] risk after alert resolve', e);
    }

    if (didResolveAlertThisRequest) {
      const wasResolved = !!(alertRow as { resolved?: boolean }).resolved;
      await logAudit({
        supabase,
        companyId: alertCompanyId,
        actorId,
        entityType: 'alert',
        entityId: alertId,
        action: 'resolved',
        before: { resolved: wasResolved },
        after: { resolved: true, resolved_at: resolvedAt },
        metadata: { via: useServiceRole ? 'service_role' : 'session' },
      });
    }

      return noCache(Response.json({ success: true, id: alertId, resolved_at: resolvedAt }, { status: 200, headers: corsHeaders }));
    }

    if (request.method !== 'GET') {
      return noCache(Response.json({ success: false, error: 'METHOD_NOT_ALLOWED' }, { status: 405, headers: corsHeaders }));
    }

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

    const { data: rows, error } = await supabase
      .from('operational_alerts')
      .select('*')
      .eq('company_id', companyId)
      .eq('resolved', false)
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) {
      console.error('[api/operational-alerts]', error);
      return noCache(Response.json({ success: false, error: 'DB_ERROR' }, { status: 500, headers: corsHeaders }));
    }

    const list = (rows ?? []) as AlertRow[];
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
  } catch (error) {
    console.error('[OPERATIONAL API ERROR]', {
      route: request.url,
      message: (error as { message?: string } | null)?.message,
      stack: (error as { stack?: string } | null)?.stack,
    });

    return noCache(
      Response.json(
        {
          success: false,
          error: 'INTERNAL_ERROR',
          detail: (error as { message?: string } | null)?.message,
        },
        { status: 500, headers: corsHeaders },
      ),
    );
  }
}

export default { fetch: handler };
