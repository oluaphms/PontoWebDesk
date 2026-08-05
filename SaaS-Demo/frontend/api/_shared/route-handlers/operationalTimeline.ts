import { observabilityConsole } from '../../../src/shared/logger/observabilityConsole.js';
﻿/**
 * GET /api/operational-timeline?company_id=&employee_id=&date=YYYY-MM-DD
 */

import { createClient } from '@supabase/supabase-js';
import { cachePrivate, noCache, varyAuthorization } from '../cache.js';
import { getSecureCorsHeaders, checkRateLimit, getClientIP, extractBearerToken, secureCompare } from '../security.js';
import { resolveRequestUrl } from '../getRequestBaseUrl.js';
import { getSupabaseConfig } from '../getSupabaseConfig.js';
import { getCallerContext, isAdminOrHr } from '../callerContext.js';
import {
  eventFromAlert,
  eventFromAudit,
  eventFromPunch,
  eventFromRepPending,
  eventFromTask,
  mergeOperationalTimelineParts,
} from '../../../modules/timeline/operationalTimeline';

const ALLOWED_METHODS = 'GET, OPTIONS';

function utcDayRange(ymd: string): { start: string; end: string } {
  const [y, m, d] = ymd.split('-').map((x) => parseInt(x, 10));
  if (!y || !m || !d) throw new Error('bad date');
  const start = new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0));
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return { start: start.toISOString(), end: end.toISOString() };
}

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

  const reqUrl = resolveRequestUrl(request);
  const companyId = reqUrl.searchParams.get('company_id')?.trim() || '';
  const employeeId = reqUrl.searchParams.get('employee_id')?.trim() || '';
  const date = reqUrl.searchParams.get('date')?.trim() || '';

  if (!companyId || !employeeId || !date) {
    return noCache(Response.json({ success: false, error: 'MISSING_PARAMS' }, { status: 400, headers: corsHeaders }));
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return noCache(Response.json({ success: false, error: 'INVALID_DATE' }, { status: 400, headers: corsHeaders }));
  }

  let day: { start: string; end: string };
  try {
    day = utcDayRange(date);
  } catch {
    return noCache(Response.json({ success: false, error: 'INVALID_DATE' }, { status: 400, headers: corsHeaders }));
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

  const [
    { data: punches, error: punchErr },
    { data: repRows, error: repErr },
    { data: alertRows, error: alertErr },
    { data: taskRows, error: taskErr },
  ] = await Promise.all([
    supabase
      .from('time_records')
      .select('id, type, timestamp, created_at')
      .eq('company_id', companyId)
      .eq('user_id', employeeId)
      .gte('timestamp', day.start)
      .lt('timestamp', day.end)
      .order('timestamp', { ascending: true }),
    supabase
      .from('rep_punch_logs')
      .select('id, data_hora, tipo_marcacao, time_record_id')
      .eq('company_id', companyId)
      .eq('resolved_user_id', employeeId)
      .gte('data_hora', day.start)
      .lt('data_hora', day.end)
      .is('time_record_id', null)
      .order('data_hora', { ascending: true }),
    supabase
      .from('operational_alerts')
      .select('id, alert_type, message, severity, resolved, created_at, resolved_at')
      .eq('company_id', companyId)
      .eq('employee_id', employeeId)
      .eq('date', date),
    supabase
      .from('operational_tasks')
      .select('id, task_type, title, description, priority, status, related_alert_id, created_at, resolved_at')
      .eq('company_id', companyId)
      .eq('employee_id', employeeId)
      .eq('related_date', date),
  ]);

  if (punchErr) observabilityConsole.error('[api/operational-timeline] punches', punchErr);
  if (repErr) observabilityConsole.error('[api/operational-timeline] rep', repErr);
  if (alertErr) observabilityConsole.error('[api/operational-timeline] alerts', alertErr);
  if (taskErr) observabilityConsole.error('[api/operational-timeline] tasks', taskErr);

  const taskIds = new Set((taskRows ?? []).map((r: { id: string }) => r.id));
  const alertIds = new Set((alertRows ?? []).map((r: { id: string }) => r.id));
  const entityIdSet = new Set<string>([...taskIds, ...alertIds]);

  const { data: auditRows, error: auditErr } = await supabase
    .from('operational_audit_log')
    .select('id, entity_type, entity_id, action, created_at, metadata, actor_id')
    .eq('company_id', companyId)
    .gte('created_at', day.start)
    .lt('created_at', day.end)
    .order('created_at', { ascending: true })
    .limit(300);

  if (auditErr) observabilityConsole.error('[api/operational-timeline] audit', auditErr);

  const auditsFiltered = (auditRows ?? []).filter((r: { entity_id: string | null }) => {
    const eid = r.entity_id ? String(r.entity_id) : '';
    return eid && entityIdSet.has(eid);
  });

  const actorIds = [...new Set(auditsFiltered.map((r: { actor_id: string | null }) => String(r.actor_id || '').trim()).filter(Boolean))];
  let actorNameById: Record<string, string | null> = {};
  if (actorIds.length > 0) {
    const { data: users } = await supabase.from('users').select('id,nome').eq('company_id', companyId).in('id', actorIds);
    actorNameById = Object.fromEntries((users ?? []).map((u: { id: string; nome: string | null }) => [u.id, u.nome ?? null]));
  }

  const punchesEvents = (punches ?? []).map((r: Record<string, unknown>) =>
    eventFromPunch({
      id: String(r.id),
      type: r.type as string | null,
      timestamp: r.timestamp as string | null,
      created_at: r.created_at as string | null,
    }),
  );

  const repEvents = (repRows ?? []).map((r: Record<string, unknown>) =>
    eventFromRepPending({
      id: String(r.id),
      data_hora: String(r.data_hora),
      tipo_marcacao: r.tipo_marcacao as string | null,
    }),
  );

  const alertEvents = (alertRows ?? []).map((r: Record<string, unknown>) =>
    eventFromAlert({
      id: String(r.id),
      alert_type: String(r.alert_type),
      message: String(r.message ?? ''),
      severity: String(r.severity ?? 'medium'),
      resolved: !!r.resolved,
      created_at: r.created_at as string | null,
      resolved_at: r.resolved_at as string | null,
    }),
  );

  const taskEvents = (taskRows ?? []).map((r: Record<string, unknown>) =>
    eventFromTask({
      id: String(r.id),
      task_type: String(r.task_type),
      title: r.title as string | null,
      description: r.description as string | null,
      priority: String(r.priority ?? 'medium'),
      status: String(r.status ?? 'pending'),
      related_alert_id: r.related_alert_id as string | null,
      created_at: r.created_at as string | null,
      resolved_at: r.resolved_at as string | null,
    }),
  );

  const auditEvents = auditsFiltered.map((r: Record<string, unknown>) => {
    const aid = r.actor_id ? String(r.actor_id) : '';
    const name = aid ? actorNameById[aid] ?? null : null;
    return eventFromAudit(
      {
        id: String(r.id),
        entity_type: String(r.entity_type),
        entity_id: r.entity_id ? String(r.entity_id) : null,
        action: String(r.action),
        created_at: String(r.created_at),
        metadata: (r.metadata as Record<string, unknown> | null) ?? null,
      },
      name,
    );
  });

  const data = mergeOperationalTimelineParts({
    punches: punchesEvents,
    repPending: repEvents,
    alerts: alertEvents,
    tasks: taskEvents,
    audits: auditEvents,
  });

  let res = Response.json({ success: true, data }, { status: 200, headers: corsHeaders });
  varyAuthorization(res);
  res = cachePrivate(res, 5);
  return res;
}

export default { fetch: handler };
