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
  email: string;
  password: string;
  metadata?: Record<string, any>;
}): Promise<{ userId: string; existing?: boolean }> {
  const email = params.email.trim().toLowerCase();
  if (!email) throw new Error('E-mail é obrigatório.');
  if (!params.password?.trim()) throw new Error('Senha é obrigatória.');

  const token = await getAdminAccessToken();
  const base = resolveAppBaseUrl();
  if (!base) throw new Error('URL do app não resolvida.');

  const res = await fetch(`${base.replace(/\/$/, '')}/api/auth-admin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ action: 'create-user', email, password: params.password, metadata: params.metadata || undefined }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const apiMessage = typeof data?.error === 'string' ? data.error.trim() : '';
    const apiCode = data?.code ?? '';
    const friendlyMessage = apiMessage || (apiCode && AUTH_ERROR_CODES[apiCode]) || res.statusText || 'Falha ao criar usuário no Auth.';
    const err = new Error(friendlyMessage) as Error & { code?: string };
    err.code = apiCode || 'CREATE_FAILED';
    throw err;
  }
  if (!data?.userId) throw new Error('Conta criada mas ID não retornado.');
  return { userId: String(data.userId), existing: !!data?.existing };
}
