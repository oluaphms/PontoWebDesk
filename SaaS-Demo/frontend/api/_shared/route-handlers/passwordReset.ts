import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { noCache } from '../cache.js';
import { getSupabaseUrlForServer } from '../getSupabaseConfig.js';
import {
  checkRateLimitDistributed,
  getClientIP,
  getSecureCorsHeaders,
  requireTrustedOrigin,
} from '../security.js';

const ResetPasswordBodySchema = z.object({
  email: z.string().email(),
});

function json(body: unknown, status: number, headers: Record<string, string>): Response {
  return noCache(Response.json(body, { status, headers: { ...headers, 'Content-Type': 'application/json' } }));
}

function resetRedirectUrl(request: Request): string {
  const isProduction = String(process.env.NODE_ENV || '').trim().toLowerCase() === 'production';
  const parseOrigin = (value: string): string | null => {
    try {
      const parsed = new URL(value);
      const localhost =
        parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
      if (parsed.protocol === 'https:') return parsed.origin;
      if (!isProduction && localhost && parsed.protocol === 'http:') return parsed.origin;
      return null;
    } catch {
      return null;
    }
  };

  const allowedOrigins = new Set<string>();
  const allowDefaults = [
    'https://pontowebdesk.vercel.app',
    'https://pontowebdesk.com.br',
    'https://www.pontowebdesk.com.br',
  ];
  for (const origin of allowDefaults) allowedOrigins.add(origin);
  for (const candidate of String(process.env.CORS_ALLOWED_ORIGINS || process.env.CORS_ORIGINS || '').split(',')) {
    const parsed = parseOrigin(candidate.trim());
    if (parsed) allowedOrigins.add(parsed);
  }

  const fromEnv = (
    process.env.FRONTEND_URL ||
    process.env.APP_URL ||
    process.env.VITE_APP_URL ||
    process.env.CORS_APP_ORIGIN ||
    ''
  )
    .toString()
    .trim()
    .replace(/\/+$/, '');

  const fromEnvOrigin = parseOrigin(fromEnv);
  const originHeader = parseOrigin(
    (request.headers.get('Origin') || '').trim().replace(/\/+$/, ''),
  );
  const originAllowed = originHeader ? allowedOrigins.has(originHeader) : false;
  const base =
    (fromEnvOrigin && (allowedOrigins.has(fromEnvOrigin) || !isProduction) ? fromEnvOrigin : '') ||
    (originAllowed ? originHeader! : '') ||
    (isProduction ? 'https://pontowebdesk.vercel.app' : 'http://localhost:3010');

  return `${base}/reset-password`;
}

async function handler(request: Request): Promise<Response> {
  const corsHeaders = getSecureCorsHeaders(request, {
    allowMethods: 'POST, OPTIONS',
    allowHeaders: 'Content-Type',
  });
  if (request.method === 'OPTIONS') {
    return noCache(new Response(null, { status: 204, headers: corsHeaders }));
  }
  if (request.method !== 'POST') {
    return json({ success: false, error: 'METHOD_NOT_ALLOWED' }, 405, corsHeaders);
  }
  const blockedOrigin = requireTrustedOrigin(request, corsHeaders);
  if (blockedOrigin) return blockedOrigin;

  let body: z.infer<typeof ResetPasswordBodySchema>;
  try {
    const raw = await request.json();
    const parsed = ResetPasswordBodySchema.safeParse(raw);
    if (!parsed.success) {
      return json({ success: false, error: 'E-mail inválido.', code: 'VALIDATION_ERROR' }, 400, corsHeaders);
    }
    body = parsed.data;
  } catch {
    return json({ success: false, error: 'JSON inválido.', code: 'INVALID_JSON' }, 400, corsHeaders);
  }

  const email = body.email.trim().toLowerCase();
  const clientIP = getClientIP(request);
  let rate;
  try {
    rate = await checkRateLimitDistributed(`${clientIP}:${email}`, 'reset');
  } catch (error) {
    if (error instanceof Error && error.message === 'RATE_LIMIT_REDIS_REQUIRED') {
      return json({ success: false, error: 'Rate limiting distribuído obrigatório não configurado.', code: 'RATE_LIMIT_UNAVAILABLE' }, 503, corsHeaders);
    }
    throw error;
  }
  if (!rate.allowed) {
    const retryAfterSeconds = Math.max(1, Math.ceil((rate.resetAt - Date.now()) / 1000));
    return noCache(Response.json(
      {
        success: false,
        error: 'Muitas solicitações de recuperação. Aguarde alguns minutos e tente novamente.',
        code: 'RATE_LIMIT',
        retryAfterSeconds,
      },
      {
        status: 429,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
          'Retry-After': String(retryAfterSeconds),
        },
      },
    ));
  }

  const supabaseUrl = getSupabaseUrlForServer();
  const anonKey = (process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '').trim();
  if (!supabaseUrl || !anonKey) {
    return json({ success: false, error: 'Supabase não configurado.', code: 'CONFIG_MISSING' }, 500, corsHeaders);
  }

  const supabase = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: resetRedirectUrl(request),
  });
  if (error) {
    return json({ success: false, error: error.message, code: 'RESET_FAILED' }, 400, corsHeaders);
  }

  return json({ success: true, error: null }, 200, corsHeaders);
}

export default { fetch: handler };
