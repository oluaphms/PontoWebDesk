/**
 * Solicita e-mail de recuperação via Supabase Auth (GoTrue).
 * Não altera a geração do token — apenas define o redirectTo do frontend.
 */

export function resolvePasswordResetRedirectUrl(originHeader?: string | null): string {
  const isProd = String(process.env.NODE_ENV || '').trim().toLowerCase() === 'production';
  const configuredUrl = (
    process.env.FRONTEND_URL ||
    process.env.APP_URL ||
    process.env.VITE_APP_URL ||
    process.env.CORS_APP_ORIGIN ||
    ''
  )
    .toString()
    .trim()
    .replace(/\/+$/, '');

  const parseOrigin = (value: string): string | null => {
    try {
      const parsed = new URL(value);
      if (parsed.protocol !== 'https:' && parsed.hostname !== 'localhost' && parsed.hostname !== '127.0.0.1') {
        return null;
      }
      return parsed.origin;
    } catch {
      return null;
    }
  };

  const configuredOrigin = parseOrigin(configuredUrl);
  const requestOrigin = parseOrigin(String(originHeader || '').trim());
  const allowedOrigins = String(process.env.CORS_ALLOWED_ORIGINS || process.env.CORS_ORIGINS || '')
    .split(',')
    .map((value) => parseOrigin(value.trim()))
    .filter((value): value is string => Boolean(value));

  const base =
    configuredOrigin ||
    (requestOrigin && allowedOrigins.includes(requestOrigin) ? requestOrigin : '') ||
    (!isProd &&
    requestOrigin &&
    (new URL(requestOrigin).hostname === 'localhost' || new URL(requestOrigin).hostname === '127.0.0.1')
      ? requestOrigin
      : '') ||
    (isProd ? 'https://pontowebdesk.vercel.app' : 'http://localhost:3010');

  return `${base}/reset-password`;
}

export type RequestPasswordResetResult =
  | { ok: true }
  | { ok: false; status: number; error: string; code?: string };

export async function requestPasswordResetEmail(params: {
  email: string;
  originHeader?: string | null;
}): Promise<RequestPasswordResetResult> {
  const email = String(params.email || '')
    .trim()
    .toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, status: 400, error: 'E-mail inválido.', code: 'VALIDATION_ERROR' };
  }

  const supabaseUrl = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(/\/+$/, '');
  const anonKey = (process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '').trim();

  if (!supabaseUrl || !anonKey) {
    return { ok: false, status: 500, error: 'Supabase não configurado.', code: 'CONFIG_MISSING' };
  }

  const redirectTo = resolvePasswordResetRedirectUrl(params.originHeader);
  const recoverUrl = `${supabaseUrl}/auth/v1/recover?redirect_to=${encodeURIComponent(redirectTo)}`;
  const res = await fetch(recoverUrl, {
    method: 'POST',
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email }),
  });

  if (res.ok) return { ok: true };

  let message = 'Erro ao enviar email de recuperação';
  try {
    const body = (await res.json()) as { msg?: string; error_description?: string; error?: string; message?: string };
    message = body.msg || body.error_description || body.error || body.message || message;
  } catch {
    // corpo vazio
  }
  return { ok: false, status: res.status >= 400 && res.status < 600 ? res.status : 400, error: message, code: 'RESET_FAILED' };
}
