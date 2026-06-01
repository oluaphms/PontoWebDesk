import { ApiError, apiGet } from './apiClient';
import { clearToken, getToken, setToken } from './authToken';
import type { User } from '../../types';
import { logger } from '../shared/logger/logger';

type MeUser = {
    id: string;
    nome: string;
    email: string;
    cargo?: string | null;
    role: string;
    company_id: string;
    department_id?: string | null;
    avatar?: string | null;
    preferences?: User['preferences'];
    schedule_id?: string | null;
  };
type MeResponse = {
  ok?: boolean;
  success?: boolean;
  data?: MeUser;
  user?: MeUser;
  error?: string;
};

let authMeInflight: Promise<User | null> | null = null;
let lastUnauthorizedAt = 0;
const AUTH_ME_401_COOLDOWN_MS = 10_000;

function mapMeUser(row: MeUser): User {
  return {
    id: row.id,
    nome: row.nome,
    email: row.email,
    cargo: row.cargo ?? 'Colaborador',
    role: (row.role as User['role']) || 'employee',
    companyId: row.company_id,
    tenantId: row.company_id,
    departmentId: row.department_id ?? '',
    avatar: row.avatar ?? undefined,
    schedule_id: row.schedule_id,
    preferences: row.preferences ?? {
      notifications: true,
      theme: 'light',
      allowManualPunch: true,
      language: 'pt-BR',
    },
    createdAt: new Date(),
  };
}

async function fetchAuthMeOnce(): Promise<User | null> {
  const tokenBeforeRequest = getToken();
  const hasLocalToken = Boolean(tokenBeforeRequest);
  if (!hasLocalToken && Date.now() - lastUnauthorizedAt < AUTH_ME_401_COOLDOWN_MS) {
    return null;
  }

  try {
    const res = (await apiGet('/auth/me')) as MeResponse;
    const user = res.user ?? res.data;
    if ((!res?.ok && !res?.success) || !user?.id) {
      clearToken();
      return null;
    }
    if (!tokenBeforeRequest) setToken('cookie');
    return mapMeUser(user);
  } catch (error) {
    const status = error instanceof ApiError ? error.status : undefined;
    const body =
      error instanceof ApiError && error.body && typeof error.body === 'object'
        ? (error.body as Record<string, unknown>)
        : null;
    const authCode = typeof body?.code === 'string' ? body.code : '';
    if (
      status === 401 &&
      hasLocalToken &&
      (authCode === 'AUTH_INVALID_TOKEN' || authCode === 'AUTH_TOKEN_EXPIRED')
    ) {
      clearToken();
      try {
        const retry = (await apiGet('/auth/me')) as MeResponse;
        const retryUser = retry.user ?? retry.data;
        if ((retry?.ok || retry?.success) && retryUser?.id) {
          setToken('cookie');
          return mapMeUser(retryUser);
        }
      } catch {
        // Se nem o cookie HTTP-only recuperar a sessão, segue como 401 real.
      }
    }
    if (status === 401) lastUnauthorizedAt = Date.now();
    logger.warn({
      module: 'auth.me',
      action: 'AUTH_ME_FAILED',
      message:
        status === 401
          ? 'Sessão expirada ou token ausente ao consultar /auth/me'
          : 'Falha ao consultar /auth/me',
      error,
      meta:
        error instanceof ApiError
          ? {
              status: error.status,
              body: error.body,
              path: error.path,
              correlationId: error.correlationId,
            }
          : {},
    });
    if (status === 401) clearToken();
    return null;
  }
}

export async function fetchAuthMe(): Promise<User | null> {
  if (authMeInflight) return authMeInflight;
  authMeInflight = fetchAuthMeOnce().finally(() => {
    authMeInflight = null;
  });
  return authMeInflight;
}
