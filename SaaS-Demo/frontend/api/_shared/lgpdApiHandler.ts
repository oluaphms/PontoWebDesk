import { observabilityConsole } from '../../src/shared/logger/observabilityConsole.js';
/**
 * LGPD: portabilidade, exclusão (anonimização), consentimento e retenção.
 * Rotas públicas: /api/lgpd/* (rewrite Vercel → /api/operational/lgpd/*)
 * GET  /api/lgpd/export?user_id=...&format=json|csv
 * POST /api/lgpd/delete  { user_id }
 * POST /api/lgpd/consent { user_id, accepted, version }
 * POST /api/lgpd/retention  (admin ou X-Cron-Secret)
 */

import { createClient } from '@supabase/supabase-js';
import { resolveRequestUrl } from './getRequestBaseUrl.js';
import { getSupabaseConfig, getSupabaseUrlForServer } from './getSupabaseConfig.js';
import { getCallerContext, isAdminOrHr } from './callerContext.js';
import {
  auditLog,
  canAccessUserData,
  canManageLgpd,
  logExport,
  logViewSensitiveData,
  runRetentionForCompany,
} from './lgpdGovernance.js';
import { getSecureCorsHeaders } from './security.js';
import { noCache } from './cache.js';

function corsFor(request: Request): Record<string, string> {
  return getSecureCorsHeaders(request, {
    allowMethods: 'GET, POST, OPTIONS',
    allowHeaders: 'Content-Type, Authorization, X-Cron-Secret',
  });
}

function json(body: unknown, status: number, headers: Record<string, string>): Response {
  return noCache(Response.json(body, { status, headers: { ...headers, 'Content-Type': 'application/json' } }));
}

function bearerToken(request: Request): string | null {
  return request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '').trim() || null;
}

function slugSegment(request: Request): string {
  const url = resolveRequestUrl(request);
  const parts = url.pathname.replace(/\/+$/, '').split('/').filter(Boolean);
  const lgpdIdx = parts.indexOf('lgpd');
  const after = lgpdIdx >= 0 ? parts.slice(lgpdIdx + 1) : [];
  return after[0] ?? '';
}

function exportToCsv(payload: Record<string, unknown>): string {
  const profile = (payload.profile as Record<string, unknown>) ?? {};
  const lines: string[] = ['section,key,value'];
  for (const [k, v] of Object.entries(profile)) {
    lines.push(`profile,${k},"${String(v ?? '').replace(/"/g, '""')}"`);
  }
  const punches = (payload.rep_punch_logs as unknown[]) ?? [];
  lines.push('rep_punch_logs,count,' + punches.length);
  return lines.join('\r\n');
}

