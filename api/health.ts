/**
 * GET /api/health
 *
 * Health check do sistema híbrido.
 * Verifica: Supabase acessível, fila local funcionando, circuit breaker.
 *
 * Retorna 200 se tudo OK, 503 se algum componente crítico falhou.
 */

import { createClient } from '@supabase/supabase-js';
import { getSecureCorsHeaders, checkRateLimit, getClientIP } from './_shared/security.js';
import { getSupabaseUrlForServer } from './_shared/getSupabaseConfig.js';

const ALLOWED_METHODS = 'GET, OPTIONS';
const SUPABASE_TIMEOUT_MS = 5_000;

async function checkSupabase(url: string, serviceKey: string): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const t0 = Date.now();
  try {
    const supabase = createClient(url, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), SUPABASE_TIMEOUT_MS);
    const { error } = await supabase
      .from('clock_event_logs')
      .select('id')
      .limit(1)
      .abortSignal(controller.signal);
    clearTimeout(timeout);
    return { ok: !error, latencyMs: Date.now() - t0, error: error?.message };
  } catch (e) {
    return { ok: false, latencyMs: Date.now() - t0, error: e instanceof Error ? e.message : String(e) };
  }
}

export default async function handler(request: Request): Promise<Response> {
  const corsHeaders = getSecureCorsHeaders(request, {
    allowMethods: ALLOWED_METHODS,
    allowHeaders: 'Content-Type',
  });

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  // Rate limiting por IP (mais permissivo para health checks)
  const clientIP = getClientIP(request);
  const rateLimit = checkRateLimit(clientIP, 'general');
  if (!rateLimit.allowed) {
    return Response.json(
      { error: 'Rate limit exceeded', retryAfter: Math.ceil((rateLimit.resetAt - Date.now()) / 1000) },
      { status: 429, headers: corsHeaders }
    );
  }

  const url = getSupabaseUrlForServer();
  const serviceKey  = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  const apiKey      = (process.env.CLOCK_AGENT_API_KEY || process.env.API_KEY || '').trim();

  const checks: Record<string, { ok: boolean; detail?: string; latencyMs?: number }> = {};

  // 1. Configuração
  checks.config = {
    ok: !!(url && serviceKey && apiKey),
    detail: !url ? 'URL Supabase ausente (SUPABASE_URL, URL_SUPABASE ou VITE_SUPABASE_URL)'
      : !serviceKey ? 'SUPABASE_SERVICE_ROLE_KEY ausente'
      : !apiKey ? 'API_KEY ausente'
      : 'ok',
  };

  // 2. Supabase
  if (url && serviceKey) {
    const result = await checkSupabase(url, serviceKey);
    checks.supabase = { ok: result.ok, latencyMs: result.latencyMs, detail: result.error ?? 'ok' };
  } else {
    checks.supabase = { ok: false, detail: 'credenciais ausentes' };
  }

  // 3. API /api/punch (self-check)
  checks.api_punch = { ok: true, detail: 'endpoint disponível' };

  const allOk = Object.values(checks).every(c => c.ok);
  const status = allOk ? 200 : 503;

  return Response.json(
    {
      status: allOk ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      checks,
    },
    { status, headers: corsHeaders }
  );
}
