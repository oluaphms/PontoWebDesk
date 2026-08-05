/**
 * POST /api/rep/collect — coleta manual por intervalo (dispara comando no agente local).
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseConfig, getSupabaseUrlForServer } from './getSupabaseConfig.js';
import { getSecureCorsHeaders, extractBearerToken } from './security.js';
import { noCache } from './cache.js';
import { getCallerContext, isAdminOrHr } from './callerContext.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function cors(request: Request): Record<string, string> {
  return getSecureCorsHeaders(request, {
    allowMethods: 'POST, OPTIONS',
    allowHeaders: 'Content-Type, Authorization',
  });
}

function json(body: unknown, status: number, headers: Record<string, string>): Response {
  return noCache(Response.json(body, { status, headers: { ...headers, 'Content-Type': 'application/json' } }));
}

function parseYmd(s: string): Date | null {
  if (!DATE_RE.test(s)) return null;
  const [y, m, d] = s.split('-').map((n) => parseInt(n, 10));
  const dt = new Date(y, m - 1, d, 0, 0, 0, 0);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

export async function handleRepCollect(request: Request): Promise<Response> {
  const headers = cors(request);

  if (request.method === 'OPTIONS') {
    return noCache(new Response(null, { status: 204, headers }));
  }
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405, headers);
  }

  const token = extractBearerToken(request);
  const anonKey = (process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '').trim();
  const supabaseUrl = getSupabaseUrlForServer();
  if (!token || !anonKey) {
    return json({ error: 'Authorization obrigatório' }, 401, headers);
  }

  let supabase: SupabaseClient;
  try {
    const { url, serviceKey } = getSupabaseConfig();
    supabase = createClient(url, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    return json({ error: 'Supabase não configurado', detail }, 500, headers);
  }

  const caller = await getCallerContext(supabaseUrl, anonKey, supabase, token);
  if (!caller || !isAdminOrHr(caller.role)) {
    return json({ error: 'Acesso negado' }, 403, headers);
  }

  let body: {
    device_id?: string;
    company_id?: string;
    start_date?: string;
    end_date?: string;
    receive_scope?: string;
  };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'JSON inválido' }, 400, headers);
  }

  const deviceId = String(body.device_id || '').trim();
  const startDate = String(body.start_date || '').trim();
  const endDate = String(body.end_date || '').trim();
  const receiveScope = String(body.receive_scope || 'date_range').trim().toLowerCase();

  if (!deviceId) return json({ error: 'device_id é obrigatório' }, 400, headers);
  if (!startDate || !endDate) {
    return json({ error: 'start_date e end_date são obrigatórios (YYYY-MM-DD)' }, 400, headers);
  }

  const startDt = parseYmd(startDate);
  const endDt = parseYmd(endDate);
  if (!startDt || !endDt) {
    return json({ error: 'Datas inválidas. Use YYYY-MM-DD.' }, 400, headers);
  }
  if (startDt.getTime() > endDt.getTime()) {
    return json({ error: 'start_date não pode ser posterior a end_date' }, 400, headers);
  }

  const { data: device, error: devErr } = await supabase
    .from('rep_devices')
    .select('id, company_id, ativo')
    .eq('id', deviceId)
    .maybeSingle();

  if (devErr || !device?.id) {
    return json({ error: 'Dispositivo não encontrado' }, 404, headers);
  }

  const deviceCompanyId = String(device.company_id);
  const bodyCompanyId = String(body.company_id || caller.companyId || '').trim();
  if (bodyCompanyId && bodyCompanyId !== deviceCompanyId) {
    return json({ error: 'company_id não corresponde ao dispositivo' }, 403, headers);
  }
  if (deviceCompanyId !== caller.companyId) {
    return json({ error: 'Dispositivo de outra empresa' }, 403, headers);
  }

  const { data: active } = await supabase
    .from('rep_device_commands')
    .select('id, status')
    .eq('device_id', deviceId)
    .eq('command', 'collect_punches')
    .in('status', ['pending', 'processing'])
    .limit(1)
    .maybeSingle();

  if (active?.id) {
    return json(
      {
        success: true,
        command_id: active.id,
        status: active.status || 'pending',
        reused: true,
        message: 'Coleta já enfileirada para este relógio.',
      },
      200,
      headers,
    );
  }

  const now = new Date().toISOString();
  const payload = {
    start_date: startDate,
    end_date: endDate,
    receive_scope: receiveScope,
    requested_by: caller.userId,
  };

  const { data: row, error: insErr } = await supabase
    .from('rep_device_commands')
    .insert({
      company_id: deviceCompanyId,
      device_id: deviceId,
      command: 'collect_punches',
      status: 'pending',
      execution_id: null,
      payload,
      created_at: now,
      updated_at: now,
    })
    .select('id, status, created_at')
    .single();

  if (insErr || !row) {
    return json({ error: insErr?.message || 'Falha ao enfileirar coleta' }, 500, headers);
  }

  return json(
    {
      success: true,
      command_id: row.id,
      status: row.status,
      device_id: deviceId,
      company_id: deviceCompanyId,
      start_date: startDate,
      end_date: endDate,
      message: 'Coleta enfileirada. O agente local executará em até alguns segundos.',
    },
    200,
    headers,
  );
}
