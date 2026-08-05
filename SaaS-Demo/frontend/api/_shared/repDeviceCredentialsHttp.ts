/**
 * POST /api/rep/devices/:deviceId/credentials
 * Grava senha do relógio criptografada — nunca em config_extra.
 */
import { createClient } from '@supabase/supabase-js';
import { getSupabaseConfig } from './getSupabaseConfig.js';
import { getSecureCorsHeaders, requireTrustedOrigin } from './security.js';
import { getCallerContext, isAdminOrHr } from './callerContext.js';
import { noCache } from './cache.js';
import { encryptDeviceCredentialOrThrow } from './deviceCredentialCrypto.js';

function extractBearer(request: Request): string {
  const raw = request.headers.get('Authorization') || '';
  return raw.replace(/^Bearer\s+/i, '').trim();
}

function stripRepPasswordFromConfigExtra(extra: unknown): Record<string, unknown> {
  const base = extra && typeof extra === 'object' && !Array.isArray(extra)
    ? { ...(extra as Record<string, unknown>) }
    : {};
  delete base.rep_password;
  delete base.password;
  return base;
}

export async function handleRepDeviceCredentials(request: Request, deviceId: string): Promise<Response> {
  const cors = getSecureCorsHeaders(request, {
    allowMethods: 'POST, OPTIONS',
    allowHeaders: 'Content-Type, Authorization',
  });

  if (request.method === 'OPTIONS') {
    return noCache(new Response(null, { status: 204, headers: cors }));
  }
  if (request.method !== 'POST') {
    return noCache(Response.json({ error: 'Method not allowed' }, { status: 405, headers: cors }));
  }

  const blocked = requireTrustedOrigin(request, cors);
  if (blocked) return blocked;

  const jwt = extractBearer(request);
  if (!jwt) {
    return noCache(Response.json({ error: 'Unauthorized' }, { status: 401, headers: cors }));
  }

  let url: string;
  let serviceKey: string;
  try {
    ({ url, serviceKey } = getSupabaseConfig());
  } catch {
    return noCache(Response.json({ error: 'Supabase não configurado.' }, { status: 500, headers: cors }));
  }

  const anonKey = String(
    process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '',
  ).trim();

  const serviceClient = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const caller = await getCallerContext(url, anonKey, serviceClient, jwt);
  if (!caller || !isAdminOrHr(caller.role)) {
    return noCache(Response.json({ error: 'Forbidden' }, { status: 403, headers: cors }));
  }

  let body: { password?: string; rep_login?: string; config_extra?: Record<string, unknown> };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return noCache(Response.json({ error: 'Body inválido' }, { status: 400, headers: cors }));
  }

  const password = String(body?.password || '').trim();
  if (!password) {
    return noCache(Response.json({ error: 'Senha obrigatória.' }, { status: 400, headers: cors }));
  }

  let encrypted;
  try {
    encrypted = encryptDeviceCredentialOrThrow(password);
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Falha ao criptografar credencial.';
    return noCache(Response.json({ error: message, code: 'CREDENTIALS_MASTER_KEY_REQUIRED' }, { status: 503, headers: cors }));
  }

  const { data: device, error: loadErr } = await serviceClient
    .from('rep_devices')
    .select('id, company_id, config_extra')
    .eq('id', deviceId)
    .maybeSingle();

  if (loadErr || !device?.id) {
    return noCache(Response.json({ error: 'Dispositivo não encontrado.' }, { status: 404, headers: cors }));
  }
  if (String(device.company_id) !== String(caller.companyId)) {
    return noCache(Response.json({ error: 'Cross-tenant forbidden.' }, { status: 403, headers: cors }));
  }

  const configExtra = stripRepPasswordFromConfigExtra(device.config_extra);
  if (body.rep_login) {
    configExtra.rep_login = String(body.rep_login).trim() || 'admin';
  }
  configExtra.password_configured = true;

  const { error: updateErr } = await serviceClient
    .from('rep_devices')
    .update({
      password_encrypted: encrypted.encrypted,
      password_iv: encrypted.iv,
      password_tag: encrypted.tag,
      senha_encrypted: encrypted.encrypted,
      senha_iv: encrypted.iv,
      senha_tag: encrypted.tag,
      config_extra: configExtra,
      updated_at: new Date().toISOString(),
    })
    .eq('id', deviceId)
    .eq('company_id', caller.companyId);

  if (updateErr) {
    return noCache(Response.json({ error: updateErr.message }, { status: 500, headers: cors }));
  }

  return noCache(Response.json({ ok: true, password_configured: true }, { status: 200, headers: cors }));
}
