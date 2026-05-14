/**
 * Handlers HTTP para /api/rep/* (função serverless em api/rep-bridge.ts — limite Hobby 12).
 */

import { createClient } from '@supabase/supabase-js';
import { authenticateRepDeviceRequest, getServiceSupabase, repCorsHeaders } from './repVercelAuth';
import { getSupabaseAnonKeyResolved, getSupabaseUrlResolved } from './repVercelEnv';
import {
  runRepConnectionTest,
  getPunchesFromDeviceServer,
  pushEmployeeToDeviceServer,
  runRepExchange,
  isPrivateOrLocalIPv4,
} from './repDeviceServer';
import { syncRepDevices } from './repSyncJob';
import { parseAFD, parseTxtOrCsv } from './repParser';
import { ingestAfdRecords } from './repService';
import type { RepEmployeePayload, RepDeviceClockSet, RepExchangeOp } from './types';
import { assertPlanLimit, PlanLimitError, PLAN_LIMIT_CODE } from '../../services/planEnforcement';
import { safeUserSelectColumns } from '../../services/supabaseClient';

const JSON_HDR = { 'Content-Type': 'application/json' };

/** Evita confundir corpo vazio com JSON inválido (ex.: middleware dev sem repassar POST). */
async function readRequestJsonBody(
  request: Request
): Promise<{ ok: true; value: unknown } | { ok: false; error: string }> {
  let text: string;
  try {
    text = await request.text();
  } catch {
    return { ok: false, error: 'Body JSON inválido' };
  }
  const t = text.trim();
  if (!t) {
    return {
      ok: false,
      error:
        'Corpo da requisição vazio. Se estiver em npm run dev, reinicie o Vite (proxy /api/rep/* precisa repassar o corpo do POST).',
    };
  }
  try {
    return { ok: true, value: JSON.parse(t) };
  } catch {
    return { ok: false, error: 'Body JSON inválido' };
  }
}

type UserRowRepPush = {
  nome: string | null;
  email: string | null;
  cpf: string | null;
  pis_pasep: string | null;
  numero_folha: string | null;
  numero_identificador: string | null;
  company_id: string;
  role: string | null;
};

async function fetchUserRowForRepPush(
  request: Request,
  userId: string,
  expectedCompanyId: string
): Promise<UserRowRepPush | Response> {
  const requested = [
    'id',
    'nome',
    'email',
    'cpf',
    'pis_pasep',
    'numero_folha',
    'numero_identificador',
    'company_id',
    'role',
  ];
  const ctx = getServiceSupabase();
  if (ctx) {
    const cols = await safeUserSelectColumns(ctx.admin, requested);
    const { data, error } = await ctx.admin.from('users').select(cols.join(',')).eq('id', userId).maybeSingle();
    if (error) console.error('[USERS QUERY ERROR]', error);
    if (error || !data) {
      return Response.json({ error: 'Funcionário não encontrado' }, { status: 404, headers: JSON_HDR });
    }
    const u = data as unknown as UserRowRepPush;
    if (u.company_id !== expectedCompanyId) {
      return Response.json({ error: 'Funcionário não pertence a esta empresa' }, { status: 403, headers: JSON_HDR });
    }
    const role = String(u.role || '').toLowerCase();
    if (!['employee', 'hr', 'admin'].includes(role)) {
      return Response.json({ error: 'Este perfil não pode ser enviado ao relógio' }, { status: 403, headers: JSON_HDR });
    }
    return u;
  }
  const url = getSupabaseUrlResolved();
  const anon = getSupabaseAnonKeyResolved();
  if (!url || !anon) {
    return Response.json(
      { error: 'Servidor sem SUPABASE_SERVICE_ROLE_KEY e sem variáveis Supabase públicas.' },
      { status: 500, headers: JSON_HDR }
    );
  }
  const authHeader = request.headers.get('Authorization') || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  const userClient = createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const cols = await safeUserSelectColumns(userClient, requested);
  const { data, error } = await userClient.from('users').select(cols.join(',')).eq('id', userId).maybeSingle();
  if (error) console.error('[USERS QUERY ERROR]', error);
  if (error || !data) {
    return Response.json({ error: 'Funcionário não encontrado' }, { status: 404, headers: JSON_HDR });
  }
  const u = data as unknown as UserRowRepPush;
  if (u.company_id !== expectedCompanyId) {
    return Response.json({ error: 'Funcionário não pertence a esta empresa' }, { status: 403, headers: JSON_HDR });
  }
  const role = String(u.role || '').toLowerCase();
  if (!['employee', 'hr', 'admin'].includes(role)) {
    return Response.json({ error: 'Este perfil não pode ser enviado ao relógio' }, { status: 403, headers: JSON_HDR });
  }
  return u;
}

