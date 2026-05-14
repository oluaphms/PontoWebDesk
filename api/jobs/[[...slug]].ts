/**
 * Rota unificada /api/jobs/* (Hobby: 1 função em vez de 3).
 * - POST /api/jobs/calc-period
 * - POST /api/jobs/process
 * - GET  /api/jobs/:id
 */

import { createClient } from '@supabase/supabase-js';
import { resolveRequestUrl } from '../_shared/getRequestBaseUrl.js';
import { getCallerContext, isAdminOrHr } from '../_shared/callerContext.js';
import { JOB_TYPE } from '../../src/services/jobs/jobTypes';
import { processJobs } from '../../src/services/jobs/processJobs';
import { calculatePeriodTimesheets } from '../../src/services/payrollCalculator';
import { setSupabaseServiceRoleOverride } from '../../src/lib/supabaseClient';
import type { SupabaseClient } from '@supabase/supabase-js';

const corsAll: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Cron-Secret',
  'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
  Pragma: 'no-cache',
  Expires: '0',
};

const MAX_DAYS = 120;
const RESERVED = new Set(['calc-period', 'process']);

function jsonWithLog(body: unknown, status: number, route: string, headers: Record<string, string>): Response {
  console.log('[API RESPONSE]', route, Date.now());
  return Response.json(body, { status, headers });
}

function isYmd(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function isJobIdSegment(s: string): boolean {
  if (!s || RESERVED.has(s)) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

/**
 * Cálculo síncrono quando a fila `jobs` não está disponível (fail-safe real).
 */
async function executeCalcPeriodFallback(
  serviceClient: SupabaseClient,
  employee_id: string,
  companyId: string,
  start_date: string,
  end_date: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  setSupabaseServiceRoleOverride(serviceClient);
  try {
    await calculatePeriodTimesheets(employee_id, companyId, start_date, end_date);
    return { ok: true };
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, error: message };
  } finally {
    setSupabaseServiceRoleOverride(null);
  }
}

async function handleCalcPeriod(request: Request): Promise<Response> {
  const corsHeaders = { ...corsAll, 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (request.method !== 'POST') {
    return jsonWithLog(
      { error: 'METHOD_NOT_ALLOWED', allowed: ['POST'] },
      405,
      '/api/jobs/calc-period',
      { ...corsHeaders, 'Content-Type': 'application/json' },
    );
  }

  const supabaseUrl = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '')
    .toString()
    .trim()
    .replace(/\/$/, '');
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  const anonKey = (process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '').trim();

  if (!serviceKey || !supabaseUrl) {
    return jsonWithLog(
      { error: 'Supabase não configurado.', code: 'CONFIG_MISSING' },
      500,
      '/api/jobs/calc-period',
      { ...corsHeaders, 'Content-Type': 'application/json' },
    );
  }

  const jwt = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!jwt) {
    return jsonWithLog(
      { error: 'Token obrigatório.', code: 'UNAUTHORIZED' },
      401,
      '/api/jobs/calc-period',
      { ...corsHeaders, 'Content-Type': 'application/json' },
    );
  }

  const serviceClient = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const caller = await getCallerContext(supabaseUrl, anonKey, serviceClient, jwt);
  if (!caller) {
    return jsonWithLog(
      { error: 'Sessão inválida.', code: 'UNAUTHORIZED' },
      401,
      '/api/jobs/calc-period',
      { ...corsHeaders, 'Content-Type': 'application/json' },
    );
  }
  if (!isAdminOrHr(caller.role)) {
    return jsonWithLog(
      { error: 'Apenas administrador ou RH.', code: 'FORBIDDEN' },
      403,
      '/api/jobs/calc-period',
      { ...corsHeaders, 'Content-Type': 'application/json' },
    );
  }

  let body: { employee_id?: string; start_date?: string; end_date?: string } = {};
  try {
    const raw = await request.json();
    body = (raw && typeof raw === 'object' ? raw : {}) as typeof body;
  } catch {
    return jsonWithLog(
      { error: 'Body inválido.', code: 'BAD_REQUEST' },
      400,
      '/api/jobs/calc-period',
      { ...corsHeaders, 'Content-Type': 'application/json' },
    );
  }

  const employee_id = typeof body.employee_id === 'string' ? body.employee_id.trim() : '';
  const start_date = typeof body.start_date === 'string' ? body.start_date.trim() : '';
  const end_date = typeof body.end_date === 'string' ? body.end_date.trim() : '';

  if (!employee_id || !isYmd(start_date) || !isYmd(end_date)) {
    return jsonWithLog(
      { error: 'Informe employee_id e datas YYYY-MM-DD.', code: 'BAD_REQUEST' },
      400,
      '/api/jobs/calc-period',
      { ...corsHeaders, 'Content-Type': 'application/json' },
    );
  }
  if (start_date > end_date) {
    return jsonWithLog(
      { error: 'start_date não pode ser maior que end_date.', code: 'BAD_REQUEST' },
      400,
      '/api/jobs/calc-period',
      { ...corsHeaders, 'Content-Type': 'application/json' },
    );
  }

  const d0 = new Date(`${start_date}T12:00:00`);
  const d1 = new Date(`${end_date}T12:00:00`);
  const diffDays = Math.floor((d1.getTime() - d0.getTime()) / (86400000)) + 1;
  if (diffDays > MAX_DAYS || diffDays < 1) {
    return jsonWithLog(
      { error: `Período inválido (máximo ${MAX_DAYS} dias).`, code: 'BAD_REQUEST' },
      400,
      '/api/jobs/calc-period',
      { ...corsHeaders, 'Content-Type': 'application/json' },
    );
  }

  const { data: emp } = await serviceClient
    .from('users')
    .select('id, company_id')
    .eq('id', employee_id)
    .maybeSingle();

  if (!emp || String(emp.company_id) !== caller.companyId) {
    return jsonWithLog(
      { error: 'Colaborador não encontrado nesta empresa.', code: 'FORBIDDEN' },
      403,
      '/api/jobs/calc-period',
      { ...corsHeaders, 'Content-Type': 'application/json' },
    );
  }

  const payload = {
    employee_id,
    company_id: caller.companyId,
    start_date,
    end_date,
  };

  const { data: inserted, error: insErr } = await serviceClient
    .from('jobs')
    .insert({
      company_id: caller.companyId,
      type: JOB_TYPE.CALC_PERIOD,
      status: 'pending',
      payload,
      updated_at: new Date().toISOString(),
    })
    .select('id')
    .single();

  if (insErr || !inserted?.id) {
    const enqueueMessage = insErr?.message || 'Falha ao enfileirar job.';
    const direct = await executeCalcPeriodFallback(
      serviceClient,
      employee_id,
      caller.companyId,
      start_date,
      end_date,
    );
    if (direct.ok === false) {
      const errMsg = direct.error;
      const employeeInvalid = /^TIMESHEET_EMPLOYEE_INVALID:/i.test(errMsg);
      return jsonWithLog(
        {
          error: errMsg,
          code: employeeInvalid ? 'EMPLOYEE_INVALID' : 'DIRECT_CALC_FAILED',
          enqueue_error: enqueueMessage,
        },
        employeeInvalid ? 400 : 500,
        '/api/jobs/calc-period',
        { ...corsHeaders, 'Content-Type': 'application/json' },
      );
    }
    return jsonWithLog(
      {
        success: true,
        mode: 'direct_fallback',
        fallback: 'calculatePeriodTimesheets',
        enqueue_error: enqueueMessage,
      },
      200,
      '/api/jobs/calc-period',
      { ...corsHeaders, 'Content-Type': 'application/json' },
    );
  }

  return jsonWithLog(
    { job_id: inserted.id },
    200,
    '/api/jobs/calc-period',
    { ...corsHeaders, 'Content-Type': 'application/json' },
  );
}

