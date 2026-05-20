/**
 * /api/rep/commands e /api/rep/command-result — teste LAN via agente.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseConfig } from './getSupabaseConfig.js';
import { getSecureCorsHeaders, extractBearerToken } from './security.js';
import { noCache } from './cache.js';
import { getCallerContext, isAdminOrHr } from './callerContext.js';
import { getSupabaseUrlForServer } from './getSupabaseConfig.js';
import { verifyRepAgentToken } from './repAgentAuth.js';

const TERMINAL = new Set(['done', 'error', 'cancelled']);

type CommandRow = {
  id: string;
  company_id: string;
  device_id: string;
  command: string;
  status: string;
  execution_id: string | null;
  payload: Record<string, unknown> | null;
  result: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

function cors(request: Request): Record<string, string> {
  return getSecureCorsHeaders(request, {
    allowMethods: 'GET, POST, OPTIONS',
    allowHeaders: 'Content-Type, Authorization',
  });
}

function json(body: unknown, status: number, headers: Record<string, string>): Response {
  return noCache(Response.json(body, { status, headers: { ...headers, 'Content-Type': 'application/json' } }));
}

function getBridgeToken(): string {
  return (process.env.REP_BRIDGE_TOKEN || process.env.REP_AGENT_TOKEN || process.env.API_KEY || '').trim();
}

function isAgentRequest(request: Request): boolean {
  const token = extractBearerToken(request);
  const bridge = getBridgeToken();
  return Boolean(token && bridge && secureCompare(token, bridge));
}

async function loadDevice(
  supabase: SupabaseClient,
  deviceId: string,
): Promise<{ id: string; company_id: string } | null> {
  const { data } = await supabase
    .from('rep_devices')
    .select('id, company_id')
    .eq('id', deviceId)
    .maybeSingle();
  if (!data?.id) return null;
  return { id: String(data.id), company_id: String(data.company_id) };
}

const STUCK_PROCESSING_MS = 30_000;

/** Libera comandos presos em processing com instância de execução ativa. */
async function reclaimStuckProcessingCommands(
  supabase: SupabaseClient,
  companyId: string,
): Promise<void> {
  const cutoff = new Date(Date.now() - STUCK_PROCESSING_MS).toISOString();
  await supabase
    .from('rep_device_commands')
    .update({
      status: 'pending',
      execution_id: null,
      updated_at: new Date().toISOString(),
      result: { message: 'Reenfileirado após timeout do agente' },
    })
    .eq('company_id', companyId)
    .eq('status', 'processing')
    .not('execution_id', 'is', null)
    .lt('updated_at', cutoff);
}

async function cancelActiveTestCommands(
  supabase: SupabaseClient,
  deviceId: string,
  exceptId?: string,
): Promise<void> {
  let q = supabase
    .from('rep_device_commands')
    .update({
      status: 'cancelled',
      execution_id: null,
      result: { message: 'Substituído por novo teste' },
      updated_at: new Date().toISOString(),
    })
    .eq('device_id', deviceId)
    .eq('command', 'test_connection')
    .in('status', ['pending', 'processing']);
  if (exceptId) q = q.neq('id', exceptId);
  await q;
}

/** Claim atômico: pending → processing + execution_id único por linha. */
async function claimPendingCommands(
  supabase: SupabaseClient,
  companyId: string,
  deviceId: string | null,
): Promise<CommandRow[]> {
  let claimQuery = supabase
    .from('rep_device_commands')
    .select('id')
    .eq('company_id', companyId)
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(10);

  if (deviceId) claimQuery = claimQuery.eq('device_id', deviceId);

  const { data: pending, error: pendErr } = await claimQuery;
  if (pendErr || !pending?.length) return [];

  const claimed: CommandRow[] = [];
  const now = new Date().toISOString();

  for (const row of pending) {
    const executionId = newExecutionId();
    const { data: one, error: claimErr } = await supabase
      .from('rep_device_commands')
      .update({
        status: 'processing',
        execution_id: executionId,
        updated_at: now,
      })
      .eq('id', row.id)
      .eq('status', 'pending')
      .select(
        'id, company_id, device_id, command, status, execution_id, payload, created_at, updated_at',
      )
      .maybeSingle();

    if (claimErr || !one) continue;
    claimed.push(one as CommandRow);
  }

  return claimed;
}

