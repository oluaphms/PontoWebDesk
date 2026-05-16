/**
 * GET /api/operational-tasks?company_id=...
 * PATCH /api/operational-tasks/:id/complete
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

type TaskRow = Record<string, unknown> & {
  id: string;
  employee_id: string | null;
};

async function handler(request: Request): Promise<Response> {
  const route = 'operational-tasks';
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
    const completeMatch = pathname.match(/^\/api\/operational-tasks\/([^/]+)\/complete$/);
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

    if (request.method === 'PATCH' && completeMatch) {
    const taskId = completeMatch[1]?.trim();
    if (!taskId) {
      return noCache(Response.json({ success: false, error: 'MISSING_TASK_ID' }, { status: 400, headers: corsHeaders }));
    }

    const { data: task, error: taskFetchErr } = await supabase
      .from('operational_tasks')
      .select('*')
      .eq('id', taskId)
      .maybeSingle();

    if (taskFetchErr) {
      console.error('[api/operational-tasks] fetch task', taskFetchErr);
      return noCache(Response.json({ success: false, error: 'DB_ERROR' }, { status: 500, headers: corsHeaders }));
    }
    if (!task) {
      return noCache(Response.json({ success: false, error: 'TASK_NOT_FOUND' }, { status: 404, headers: corsHeaders }));
    }

    const companyIdStr = String((task as { company_id: string }).company_id);
    let actorId: string | null = null;

    if (!useServiceRole) {
      if (!bearer || !anonKey) {
        return noCache(Response.json({ success: false, error: 'UNAUTHORIZED' }, { status: 401, headers: corsHeaders }));
      }
      const caller = await getCallerContext(url, anonKey, supabase, bearer);
      if (!caller || !isAdminOrHr(caller.role)) {
        return noCache(Response.json({ success: false, error: 'FORBIDDEN' }, { status: 403, headers: corsHeaders }));
      }
      if (caller.companyId !== companyIdStr) {
        return noCache(Response.json({ success: false, error: 'FORBIDDEN' }, { status: 403, headers: corsHeaders }));
      }
      actorId = caller.userId;
    }

    const taskStatus = String((task as { status?: string }).status ?? '');
    if (taskStatus === 'done') {
      const priorResolved = (task as { resolved_at?: string | null }).resolved_at;
      return noCache(
        Response.json(
          {
            success: true,
            id: taskId,
            idempotent: true,
            resolved_at: priorResolved ?? null,
          },
          { status: 200, headers: corsHeaders },
        ),
      );
    }

    const currentVersion = Number((task as { version?: number }).version ?? 0);
    if (!Number.isFinite(currentVersion) || currentVersion < 0) {
      return noCache(Response.json({ success: false, error: 'INVALID_TASK_VERSION' }, { status: 500, headers: corsHeaders }));
    }

    const resolvedAt = new Date().toISOString();
    const relatedRaw = (task as { related_alert_id: string | null }).related_alert_id;
    const relatedAlertId = relatedRaw ? String(relatedRaw).trim() : '';

    const { data: updatedTask, error: taskUpdErr } = await supabase
      .from('operational_tasks')
      .update({
        status: 'done',
        resolved_at: resolvedAt,
        updated_at: resolvedAt,
        version: currentVersion + 1,
      })
      .eq('id', taskId)
      .eq('version', currentVersion)
      .select()
      .maybeSingle();

    if (taskUpdErr) {
      console.error('[api/operational-tasks]', taskUpdErr);
      return noCache(Response.json({ success: false, error: 'DB_ERROR' }, { status: 500, headers: corsHeaders }));
    }
    if (!updatedTask) {
      return noCache(
        Response.json(
          {
            success: false,
            error: 'TASK_CONFLICT',
            detail: 'Task já foi atualizada por outro processo',
          },
          { status: 409, headers: corsHeaders },
        ),
      );
    }

    if (relatedAlertId) {
      const { error: alertErr } = await supabase
        .from('operational_alerts')
        .update({
          resolved: true,
          resolved_at: resolvedAt,
        })
        .eq('id', relatedAlertId)
        .eq('resolved', false);

      if (alertErr) {
        console.error('[api/operational-tasks] resolve linked alert', alertErr);
        const { error: revErr } = await supabase
          .from('operational_tasks')
          .update({
            status: 'pending',
            resolved_at: null,
            updated_at: new Date().toISOString(),
            version: currentVersion,
          })
          .eq('id', taskId)
          .eq('version', currentVersion + 1);
        if (revErr) {
          console.error('[api/operational-tasks] revert task after alert failure', revErr);
        }
        return noCache(Response.json({ success: false, error: 'DB_ERROR' }, { status: 500, headers: corsHeaders }));
      }

      console.log('[TASK -> ALERT RESOLVED]', {
        task_id: taskId,
        alert_id: relatedAlertId,
      });
    }

    try {
      await runRiskOnce(companyIdStr, async () => {
        await evaluateAndNotifyCompanyOperationalRisk(supabase, companyIdStr);
      });
    } catch (e) {
      console.error('[api/operational-tasks] risk after task complete', e);
    }

    console.log('[TASK COMPLETED]', {
      task_id: taskId,
      company_id: companyIdStr,
    });

    await logAudit({
      supabase,
      companyId: companyIdStr,
      actorId,
      entityType: 'task',
      entityId: taskId,
      action: 'resolved',
      before: {
        status: taskStatus,
        version: currentVersion,
        related_alert_id: relatedRaw ?? null,
      },
      after: {
        status: String((updatedTask as { status?: string }).status ?? 'done'),
        version: Number((updatedTask as { version?: number }).version ?? currentVersion + 1),
        resolved_at: resolvedAt,
      },
      metadata: {
        related_alert_id: relatedAlertId || null,
        via: useServiceRole ? 'service_role' : 'session',
      },
    });

      return noCache(Response.json({ success: true, id: taskId, resolved_at: resolvedAt }, { status: 200, headers: corsHeaders }));
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
      .from('operational_tasks')
      .select('*')
      .eq('company_id', companyId)
      .neq('status', 'done')
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) {
      console.error('[api/operational-tasks]', error);
      return noCache(Response.json({ success: false, error: 'DB_ERROR' }, { status: 500, headers: corsHeaders }));
    }

    const list = (rows ?? []) as TaskRow[];
    const ids = [...new Set(list.map((r) => String(r.employee_id || '').trim()).filter(Boolean))];
    let nameById: Record<string, string | null> = {};
    if (ids.length > 0) {
      const { data: users } = await supabase.from('users').select('id,nome').eq('company_id', companyId).in('id', ids);
      nameById = Object.fromEntries((users ?? []).map((u: { id: string; nome: string | null }) => [u.id, u.nome ?? null]));
    }

    const data = list.map((row) => ({
      ...row,
      employee_name: row.employee_id ? nameById[String(row.employee_id)] ?? null : null,
    }));

    let res = Response.json({ success: true, data }, { status: 200, headers: corsHeaders });
    varyAuthorization(res);
    res = cachePrivate(res, 5);
    return res;
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    console.error('[OP API ERROR]', {
      route,
      message: err.message,
      stack: err.stack,
    });
    return noCache(
      Response.json(
        { success: false, error: 'INTERNAL_ERROR', detail: err.message || 'unknown' },
        { status: 500, headers: corsHeaders },
      ),
    );
  }
}

export default { fetch: handler };