async function handleExport(request: Request, headers: Record<string, string>): Promise<Response> {
  const token = bearerToken(request);
  if (!token) return json({ error: 'Authorization obrigatório' }, 401, headers);

  const url = resolveRequestUrl(request);
  const targetUserId = (url.searchParams.get('user_id') || url.searchParams.get('employee_id') || '').trim();
  const format = (url.searchParams.get('format') || 'json').toLowerCase();
  if (!targetUserId) return json({ error: 'user_id obrigatório' }, 400, headers);

  const anonKey = (process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '').trim();
  const supabaseUrl = getSupabaseUrlForServer();
  if (!anonKey || !supabaseUrl) return json({ error: 'Supabase não configurado' }, 500, headers);

  const { url: svcUrl, serviceKey } = getSupabaseConfig();
  const serviceClient = createClient(svcUrl, serviceKey, { auth: { persistSession: false } });
  const caller = await getCallerContext(supabaseUrl, anonKey, serviceClient, token);
  if (!caller) return json({ error: 'Não autorizado' }, 401, headers);
  if (!canAccessUserData(caller, targetUserId)) {
    return json({ error: 'Acesso negado a dados sensíveis' }, 403, headers);
  }

  const { data: target } = await serviceClient
    .from('users')
    .select('id, company_id')
    .eq('id', targetUserId)
    .maybeSingle();
  if (!target || String(target.company_id) !== caller.companyId) {
    return json({ error: 'Colaborador não encontrado na empresa' }, 404, headers);
  }

  await logViewSensitiveData(serviceClient, caller, 'users', targetUserId, { reason: 'lgpd_export' }, request);

  const { data, error } = await serviceClient.rpc('lgpd_export_user_data', {
    p_user_id: targetUserId,
    p_requester_id: caller.userId,
  });
  if (error) return json({ error: error.message }, 500, headers);
  const payload = (data ?? {}) as Record<string, unknown>;
  if (payload.success === false) return json(payload, 404, headers);

  await logExport(serviceClient, caller, 'users', { targetUserId, format }, request);

  if (format === 'csv') {
    const body = exportToCsv(payload);
    return noCache(
      new Response(body, {
        status: 200,
        headers: {
          ...headers,
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="lgpd_export_${targetUserId}.csv"`,
        },
      }),
    );
  }

  return json(payload, 200, headers);
}

async function handleDelete(request: Request, headers: Record<string, string>): Promise<Response> {
  const token = bearerToken(request);
  if (!token) return json({ error: 'Authorization obrigatório' }, 401, headers);

  let body: { user_id?: string; employee_id?: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'JSON inválido' }, 400, headers);
  }
  const targetUserId = String(body.user_id || body.employee_id || '').trim();
  if (!targetUserId) return json({ error: 'user_id obrigatório' }, 400, headers);

  const anonKey = (process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '').trim();
  const supabaseUrl = getSupabaseUrlForServer();
  const { url: svcUrl, serviceKey } = getSupabaseConfig();
  const serviceClient = createClient(svcUrl, serviceKey, { auth: { persistSession: false } });
  const caller = await getCallerContext(supabaseUrl, anonKey, serviceClient, token);
  if (!caller || !canManageLgpd(caller)) {
    return json({ error: 'Apenas admin/RH pode solicitar exclusão LGPD' }, 403, headers);
  }

  const { data: target } = await serviceClient
    .from('users')
    .select('id, company_id')
    .eq('id', targetUserId)
    .maybeSingle();
  if (!target || String(target.company_id) !== caller.companyId) {
    return json({ error: 'Colaborador não encontrado' }, 404, headers);
  }

  const { data, error } = await serviceClient.rpc('anonymize_user', {
    p_user_id: targetUserId,
    p_performed_by: caller.userId,
  });
  if (error) return json({ error: error.message }, 500, headers);

  await auditLog({
    supabase: serviceClient,
    userId: caller.userId,
    companyId: caller.companyId,
    action: 'LGPD_DELETE_REQUEST',
    entity: 'users',
    entityId: targetUserId,
    metadata: { anonymized: true },
    ipAddress: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    userAgent: request.headers.get('user-agent'),
    severity: 'SECURITY',
  });

  return json(data ?? { success: true }, 200, headers);
}

async function handleConsent(request: Request, headers: Record<string, string>): Promise<Response> {
  const token = bearerToken(request);
  if (!token) return json({ error: 'Authorization obrigatório' }, 401, headers);

  let body: { user_id?: string; accepted?: boolean; version?: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'JSON inválido' }, 400, headers);
  }

  const anonKey = (process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '').trim();
  const supabaseUrl = getSupabaseUrlForServer();
  const { url: svcUrl, serviceKey } = getSupabaseConfig();
  const serviceClient = createClient(svcUrl, serviceKey, { auth: { persistSession: false } });
  const caller = await getCallerContext(supabaseUrl, anonKey, serviceClient, token);
  if (!caller) return json({ error: 'Não autorizado' }, 401, headers);

  const userId = String(body.user_id || caller.userId).trim();
  if (!canAccessUserData(caller, userId)) {
    return json({ error: 'Acesso negado' }, 403, headers);
  }

  const { error } = await serviceClient.from('consent_logs').insert({
    company_id: caller.companyId,
    user_id: userId,
    accepted: Boolean(body.accepted),
    version: String(body.version || '1.0'),
    ip_address: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    user_agent: request.headers.get('user-agent'),
  });
  if (error) return json({ error: error.message }, 500, headers);

  await auditLog({
    supabase: serviceClient,
    userId: caller.userId,
    companyId: caller.companyId,
    action: 'LGPD_CONSENT',
    entity: 'consent_logs',
    entityId: userId,
    metadata: { accepted: body.accepted, version: body.version || '1.0' },
    severity: 'INFO',
  });

  return json({ success: true }, 200, headers);
}

async function handleRetention(request: Request, headers: Record<string, string>): Promise<Response> {
  const cronSecret = (process.env.CRON_SECRET || '').trim();
  const cronHeader = (request.headers.get('X-Cron-Secret') || '').trim();
  const isCron = Boolean(cronSecret && cronHeader && cronHeader === cronSecret);

  let companyIds: string[] = [];
  if (isCron) {
    const { url: svcUrl, serviceKey } = getSupabaseConfig();
    const serviceClient = createClient(svcUrl, serviceKey, { auth: { persistSession: false } });
    const { data: companies } = await serviceClient.from('companies').select('id').limit(5000);
    companyIds = (companies ?? []).map((c: { id: string }) => String(c.id));
  } else {
    const token = bearerToken(request);
    if (!token) return json({ error: 'Authorization ou X-Cron-Secret obrigatório' }, 401, headers);
    const anonKey = (process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '').trim();
    const supabaseUrl = getSupabaseUrlForServer();
    const { url: svcUrl, serviceKey } = getSupabaseConfig();
    const serviceClient = createClient(svcUrl, serviceKey, { auth: { persistSession: false } });
    const caller = await getCallerContext(supabaseUrl, anonKey, serviceClient, token);
    if (!caller || !isAdminOrHr(caller.role)) {
      return json({ error: 'Acesso negado' }, 403, headers);
    }
    companyIds = [caller.companyId];
  }

  const { url: svcUrl, serviceKey } = getSupabaseConfig();
  const serviceClient = createClient(svcUrl, serviceKey, { auth: { persistSession: false } });
  const results: Array<{ companyId: string; archived: number; policyYears: number }> = [];

  for (const companyId of companyIds) {
    try {
      const r = await runRetentionForCompany(serviceClient, companyId);
      results.push({ companyId, ...r });
    } catch (e) {
      observabilityConsole.error('[lgpd/retention]', companyId, e);
    }
  }

  await auditLog({
    supabase: serviceClient,
    userId: null,
    companyId: companyIds[0] ?? 'system',
    action: 'LGPD_RETENTION_RUN',
    entity: 'rep_punch_logs',
    metadata: { companies: results.length, results },
    severity: 'INFO',
  });

  return json({ success: true, results }, 200, headers);
}

/** Despacho LGPD — usado por /api/lgpd/* (rewrite) e /api/operational/lgpd/*. */
export async function dispatchLgpdRequest(request: Request): Promise<Response> {
  const headers = corsFor(request);
  if (request.method === 'OPTIONS') {
    return noCache(new Response(null, { status: 204, headers }));
  }

  const slug = slugSegment(request);
  try {
    if (slug === 'export' && request.method === 'GET') return handleExport(request, headers);
    if (slug === 'delete' && request.method === 'POST') return handleDelete(request, headers);
    if (slug === 'consent' && request.method === 'POST') return handleConsent(request, headers);
    if (slug === 'retention' && request.method === 'POST') return handleRetention(request, headers);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (message === 'SUPABASE_ENV_MISSING') {
      return json({ error: 'Supabase não configurado no servidor' }, 500, headers);
    }
    observabilityConsole.error('[api/lgpd]', slug, e);
    return json({ error: message }, 500, headers);
  }

  return json({ error: 'Rota não encontrada', routes: ['export', 'delete', 'consent', 'retention'] }, 404, headers);
}