/** POST /api/rep/commands — criar comando (painel). */
async function handleCreateCommand(
  request: Request,
  supabase: SupabaseClient,
  headers: Record<string, string>,
): Promise<Response> {
  const token = extractBearerToken(request);
  const anonKey = (process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '').trim();
  const supabaseUrl = getSupabaseUrlForServer();
  if (!token || !anonKey) return json({ error: 'Authorization obrigatório' }, 401, headers);

  const caller = await getCallerContext(supabaseUrl, anonKey, supabase, token);
  if (!caller || !isAdminOrHr(caller.role)) {
    return json({ error: 'Acesso negado' }, 403, headers);
  }

  let body: { device_id?: string; command?: string; payload?: Record<string, unknown> };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'JSON inválido' }, 400, headers);
  }

  const deviceId = String(body.device_id || '').trim();
  const command = String(body.command || 'test_connection').trim();
  if (!deviceId) return json({ error: 'device_id obrigatório' }, 400, headers);
  const allowed = new Set(['test_connection', 'collect_punches']);
  if (!allowed.has(command)) {
    return json({ error: 'Comando não suportado' }, 400, headers);
  }

  const device = await loadDevice(supabase, deviceId);
  if (!device || device.company_id !== caller.companyId) {
    return json({ error: 'Dispositivo não encontrado' }, 404, headers);
  }

  const { data: active } = await supabase
    .from('rep_device_commands')
    .select('id, status, execution_id')
    .eq('device_id', deviceId)
    .eq('command', command)
    .in('status', ['pending', 'processing'])
    .limit(1)
    .maybeSingle();

  if (active?.id) {
    return json(
      {
        success: true,
        command_id: active.id,
        status: active.status || 'pending',
        execution_id: active.execution_id ?? null,
        reused: true,
      },
      200,
      headers,
    );
  }

  if (command === 'test_connection') {
    await cancelActiveTestCommands(supabase, deviceId);
  }

  const now = new Date().toISOString();
  const insertPayload =
    body.payload && typeof body.payload === 'object'
      ? { ...body.payload, requested_by: caller.userId }
      : { requested_by: caller.userId };

  const { data: row, error } = await supabase
    .from('rep_device_commands')
    .insert({
      company_id: device.company_id,
      device_id: deviceId,
      command,
      status: 'pending',
      execution_id: null,
      payload: insertPayload,
      created_at: now,
      updated_at: now,
    })
    .select('id, status, execution_id, created_at')
    .single();

  if (error || !row) {
    return json({ error: error?.message || 'Falha ao criar comando' }, 500, headers);
  }

  return json(
    {
      success: true,
      command_id: row.id,
      status: row.status,
      execution_id: row.execution_id ?? null,
      created_at: row.created_at,
    },
    200,
    headers,
  );
}

/** GET /api/rep/commands — agente (pending) ou painel (latest). */
async function handleGetCommands(
  request: Request,
  supabase: SupabaseClient,
  headers: Record<string, string>,
): Promise<Response> {
  const url = new URL(request.url);
  const latest = url.searchParams.get('latest') === 'true';
  const commandId = (url.searchParams.get('command_id') || '').trim();
  const deviceIdParam = (url.searchParams.get('device_id') || '').trim();
  const companyIdParam = (url.searchParams.get('company_id') || '').trim();
  const statusFilter = (url.searchParams.get('status') || '').trim();

  if (await isAgentRequest(request, supabase)) {
    const companyId = companyIdParam;
    if (!companyId) return json({ error: 'company_id obrigatório' }, 400, headers);

    const deviceId = deviceIdParam || null;

    if (deviceId) {
      const device = await loadDevice(supabase, deviceId);
      if (!device || device.company_id !== companyId) {
        return json({ error: 'Dispositivo não encontrado ou empresa incorreta' }, 404, headers);
      }
    }

    await reclaimStuckProcessingCommands(supabase, companyId);

    const claimed = await claimPendingCommands(supabase, companyId, deviceId);
    return json({ success: true, commands: claimed }, 200, headers);
  }

  const token = extractBearerToken(request);
  const anonKey = (process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '').trim();
  const supabaseUrl = getSupabaseUrlForServer();
  if (!token || !anonKey) return json({ error: 'Authorization obrigatório' }, 401, headers);

  const caller = await getCallerContext(supabaseUrl, anonKey, supabase, token);
  if (!caller) return json({ error: 'Não autorizado' }, 401, headers);

  if (latest) {
    if (!deviceIdParam) return json({ error: 'device_id obrigatório' }, 400, headers);
    const device = await loadDevice(supabase, deviceIdParam);
    if (!device || device.company_id !== caller.companyId) {
      return json({ error: 'Dispositivo não encontrado' }, 404, headers);
    }

    let q = supabase
      .from('rep_device_commands')
      .select('id, device_id, command, status, execution_id, result, created_at, updated_at')
      .eq('device_id', deviceIdParam)
      .order('created_at', { ascending: false })
      .limit(1);

    if (commandId) q = q.eq('id', commandId);

    const { data: row, error } = await q.maybeSingle();
    if (error) return json({ error: error.message }, 500, headers);
    if (!row) return json({ success: true, command: null }, 200, headers);

    return json({ success: true, command: row }, 200, headers);
  }

  let listQuery = supabase
    .from('rep_device_commands')
    .select('id, device_id, command, status, execution_id, result, created_at, updated_at')
    .eq('company_id', caller.companyId)
    .order('created_at', { ascending: false })
    .limit(20);

  if (deviceIdParam) listQuery = listQuery.eq('device_id', deviceIdParam);
  if (statusFilter) listQuery = listQuery.eq('status', statusFilter);

  const { data: rows, error: listErr } = await listQuery;
  if (listErr) return json({ error: listErr.message }, 500, headers);

  return json({ success: true, commands: rows ?? [] }, 200, headers);
}

