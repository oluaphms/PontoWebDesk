import { auth } from './supabaseClient';

const AUTH_ERROR_CODES: Record<string, string> = {
  USER_ALREADY_EXISTS: 'E-mail já cadastrado.',
  INVALID_PASSWORD: 'Senha inválida (mínimo 6 caracteres).',
  INVALID_EMAIL: 'E-mail inválido.',
  FORBIDDEN: 'Erro de permissão.',
  RATE_LIMIT: 'Limite de requisições atingido. Tente novamente em alguns minutos.',
  CREATE_FAILED: 'Falha ao criar usuário no Auth.',
};

function resolveAppBaseUrl(): string {
  return (import.meta.env.VITE_APP_URL as string) || (typeof window !== 'undefined' ? window.location.origin : '');
}

async function getAdminAccessToken(): Promise<string> {
  const {
    data: { session },
  } = await auth.getSession();
  const token = session?.access_token;
  if (!token) throw new Error('Sessão do administrador não encontrada. Faça login novamente.');
  return token;
}

export async function confirmEmployeeEmailInAuth(email: string): Promise<void> {
  try {
    const token = await getAdminAccessToken();
    const base = resolveAppBaseUrl();
    if (!base) return;
    const res = await fetch(`${base.replace(/\/$/, '')}/api/auth-admin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action: 'confirm-email', email: email.trim().toLowerCase() }),
    });
    if (!res.ok) return;
  } catch {
    // Ignora; funcionário foi criado, admin pode confirmar manualmente no Supabase se precisar.
  }
}

export async function setEmployeePasswordInAuth(
  email: string,
  newPassword: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const token = await getAdminAccessToken();
    const base = resolveAppBaseUrl();
    if (!base) return { success: false, error: 'URL do app não resolvida.' };
    const res = await fetch(`${base.replace(/\/$/, '')}/api/auth-admin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action: 'set-password', email: email.trim().toLowerCase(), newPassword: newPassword.trim() }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = typeof data?.error === 'string' ? data.error : 'Falha ao alterar senha.';
      return { success: false, error: msg };
    }
    return { success: true };
  } catch (e: any) {
    return { success: false, error: e?.message || 'Erro ao alterar senha.' };
  }
}

export async function createEmployeeAuthUser(params: {
  email?: string;
  password?: string;
  metadata?: Record<string, any>;
}): Promise<{ userId: string; existing?: boolean }> {
  const email = String(params.email || '').trim().toLowerCase();
  const password = String(params.password || '').trim();
  const metadata = params.metadata && typeof params.metadata === 'object' ? params.metadata : {};

  const requestBody: Record<string, unknown> = {
    action: 'create-user',
    metadata,
  };
  if (email) requestBody.email = email;
  if (password) requestBody.password = password;

  const res = await fetch('/api/auth-admin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'omit',
    cache: 'no-store',
    body: JSON.stringify(requestBody),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const apiMessage = typeof data?.error === 'string' ? data.error.trim() : '';
    const apiDetail = typeof data?.detail === 'string' ? data.detail.trim() : '';
    const apiCode = data?.code ?? '';
    const friendlyMessage =
      apiDetail ||
      apiMessage ||
      (apiCode && AUTH_ERROR_CODES[apiCode]) ||
      res.statusText ||
      'Falha ao criar usuário no Auth.';
    const err = new Error(friendlyMessage) as Error & { code?: string };
    err.code = apiCode || 'CREATE_FAILED';
    throw err;
  }
  const userId = data?.user_id ?? data?.userId;
  if (!userId) throw new Error('Conta criada mas ID não retornado.');
  return { userId: String(userId), existing: !!data?.existing };
}

export async function rollbackEmployeeAuthUser(params: { userId?: string; email?: string }): Promise<void> {
  const token = await getAdminAccessToken();
  const base = resolveAppBaseUrl();
  if (!base) throw new Error('URL do app não resolvida.');
  const userId = String(params.userId || '').trim();
  const email = String(params.email || '').trim().toLowerCase();
  if (!userId && !email) throw new Error('Rollback requer userId ou email.');

  const body: Record<string, unknown> = { action: 'delete-user' };
  if (userId) body.userId = userId;
  if (email) body.email = email;

  const res = await fetch(`${base.replace(/\/$/, '')}/api/auth-admin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = typeof data?.error === 'string' ? data.error : 'Falha ao executar rollback no Auth.';
    throw new Error(msg);
  }
}