async function handlePushEmployee(request: Request): Promise<Response> {
  const headers = {
    ...repCorsHeaders(request),
    'Content-Type': 'application/json',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
  try {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers });
    }
    if (request.method !== 'POST') {
      return Response.json({ error: 'Method not allowed' }, { status: 405, headers });
    }
    const parsed = await readRequestJsonBody(request);
    if (!parsed.ok) {
      return Response.json({ error: (parsed as { ok: false; error: string }).error }, { status: 400, headers });
    }
    const raw = parsed.value;
    const body = (raw && typeof raw === 'object' ? raw : {}) as { device_id?: string; user_id?: string };
    const deviceId = typeof body.device_id === 'string' ? body.device_id.trim() : '';
    const userId = typeof body.user_id === 'string' ? body.user_id.trim() : '';
    if (!deviceId || !userId) {
      return Response.json({ error: 'device_id e user_id são obrigatórios' }, { status: 400, headers });
    }
    const auth = await authenticateRepDeviceRequest(request, deviceId);
    if (auth instanceof Response) return auth;
    const { device } = auth;
    if (device.tipo_conexao !== 'rede') {
      return Response.json({ ok: false, message: 'Dispositivo deve ser do tipo rede (IP).' }, { status: 400, headers });
    }
    const svcPush = getServiceSupabase();
    if (svcPush) {
      try {
        await assertPlanLimit(svcPush.admin, {
          tenantId: device.company_id,
          action: { type: 'USE_REP', feature: 'rep_devices' },
        });
      } catch (e) {
        if (e instanceof PlanLimitError) {
          return Response.json(
            { code: PLAN_LIMIT_CODE, message: e.message, error: e.message },
            { status: 403, headers: { ...headers } }
          );
        }
        throw e;
      }
    }

    const row = await fetchUserRowForRepPush(request, userId, device.company_id);
    if (row instanceof Response) return row;

    const payload: RepEmployeePayload = {
      id: userId,
      nome: (row.nome || row.email || 'Funcionário').trim(),
      cpf: row.cpf,
      pis: row.pis_pasep,
      matricula: row.numero_folha?.trim() || row.numero_identificador?.trim() || undefined,
    };

    const result = await pushEmployeeToDeviceServer(device, payload);
    return Response.json({ ok: result.ok, message: result.message }, { status: 200, headers });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Erro interno no proxy REP (push-employee)';
    console.error('[api/rep/push-employee]', e);
    return Response.json({ ok: false, error: message }, { status: 500, headers });
  }
}

const REP_EXCHANGE_OPS: RepExchangeOp[] = ['pull_clock', 'push_clock', 'pull_info', 'pull_users'];

async function handleExchange(request: Request): Promise<Response> {
  const headers = {
    ...repCorsHeaders(request),
    'Content-Type': 'application/json',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
  try {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers });
    }
    if (request.method !== 'POST') {
      return Response.json({ error: 'Method not allowed' }, { status: 405, headers });
    }
    const parsedEx = await readRequestJsonBody(request);
    if (!parsedEx.ok) {
      return Response.json({ error: (parsedEx as { ok: false; error: string }).error }, { status: 400, headers });
    }
    const rawEx = parsedEx.value;
    const body = (rawEx && typeof rawEx === 'object' ? rawEx : {}) as {
      device_id?: string;
      op?: string;
      clock?: RepDeviceClockSet;
    };
    const deviceId = typeof body.device_id === 'string' ? body.device_id.trim() : '';
    const opRaw = typeof body.op === 'string' ? body.op.trim() : '';
    if (!deviceId || !opRaw) {
      return Response.json({ error: 'device_id e op são obrigatórios' }, { status: 400, headers });
    }
    if (!REP_EXCHANGE_OPS.includes(opRaw as RepExchangeOp)) {
      return Response.json({ error: 'op inválido' }, { status: 400, headers });
    }
    const auth = await authenticateRepDeviceRequest(request, deviceId);
    if (auth instanceof Response) return auth;
    const { device } = auth;
    if (device.tipo_conexao !== 'rede') {
      return Response.json({ ok: false, message: 'Dispositivo deve ser do tipo rede (IP).' }, { status: 400, headers });
    }
    const svcEx = getServiceSupabase();
    if (svcEx) {
      try {
        await assertPlanLimit(svcEx.admin, {
          tenantId: device.company_id,
          action: { type: 'USE_REP', feature: 'rep_devices' },
        });
      } catch (e) {
        if (e instanceof PlanLimitError) {
          return Response.json(
            { code: PLAN_LIMIT_CODE, message: e.message, error: e.message },
            { status: 403, headers: { ...headers } }
          );
        }
        throw e;
      }
    }
    const result = await runRepExchange(device, opRaw as RepExchangeOp, body.clock);
    try {
      return Response.json(result, { status: 200, headers });
    } catch (ser: unknown) {
      console.error('[api/rep/exchange] JSON serialize', ser);
      return Response.json(
        {
          ok: false,
          message: 'Resposta do relógio não pôde ser serializada (dados inválidos).',
        },
        { status: 200, headers }
      );
    }
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Erro interno no proxy REP (exchange)';
    console.error('[api/rep/exchange]', e);
    return Response.json({ ok: false, error: message }, { status: 500, headers });
  }
}