/** POST /api/rep/command-result — agente reporta resultado (valida execution_id). */
export async function handleRepCommandResult(request: Request): Promise<Response> {
  const headers = cors(request);
  if (request.method === 'OPTIONS') {
    return noCache(new Response(null, { status: 204, headers }));
  }
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405, headers);
  }
  let body: {
    command_id?: string;
    execution_id?: string;
    status?: string;
    result?: Record<string, unknown>;
  };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'JSON inválido' }, 400, headers);
  }

  const commandId = String(body.command_id || '').trim();
  const executionId = String(body.execution_id || '').trim();
  const status = String(body.status || '').trim().toLowerCase();
  if (!commandId) return json({ error: 'command_id obrigatório' }, 400, headers);
  if (!executionId) return json({ error: 'execution_id obrigatório' }, 400, headers);
  if (!['done', 'error'].includes(status)) {
    return json({ error: 'status inválido (use done ou error)' }, 400, headers);
  }

  let supabase: SupabaseClient;
  try {
    const { url, serviceKey } = getSupabaseConfig();
    supabase = createClient(url, serviceKey, { auth: { persistSession: false } });
  } catch {
    return json({ error: 'Supabase não configurado' }, 500, headers);
  }

  const { data: existing, error: loadErr } = await supabase
    .from('rep_device_commands')
    .select('id, company_id, device_id, status, execution_id')
    .eq('id', commandId)
    .maybeSingle();

  if (loadErr || !existing) {
    return json({ error: 'Comando não encontrado' }, 404, headers);
  }

  const row = existing as { id: string; company_id: string; device_id: string; status: string; execution_id: string | null };

  const token = extractBearerToken(request);
  if (!(await verifyRepAgentToken(supabase, token || '', row.device_id))) {
    return json({ error: 'Unauthorized' }, 401, headers);
  }

  if (TERMINAL.has(row.status)) {
    return json({ success: true, idempotent: true }, 200, headers);
  }

  if (!row.execution_id || row.execution_id !== executionId) {
    return json(
      {
        success: true,
        ignored: true,
        reason: 'stale_execution_id',
      },
      200,
      headers,
    );
  }

  const now = new Date().toISOString();
  const { data: updated, error: updErr } = await supabase
    .from('rep_device_commands')
    .update({
      status,
      result: body.result ?? null,
      updated_at: now,
    })
    .eq('id', commandId)
    .eq('execution_id', executionId)
    .eq('status', 'processing')
    .select('id')
    .maybeSingle();

  if (updErr) return json({ error: updErr.message }, 500, headers);

  if (!updated) {
    return json(
      {
        success: true,
        ignored: true,
        reason: 'execution_mismatch_or_already_finished',
      },
      200,
      headers,
    );
  }

  if (status === 'done' && body.result?.success === true) {
    await supabase
      .from('rep_devices')
      .update({ status: 'ativo', status_runtime: 'online', last_seen_at: now, updated_at: now })
      .eq('id', row.device_id);
  }

  return json({ success: true }, 200, headers);
}

export async function handleRepCommands(request: Request): Promise<Response> {
  const headers = cors(request);
  if (request.method === 'OPTIONS') {
    return noCache(new Response(null, { status: 204, headers }));
  }

  try {
    let supabase: SupabaseClient;
    try {
      const { url, serviceKey } = getSupabaseConfig();
      supabase = createClient(url, serviceKey, { auth: { persistSession: false } });
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      return json({ error: 'Supabase não configurado', detail }, 500, headers);
    }

    if (request.method === 'POST') {
      return handleCreateCommand(request, supabase, headers);
    }
    if (request.method === 'GET') {
      return handleGetCommands(request, supabase, headers);
    }

    return json({ error: 'Method not allowed' }, 405, headers);
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    console.error('[rep/commands] unhandled:', detail);
    return json({ error: 'Erro interno', detail }, 500, headers);
  }
}