async function handleProcess(request: Request): Promise<Response> {
  const corsHeaders = { ...corsAll, 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (request.method !== 'POST') {
    return jsonWithLog(
      { error: 'METHOD_NOT_ALLOWED', allowed: ['POST'] },
      405,
      '/api/jobs/process',
      { ...corsHeaders, 'Content-Type': 'application/json' },
    );
  }

  const supabaseUrlForAuth = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '')
    .toString()
    .trim()
    .replace(/\/$/, '');
  const anonKey = (process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '').trim();

  const secret = request.headers.get('X-Cron-Secret')?.trim();
  const cronSecret = (process.env.CRON_SECRET || process.env.VITE_CRON_SECRET || '').trim();
  const cronOk = !!(cronSecret && secret === cronSecret);

  const jwt = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();

  if (!cronOk) {
    if (!jwt || !anonKey) {
      return jsonWithLog(
        { error: 'Unauthorized', code: 'UNAUTHORIZED' },
        401,
        '/api/jobs/process',
        { ...corsHeaders, 'Content-Type': 'application/json' },
      );
    }
    const preClient = createClient(supabaseUrlForAuth, (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim(), {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const caller = await getCallerContext(supabaseUrlForAuth, anonKey, preClient, jwt);
    if (!caller || !isAdminOrHr(caller.role)) {
      return jsonWithLog(
        { error: 'Unauthorized', code: 'UNAUTHORIZED' },
        401,
        '/api/jobs/process',
        { ...corsHeaders, 'Content-Type': 'application/json' },
      );
    }
  }

  const supabaseUrl = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '')
    .toString()
    .trim()
    .replace(/\/$/, '');
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!serviceKey || !supabaseUrl) {
    return jsonWithLog(
      { error: 'Supabase não configurado.', code: 'CONFIG_MISSING' },
      500,
      '/api/jobs/process',
      { ...corsHeaders, 'Content-Type': 'application/json' },
    );
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  try {
    const out = await processJobs(supabase, 3);
    return jsonWithLog(
      { ok: true, processed: out.ran, last_job_id: out.lastJobId, errors: out.errors },
      200,
      '/api/jobs/process',
      { ...corsHeaders, 'Content-Type': 'application/json' },
    );
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return jsonWithLog(
      { error: message, code: 'PROCESS_ERROR' },
      500,
      '/api/jobs/process',
      { ...corsHeaders, 'Content-Type': 'application/json' },
    );
  }
}

async function handleJobGet(request: Request, jobId: string): Promise<Response> {
  const corsHeaders = { ...corsAll, 'Access-Control-Allow-Methods': 'GET, OPTIONS' };
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (request.method !== 'GET') {
    return jsonWithLog(
      { error: 'METHOD_NOT_ALLOWED', allowed: ['GET'] },
      405,
      '/api/jobs/status',
      { ...corsHeaders, 'Content-Type': 'application/json' },
    );
  }

  const supabaseUrl = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '')
    .toString()
    .trim()
    .replace(/\/$/, '');
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  const anonKey = (process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '').trim();

  if (!serviceKey || !supabaseUrl) {
    return jsonWithLog(
      { error: 'Supabase não configurado.', code: 'CONFIG_MISSING' },
      500,
      '/api/jobs/status',
      { ...corsHeaders, 'Content-Type': 'application/json' },
    );
  }

  const jwt = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!jwt) {
    return jsonWithLog(
      { error: 'Token obrigatório.', code: 'UNAUTHORIZED' },
      401,
      '/api/jobs/status',
      { ...corsHeaders, 'Content-Type': 'application/json' },
    );
  }

  const serviceClient = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const caller = await getCallerContext(supabaseUrl, anonKey, serviceClient, jwt);
  if (!caller) {
    return jsonWithLog(
      { error: 'Sessão inválida.', code: 'UNAUTHORIZED' },
      401,
      '/api/jobs/status',
      { ...corsHeaders, 'Content-Type': 'application/json' },
    );
  }
  if (!isAdminOrHr(caller.role)) {
    return jsonWithLog(
      { error: 'Apenas administrador ou RH.', code: 'FORBIDDEN' },
      403,
      '/api/jobs/status',
      { ...corsHeaders, 'Content-Type': 'application/json' },
    );
  }

  const { data: job, error } = await serviceClient
    .from('jobs')
    .select('id, company_id, type, status, payload, result, attempts, created_at, updated_at')
    .eq('id', jobId)
    .maybeSingle();

  if (error) {
    return jsonWithLog(
      { error: error.message, code: 'QUERY_FAILED' },
      500,
      '/api/jobs/status',
      { ...corsHeaders, 'Content-Type': 'application/json' },
    );
  }
  if (!job) {
    return jsonWithLog(
      { error: 'Job não encontrado.', code: 'NOT_FOUND' },
      404,
      '/api/jobs/status',
      { ...corsHeaders, 'Content-Type': 'application/json' },
    );
  }
  if (String(job.company_id) !== caller.companyId) {
    return jsonWithLog(
      { error: 'Acesso negado.', code: 'FORBIDDEN' },
      403,
      '/api/jobs/status',
      { ...corsHeaders, 'Content-Type': 'application/json' },
    );
  }

  return jsonWithLog(job, 200, '/api/jobs/status', { ...corsHeaders, 'Content-Type': 'application/json' });
}

export default async function handler(request: Request): Promise<Response> {
  const url = resolveRequestUrl(request);
  const parts = url.pathname.split('/').filter(Boolean);
  // ['api', 'jobs', ...slug]
  const slug = parts.slice(2);

  if (slug.length === 1 && slug[0] === 'calc-period') {
    return handleCalcPeriod(request);
  }
  if (slug.length === 1 && slug[0] === 'process') {
    return handleProcess(request);
  }
  if (slug.length === 1 && isJobIdSegment(slug[0])) {
    return handleJobGet(request, slug[0]);
  }

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsAll });
  }

  return jsonWithLog(
    { error: 'Rota não encontrada.', code: 'NOT_FOUND' },
    404,
    '/api/jobs',
    { ...corsAll, 'Content-Type': 'application/json' },
  );
}
