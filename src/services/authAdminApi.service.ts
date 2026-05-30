import { auth } from './supabaseClient';
import { apiPost } from './api';
import { getToken } from './authToken';
import { isLocalApiMode } from '../config/system';

const AUTH_ERROR_CODES: Record<string, string> = {
  USER_ALREADY_EXISTS: 'E-mail já cadastrado.',
  INVALID_PASSWORD: 'Senha inválida (mínimo 6 caracteres).',
  INVALID_EMAIL: 'E-mail inválido.',
  FORBIDDEN: 'Erro de permissão.',
  RATE_LIMIT: 'Limite de requisições atingido. Tente novamente em alguns minutos.',
  CREATE_FAILED: 'Falha ao criar usuário no Auth.',
};

async function getAdminBearerToken(): Promise<string> {
  if (isLocalApiMode()) {
    const token = getToken();
    if (!token) throw new Error('Sessão expirada. Faça login novamente.');
    return token;
  }
  const {
    data: { session },
  } = await auth.getSession();
  const token = session?.access_token;
  if (!token) throw new Error('Sessão do administrador não encontrada. Faça login novamente.');
  return token;
}

export async function confirmEmployeeEmailInAuth(email: string): Promise<void> {
  if (isLocalApiMode()) return;
  try {
    const token = await getAdminBearerToken();
    await apiPost(
      '/auth/admin',
      { action: 'confirm-email', email: email.trim().toLowerCase() },
      { headers: { Authorization: `Bearer ${token}` } },
    );
  } catch {
    // Ignora; funcionário foi criado, admin pode confirmar manualmente se precisar.
  }
}

export async function setEmployeePasswordInAuth(
  email: string,
  newPassword: string,
): Promise<{ success: boolean; error?: string }> {
  const normalizedEmail = email.trim().toLowerCase();
  const password = newPassword.trim() || '123456';
  try {
    const token = await getAdminBearerToken();
    if (isLocalApiMode()) {
      await apiPost(
        '/admin/set-password',
        { email: normalizedEmail, newPassword: password },
        { headers: { Authorization: `Bearer ${token}` } },
      );
      return { success: true };
    }
    await apiPost(
      '/auth/admin',
      { action: 'set-password', email: normalizedEmail, newPassword: password },
      { headers: { Authorization: `Bearer ${token}` } },
    );
    return { success: true };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Erro ao alterar senha.';
    return { success: false, error: msg };
  }
}

export async function createEmployeeAuthUser(params: {
  email?: string;
  password?: string;
  metadata?: Record<string, unknown>;
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

  try {
    const data = (await apiPost('/auth/admin', requestBody)) as {
      user_id?: string;
      userId?: string;
      existing?: boolean;
      code?: string;
      error?: string;
      detail?: string;
    };
    const userId = data?.user_id ?? data?.userId;
    if (!userId) throw new Error('Conta criada mas ID não retornado.');
    return { userId: String(userId), existing: !!data?.existing };
  } catch (e: unknown) {
    const apiCode =
      e && typeof e === 'object' && 'body' in e
        ? (e as { body?: { code?: string; error?: string; detail?: string } }).body?.code
        : undefined;
    const body =
      e && typeof e === 'object' && 'body' in e
        ? ((e as { body?: { error?: string; detail?: string } }).body ?? {})
        : {};
    const apiMessage = typeof body.error === 'string' ? body.error.trim() : '';
    const apiDetail = typeof body.detail === 'string' ? body.detail.trim() : '';
    const friendlyMessage =
      apiDetail ||
      apiMessage ||
      (apiCode && AUTH_ERROR_CODES[apiCode]) ||
      (e instanceof Error ? e.message : '') ||
      'Falha ao criar usuário no Auth.';
    const err = new Error(friendlyMessage) as Error & { code?: string };
    err.code = apiCode || 'CREATE_FAILED';
    throw err;
  }
}

export async function rollbackEmployeeAuthUser(params: { userId?: string; email?: string }): Promise<void> {
  const token = await getAdminBearerToken();
  const userId = String(params.userId || '').trim();
  const email = String(params.email || '').trim().toLowerCase();
  if (!userId && !email) throw new Error('Rollback requer userId ou email.');

  const body: Record<string, unknown> = { action: 'delete-user' };
  if (userId) body.userId = userId;
  if (email) body.email = email;

  await apiPost('/auth/admin', body, { headers: { Authorization: `Bearer ${token}` } });
}