function jsonSafeForRepStatusBody(value: unknown): unknown {
  if (value === undefined) return null;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return { _note: 'corpo não serializável em JSON', preview: String(value).slice(0, 400) };
  }
}

function isRunningOnVercel(): boolean {
  return typeof process.env.VERCEL === 'string' && process.env.VERCEL.length > 0;
}

async function handleStatus(request: Request): Promise<Response> {
  const headers = { ...repCorsHeaders(request), 'Content-Type': 'application/json' };
  try {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers });
    }
    if (request.method !== 'GET') {
      return Response.json({ error: 'Method not allowed' }, { status: 405, headers });
    }
    const urlObj = new URL(request.url);
    const deviceId = urlObj.searchParams.get('device_id');
    const auth = await authenticateRepDeviceRequest(request, deviceId);
    if (auth instanceof Response) return auth;
    const { device } = auth;
    if (device.tipo_conexao !== 'rede') {
      return Response.json({ ok: false, message: 'Dispositivo não é do tipo rede (IP).' }, { status: 400, headers });
    }
    const svcSt = getServiceSupabase();
    if (svcSt) {
      try {
        await assertPlanLimit(svcSt.admin, {
          tenantId: device.company_id,
          action: { type: 'USE_REP', feature: 'rep_devices' },
        });
      } catch (e) {
        if (e instanceof PlanLimitError) {
          return Response.json(
            { code: PLAN_LIMIT_CODE, message: e.message, error: e.message, ok: false },
            { status: 403, headers }
          );
        }
        throw e;
      }
    }
    const ip = (device.ip || '').trim();
    if (ip && isPrivateOrLocalIPv4(ip) && isRunningOnVercel()) {
      return Response.json(
        {
          ok: false,
          message:
            'Este teste roda no servidor da Vercel, que não alcança IPs da sua rede local (192.168.x.x). ' +
            'Use o agente `clock-sync-agent` na empresa ou teste o relógio a partir de um PC na mesma LAN. ' +
            'A sincronização de dados continua possível via agente → Supabase.',
          httpStatus: 0,
          body: null,
        },
        { status: 200, headers }
      );
    }
    const r = await runRepConnectionTest(device);
    if (!r.ok && (r.httpStatus === 0 || r.httpStatus === undefined) && r.message) {
      return Response.json({ ok: false, message: r.message }, { status: 200, headers });
    }
    const payload = {
      ok: r.ok,
      message: r.message || (r.ok ? 'Conexão OK' : 'Falha'),
      httpStatus: r.httpStatus ?? (r.ok ? 200 : 0),
      body: jsonSafeForRepStatusBody(r.body),
    };
    try {
      return Response.json(payload, { status: 200, headers });
    } catch (ser: unknown) {
      console.error('[api/rep/status] JSON serialize', ser);
      return Response.json(
        {
          ok: r.ok,
          message: r.message || (r.ok ? 'Conexão OK' : 'Falha'),
          httpStatus: r.httpStatus ?? (r.ok ? 200 : 0),
        },
        { status: 200, headers }
      );
    }
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Erro interno no proxy REP (status)';
    console.error('[api/rep/status]', e);
    return Response.json({ ok: false, error: message }, { status: 500, headers });
  }
}

