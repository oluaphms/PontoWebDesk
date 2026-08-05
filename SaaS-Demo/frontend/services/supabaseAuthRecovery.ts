/**
 * Recuperação de senha via Supabase GoTrue (fetch direto — sem @supabase/supabase-js no bundle).
 */
import { isSupabaseCloudEnvConfigured, readSupabaseAnonKey, readSupabaseUrl } from '../src/config/env';

export type RecoverySession = {
  access_token: string;
  refresh_token: string;
  user: { id: string; email?: string | null };
};

let cachedRecoverySession: RecoverySession | null = null;

function authBaseUrl(): string {
  return readSupabaseUrl().replace(/\/+$/, '');
}

function anonKey(): string {
  return readSupabaseAnonKey();
}

function authHeaders(accessToken?: string): Record<string, string> {
  const key = anonKey();
  return {
    apikey: key,
    Authorization: `Bearer ${accessToken || key}`,
    'Content-Type': 'application/json',
  };
}

export type RecoveryUrlParams = {
  type?: string;
  access_token?: string;
  refresh_token?: string;
  token_hash?: string;
  token?: string;
  code?: string;
};

export function parseRecoveryParamsFromUrl(): RecoveryUrlParams {
  if (typeof window === 'undefined') return {};
  const hash = window.location.hash.replace(/^#/, '');
  const hashParams = new URLSearchParams(hash);
  const searchParams = new URLSearchParams(window.location.search);
  return {
    type: hashParams.get('type') || searchParams.get('type') || undefined,
    access_token: hashParams.get('access_token') || undefined,
    refresh_token: hashParams.get('refresh_token') || undefined,
    token_hash:
      hashParams.get('token_hash') ||
      searchParams.get('token_hash') ||
      undefined,
    token: hashParams.get('token') || searchParams.get('token') || undefined,
    code: searchParams.get('code') || hashParams.get('code') || undefined,
  };
}

export function hasRecoveryLinkInUrl(): boolean {
  const p = parseRecoveryParamsFromUrl();
  if (p.type === 'recovery') return true;
  if (p.access_token && p.refresh_token) return true;
  if (p.token_hash || p.token) return true;
  if (p.code) return true;
  return false;
}

async function readAuthUser(accessToken: string): Promise<{ id: string; email?: string | null } | null> {
  const res = await fetch(`${authBaseUrl()}/auth/v1/user`, { headers: authHeaders(accessToken) });
  if (!res.ok) return null;
  const user = (await res.json()) as { id?: string; email?: string | null };
  if (!user?.id) return null;
  return { id: String(user.id), email: user.email ?? null };
}

async function verifyRecoveryToken(tokenOrHash: string, useHashField: boolean): Promise<RecoverySession | null> {
  const body = useHashField
    ? { type: 'recovery', token_hash: tokenOrHash }
    : { type: 'recovery', token: tokenOrHash };
  const res = await fetch(`${authBaseUrl()}/auth/v1/verify`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    user?: { id?: string; email?: string | null };
  };
  if (!data.access_token || !data.refresh_token || !data.user?.id) return null;
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    user: { id: String(data.user.id), email: data.user.email ?? null },
  };
}

async function exchangePkceCode(code: string): Promise<RecoverySession | null> {
  const res = await fetch(`${authBaseUrl()}/auth/v1/token?grant_type=pkce`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ auth_code: code }),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    user?: { id?: string; email?: string | null };
  };
  if (!data.access_token || !data.refresh_token || !data.user?.id) return null;
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    user: { id: String(data.user.id), email: data.user.email ?? null },
  };
}

export function getCachedRecoverySession(): RecoverySession | null {
  return cachedRecoverySession;
}

export function clearCachedRecoverySession(): void {
  cachedRecoverySession = null;
}

export async function restoreRecoverySessionFromUrl(): Promise<RecoverySession | null> {
  if (!isSupabaseCloudEnvConfigured()) return null;
  if (cachedRecoverySession) return cachedRecoverySession;

  const p = parseRecoveryParamsFromUrl();

  if (p.access_token && p.refresh_token) {
    const user = await readAuthUser(p.access_token);
    if (!user) return null;
    cachedRecoverySession = {
      access_token: p.access_token,
      refresh_token: p.refresh_token,
      user,
    };
    return cachedRecoverySession;
  }

  if (p.token_hash) {
    const session = await verifyRecoveryToken(p.token_hash, true);
    if (session) cachedRecoverySession = session;
    return session;
  }

  if (p.token) {
    const session = await verifyRecoveryToken(p.token, false);
    if (session) cachedRecoverySession = session;
    return session;
  }

  if (p.code) {
    const session = await exchangePkceCode(p.code);
    if (session) cachedRecoverySession = session;
    return session;
  }

  return null;
}

export async function updateSupabaseAuthPassword(accessToken: string, password: string): Promise<void> {
  const res = await fetch(`${authBaseUrl()}/auth/v1/user`, {
    method: 'PUT',
    headers: authHeaders(accessToken),
    body: JSON.stringify({ password }),
  });
  if (res.ok) return;
  let message = 'Erro ao redefinir senha no servidor de autenticação.';
  try {
    const body = (await res.json()) as { msg?: string; error_description?: string; message?: string };
    message = body.msg || body.error_description || body.message || message;
  } catch {
    // ignore
  }
  throw new Error(message);
}

export function clearRecoveryParamsFromUrl(): void {
  if (typeof window === 'undefined' || !window.history?.replaceState) return;
  window.history.replaceState({}, '', window.location.pathname);
}
