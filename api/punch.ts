/**
 * API intermediária para batidas do agente local (relógio).
 *
 * Responsabilidades:
 * - Validar schema das batidas vindas do agente
 * - Validar device_id (deve existir e pertencer à company)
 * - Rate limiting (por device/company)
 * - Inserir em clock_event_logs com source='clock'
 * - Retornar erro detalhado para o agente gerenciar retry
 *
 * Auth: Bearer API_KEY (compartilhado entre agente e servidor)
 *
 * POST /api/punch
 * Body: { deviceId, companyId, punches: [{ employee_id, occurred_at, event_type, dedupe_hash, raw }] }
 */

import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { PUNCH_SOURCE_WEB } from '../src/constants/punchSource';
import { sendPunch } from '../src/services/sendPunch.service';
import { getSupabaseConfig } from './_shared/getSupabaseConfig.js';
import { cachePublic, noCache } from './_shared/cache.js';
import { getSecureCorsHeaders, requireTrustedOrigin } from './_shared/security.js';

// NOTA: Rate limiting em memória não funciona em serverless (Vercel).
// A proteção real é feita pela validação de device_id + API_KEY.
// Para rate limiting persistente, use Upstash Redis ou uma tabela Supabase.

// Schema de validação Zod
const PunchSchema = z.object({
  employee_id: z.string().min(1),
  occurred_at: z.string().datetime(),
  // Aceita tipos específicos ou 'batida' genérica (será interpretada pelo backend)
  event_type: z.enum(['entrada', 'saída', 'saida', 'pausa', 'batida', 'E', 'S', 'P', 'B']),
  dedupe_hash: z.string().min(1),
  raw: z.record(z.any()).optional().default({}),
});

const RequestSchema = z.object({
  deviceId: z.string().min(1),
  companyId: z.string().min(1),
  punches: z.array(PunchSchema).min(1).max(1000),
});
const SinglePunchSchema = z.object({
  employeeId: z.string().min(1),
  companyId: z.string().min(1),
  type: z.string().min(1),
  method: z.string().optional(),
  timestamp: z.string().min(1),
});

export type PunchPayload = z.infer<typeof PunchSchema>;
export type BatchRequest = z.infer<typeof RequestSchema>;

function normalizeEventType(type: string): string {
  const t = type.toLowerCase().trim();
  if (t === 'saída') return 'saída';
  if (t === 'saida') return 'saída';
  if (t === 'entrada') return 'entrada';
  if (t === 'pausa') return 'pausa';
  if (t === 'batida') return 'batida';
  if (t === 'e') return 'entrada';
  if (t === 's') return 'saída';
  if (t === 'p') return 'pausa';
  if (t === 'b') return 'batida';
  return 'batida';
}