async function handlePunches(request: Request): Promise<Response> {
  const headers = { ...repCorsHeaders(request), 'Content-Type': 'application/json' };
  try {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers });
    }
    if (request.method !== 'GET') {
      return Response.json({ error: 'Method not allowed' }, { status: 405, headers });
    }
    const urlObj = new URL(request.url);
    const deviceId = urlObj.searchParams.get('device_id');
    const sinceRaw = urlObj.searchParams.get('since');
    const auth = await authenticateRepDeviceRequest(request, deviceId);
    if (auth instanceof Response) return auth;
    const { device } = auth;
    if (device.tipo_conexao === 'arquivo') {
      return Response.json({ ok: false, message: 'Dispositivo configurado apenas para arquivo.' }, { status: 400, headers });
    }
    const svcPu = getServiceSupabase();
    if (svcPu) {
      try {
        await assertPlanLimit(svcPu.admin, {
          tenantId: device.company_id,
          action: { type: 'USE_REP', feature: 'rep_devices' },
        });
      } catch (e) {
        if (e instanceof PlanLimitError) {
          return Response.json(
            { code: PLAN_LIMIT_CODE, message: e.message, error: e.message, ok: false },
            { status: 403, headers }
          );
        }
        throw e;
      }
    }
    let since: Date | undefined;
    if (sinceRaw) {
      const d = new Date(sinceRaw);
      if (!Number.isNaN(d.getTime())) since = d;
    }
    try {
      const punches = await getPunchesFromDeviceServer(device, since);
      if (punches.length === 0) {
        console.warn('[api/rep/punches] Nenhuma marcação retornada pelo adaptador.', {
          device_id: device.id,
          since: since?.toISOString(),
        });
      }
      try {
        return Response.json({ ok: true, punches }, { status: 200, headers });
      } catch (ser: unknown) {
        console.error('[api/rep/punches] JSON serialize', ser);
        return Response.json(
          { ok: false, message: 'Resposta do relógio não pôde ser serializada (dados inválidos).' },
          { status: 500, headers }
        );
      }
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Erro ao ler marcações do relógio';
      return Response.json({ ok: false, message }, { status: 200, headers });
    }
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Erro interno no proxy REP';
    console.error('[api/rep/punches]', e);
    return Response.json({ ok: false, error: message }, { status: 500, headers });
  }
}

async function handleSync(request: Request): Promise<Response> {
  const cors = repCorsHeaders(request);
  const headersJson = { ...cors, 'Content-Type': 'application/json' };
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors });
  }
  if (request.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405, headers: cors });
  }
  const apiKey = (process.env.API_KEY || process.env.CRON_SECRET || '').trim();
  const authHeader = request.headers.get('Authorization') || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!apiKey || token !== apiKey) {
    return Response.json({ error: 'Unauthorized' }, { status: 401, headers: headersJson });
  }
  const url = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').toString().trim().replace(/\/$/, '');
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!url || !serviceKey) {
    return Response.json({ error: 'Supabase não configurado' }, { status: 500, headers: headersJson });
  }
  const supabase = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const urlObj = new URL(request.url);
  const companyId = urlObj.searchParams.get('company_id') || undefined;
  if (companyId) {
    try {
      await assertPlanLimit(supabase, {
        tenantId: companyId,
        action: { type: 'USE_REP', feature: 'rep_devices' },
      });
    } catch (e) {
      if (e instanceof PlanLimitError) {
        return Response.json(
          { code: PLAN_LIMIT_CODE, message: e.message, error: e.message },
          { status: 403, headers: headersJson }
        );
      }
      throw e;
    }
  }
  const result = await syncRepDevices(supabase, companyId);
  return Response.json(
    {
      success: result.errors.length === 0,
      total_devices: result.total,
      imported: result.imported,
      errors: result.errors,
    },
    { status: 200, headers: headersJson }
  );
}