async function handler(request: Request): Promise<Response> {
  const pathname = new URL(request.url).pathname.replace(/\/+$/, '');
  // Lote web/mobile (JWT) — mesma função que /api/punch (limite Hobby: 12 serverless)
  if (pathname === '/api/web-punches' || pathname.endsWith('/web-punches')) {
    const { handleWebPunchesBatch } = await import('./_shared/webPunchesBatchHttp.js');
    return handleWebPunchesBatch(request);
  }

  const corsHeaders = getSecureCorsHeaders(request, {
    allowMethods: 'GET, HEAD, POST, OPTIONS',
    allowHeaders: 'Content-Type, Authorization, x-api-key',
  });
  if (request.method === 'OPTIONS') {
    return noCache(new Response(null, { status: 204, headers: corsHeaders }));
  }

  // Health check leve (para agente verificar disponibilidade antes de enviar batches)
  if (request.method === 'GET' || request.method === 'HEAD') {
    return cachePublic(
      Response.json({ ok: true, mode: 'api-punch', version: 1 }, { status: 200, headers: corsHeaders }),
      30,
      120,
    );
  }

  if (request.method !== 'POST') {
    return noCache(Response.json({ error: 'Method not allowed' }, { status: 405, headers: corsHeaders }));
  }
  const blockedOrigin = requireTrustedOrigin(request, corsHeaders);
  if (blockedOrigin) return blockedOrigin;

  // Auth: API_KEY via Bearer ou x-api-key
  const apiKey = (process.env.CLOCK_AGENT_API_KEY || process.env.API_KEY || '').trim();
  if (!apiKey) {
    return noCache(Response.json(
      { error: 'API_KEY não configurada no servidor.' },
      { status: 500, headers: corsHeaders }
    ));
  }

  const authHeader = request.headers.get('Authorization') || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  const xApiKey = request.headers.get('x-api-key') || '';

  if (token !== apiKey && xApiKey !== apiKey) {
    return noCache(Response.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders }));
  }

  // Parse e validação
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return noCache(Response.json({ error: 'Body JSON inválido.' }, { status: 400, headers: corsHeaders }));
  }

  // Conexão Supabase (service role - NUNCA exposta no frontend)
  let url: string;
  let serviceKey: string;
  try {
    ({ url, serviceKey } = getSupabaseConfig());
  } catch {
    return noCache(Response.json(
      { error: 'Configuração Supabase ausente no servidor.' },
      { status: 500, headers: corsHeaders }
    ));
  }

  const supabase = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const maybeLegacy = typeof body === 'object' && body !== null && 'employeeId' in body && 'timestamp' in body;
  const isLegacyPunches = maybeLegacy;
  if (isLegacyPunches) {
    const parsed = SinglePunchSchema.safeParse(body);
    if (!parsed.success) {
      return noCache(Response.json(
        { error: 'Schema inválido.', details: parsed.error.format() },
        { status: 400, headers: corsHeaders },
      ));
    }
    const { employeeId, companyId, type, method, timestamp } = parsed.data;
    const ts = new Date(timestamp);
    if (Number.isNaN(ts.getTime())) {
      return noCache(Response.json({ error: 'timestamp inválido.' }, { status: 400, headers: corsHeaders }));
    }
    try {
      await sendPunch(supabase, {
        employee_id: employeeId,
        company_id: companyId,
        type,
        method: method || 'api',
        created_at: ts.toISOString(),
        source: PUNCH_SOURCE_WEB,
      });
      return noCache(Response.json({ success: true }, { status: 200, headers: corsHeaders }));
    } catch (e: unknown) {
      const msg = e && typeof e === 'object' && 'message' in e ? String((e as { message: unknown }).message) : String(e);
      return noCache(Response.json({ error: msg }, { status: 500, headers: corsHeaders }));
    }
  }

  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return noCache(Response.json(
      { error: 'Schema inválido.', details: parsed.error.format() },
      { status: 400, headers: corsHeaders }
    ));
  }

  const { deviceId, companyId, punches } = parsed.data;

  // ===== VALIDAÇÃO DE DEVICE =====
  // Verificar se o device existe, pertence à company e está ativo
  const devicesTable = process.env.SUPABASE_DEVICES_TABLE || 'devices';
  const { data: device, error: deviceError } = await supabase
    .from(devicesTable)
    .select('id, company_id, active, brand, ip, name')
    .eq('id', deviceId)
    .eq('company_id', companyId)
    .eq('active', true)
    .maybeSingle();

  if (deviceError) {
    console.error('[API /punch] Erro ao validar device:', deviceError);
    return noCache(Response.json(
      { error: 'Erro ao validar device.', deviceId, companyId },
      { status: 500, headers: corsHeaders }
    ));
  }

  if (!device) {
    return noCache(Response.json(
      { 
        error: 'Device não encontrado ou não autorizado.',
        details: 'Verifique se o device_id existe, pertence à company e está ativo.',
        deviceId,
        companyId,
      },
      { status: 403, headers: corsHeaders }
    ));
  }

  // Log de auditoria (opcional: verificar IP se necessário)
  console.log(`[API /punch] Device validado: ${device.name} (${deviceId}) - ${punches.length} batidas`);

  // Montar rows para clock_event_logs
  const timeLogsTable = process.env.SUPABASE_TIME_LOGS_TABLE || 'clock_event_logs';
  const now = new Date().toISOString();

  const rows = punches.map((p) => ({
    employee_id: p.employee_id,
    occurred_at: p.occurred_at,
    event_type: normalizeEventType(p.event_type),
    device_id: deviceId,
    company_id: companyId,
    dedupe_hash: p.dedupe_hash,
    raw: {
      ...p.raw,
      _ingested_via: 'api/punch',
      _ingested_at: now,
    },
    source: 'clock',
    created_at: now,
  }));

  // Upsert idempotente: ON CONFLICT (dedupe_hash) DO NOTHING
  // Garante que lotes com duplicatas parciais não descartam registros novos.
  try {
    const { error } = await supabase
      .from(timeLogsTable)
      .upsert(rows, { onConflict: 'dedupe_hash', ignoreDuplicates: true });

    if (error) {
      throw error;
    }

    return noCache(Response.json(
      {
        success: true,
        inserted: rows.length,
        duplicates: 0,
        deviceId,
        companyId,
      },
      { status: 200, headers: corsHeaders }
    ));
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[API /punch] Erro ao inserir:', msg);
    return noCache(Response.json(
      {
        success: false,
        error: msg,
        deviceId,
        companyId,
        failedCount: rows.length,
      },
      { status: 500, headers: corsHeaders }
    ));
  }
}

export default { fetch: handler };