async function handleImportAfd(request: Request): Promise<Response> {
  const corsImport = repCorsHeaders(request);
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsImport });
  }
  if (request.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405, headers: corsImport });
  }
  const authHeader = request.headers.get('Authorization') || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) {
    return Response.json({ error: 'Authorization obrigatório' }, { status: 401, headers: { ...corsImport, 'Content-Type': 'application/json' } });
  }
  const supabaseUrl = getSupabaseUrlResolved();
  const anonKey = getSupabaseAnonKeyResolved();
  if (!supabaseUrl || !anonKey) {
    return Response.json({ error: 'Supabase não configurado' }, { status: 500, headers: { ...corsImport, 'Content-Type': 'application/json' } });
  }
  const supabase = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false },
  });
  const { data: { user } } = await supabase.auth.getUser(token);
  if (!user) {
    return Response.json({ error: 'Token inválido ou expirado' }, { status: 401, headers: { ...corsImport, 'Content-Type': 'application/json' } });
  }
  const contentType = request.headers.get('Content-Type') || '';
  let companyId: string;
  let repDeviceId: string | null = null;
  let forceUserId: string | null = null;
  let fileContent: string;
  if (contentType.includes('application/json')) {
    const body = (await request.json()) as {
      company_id: string;
      rep_device_id?: string;
      force_user_id?: string;
      content?: string;
      filename?: string;
    };
    companyId = body.company_id;
    repDeviceId = body.rep_device_id || null;
    forceUserId = body.force_user_id?.trim() || null;
    if (!companyId) {
      return Response.json({ error: 'company_id obrigatório' }, { status: 400, headers: { ...corsImport, 'Content-Type': 'application/json' } });
    }
    if (body.content) {
      try {
        fileContent =
          typeof body.content === 'string' && body.content.includes(',') && body.content.length > 100
            ? atob(body.content)
            : body.content;
      } catch {
        fileContent = body.content as string;
      }
    } else {
      return Response.json({ error: 'content obrigatório no body JSON' }, { status: 400, headers: { ...corsImport, 'Content-Type': 'application/json' } });
    }
  } else if (contentType.includes('multipart/form-data')) {
    const formData = await request.formData();
    companyId = (formData.get('company_id') as string) || '';
    repDeviceId = (formData.get('rep_device_id') as string) || null;
    const rawForce = formData.get('force_user_id');
    forceUserId = typeof rawForce === 'string' && rawForce.trim() ? rawForce.trim() : null;
    const file = formData.get('file') as File | null;
    if (!companyId || !file) {
      return Response.json({ error: 'company_id e file obrigatórios' }, { status: 400, headers: { ...corsImport, 'Content-Type': 'application/json' } });
    }
    fileContent = await file.text();
  } else {
    return Response.json(
      { error: 'Content-Type deve ser application/json ou multipart/form-data' },
      { status: 400, headers: { ...corsImport, 'Content-Type': 'application/json' } }
    );
  }
  const { data: profile } = await supabase.from('users').select('company_id, role').eq('id', user.id).single();
  const userCompanyId = (profile as { company_id?: string; role?: string } | null)?.company_id;
  const role = (profile as { role?: string } | null)?.role;
  if (role !== 'admin' && role !== 'hr') {
    return Response.json({ error: 'Sem permissão para importar AFD' }, { status: 403, headers: { ...corsImport, 'Content-Type': 'application/json' } });
  }
  if (userCompanyId && companyId !== userCompanyId) {
    return Response.json({ error: 'company_id não autorizado' }, { status: 403, headers: { ...corsImport, 'Content-Type': 'application/json' } });
  }
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  const supabaseAdmin = serviceKey
    ? createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })
    : supabase;
  try {
    await assertPlanLimit(supabaseAdmin, {
      tenantId: companyId,
      action: { type: 'USE_REP', feature: 'rep_afd_import' },
    });
  } catch (e) {
    if (e instanceof PlanLimitError) {
      return Response.json(
        { code: PLAN_LIMIT_CODE, message: e.message, error: e.message },
        { status: 403, headers: { ...corsImport, 'Content-Type': 'application/json' } }
      );
    }
    throw e;
  }
  const isCsv = fileContent.includes(',') && fileContent.split('\n')[0].includes(',');
  const records = isCsv ? parseTxtOrCsv(fileContent, ',') : parseAFD(fileContent);
  if (records.length === 0) {
    return Response.json({ error: 'Nenhum registro válido encontrado no arquivo' }, { status: 400, headers: { ...corsImport, 'Content-Type': 'application/json' } });
  }
  const result = await ingestAfdRecords(supabaseAdmin, companyId, repDeviceId, records, undefined, forceUserId);
  return Response.json(
    {
      success: true,
      total: records.length,
      imported: result.imported,
      duplicated: result.duplicated,
      user_not_found: result.userNotFound,
      force_user_id: forceUserId,
      errors: result.errors.slice(0, 10),
    },
    { status: 200, headers: { ...corsImport, 'Content-Type': 'application/json' } }
  );
}

/**
 * Despacha slug REP (status, punches, sync, punch, import-afd, push-employee, exchange).
 */
export async function handleRepSlug(request: Request, slug: string): Promise<Response> {
  switch (slug) {
    case 'status':
      return handleStatus(request);
    case 'punches':
      return handlePunches(request);
    case 'sync':
      return handleSync(request);
    case 'punch':
      return (await import('./repPunchHttp')).handleRepPunchHttp(request);
    case 'import-afd':
      return handleImportAfd(request);
    case 'push-employee':
      return handlePushEmployee(request);
    case 'exchange':
      return handleExchange(request);
    default:
      return Response.json({ error: 'Rota REP desconhecida' }, { status: 404, headers: { 'Content-Type': 'application/json' } });
  }
}
