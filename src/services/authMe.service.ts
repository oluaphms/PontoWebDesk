import { ApiError, apiGet } from './apiClient';
import { clearToken, getToken } from './authToken';
import type { User } from '../../types';
import { normalizeUserRole } from '../utils/userRole';
import { logger } from '../shared/logger/logger';

type MeUser = {
    id: string;
    nome: string;
    email: string;
    cargo?: string | null;
    role: string;
    company_id: string;
    department_id?: string | null;
    department_name?: string | null;
    avatar?: string | null;
    preferences?: User['preferences'];
    schedule_id?: string | null;
    schedule_name?: string | null;
    shift_id?: string | null;
    shift_name?: string | null;
    estrutura_id?: string | null;
    estrutura_name?: string | null;
    departamento?: string | null;
    jornada_tipo?: string | null;
    carga_horaria?: number | null;
    phone?: string | null;
  };
type MeResponse = {
  ok?: boolean;
  success?: boolean;
  data?: MeUser;
  user?: MeUser;
  error?: string;
};

let authMeInflight: Promise<User | null> | null = null;

function shouldClearTokenForAuthMe401(authCode: string): boolean {
  return (
    authCode === 'AUTH_INVALID_TOKEN' ||
    authCode === 'AUTH_TOKEN_EXPIRED' ||
    authCode === 'AUTH_TOKEN_REVOKED' ||
    authCode === 'AUTH_USER_NOT_FOUND' ||
    authCode === 'AUTH_TENANT_CHANGED' ||
    authCode === 'AUTH_MISSING_TOKEN' ||
    authCode === 'missing_token'
  );
}

function mapMeUser(row: MeUser): User {
  return {
    id: row.id,
    nome: row.nome,
    email: row.email,
    cargo: row.cargo ?? 'Colaborador',
    role: normalizeUserRole(row.role),
    companyId: row.company_id,
    tenantId: row.company_id,
    departmentId: row.department_id ?? '',
    departmentName: row.department_name ?? row.departamento ?? undefined,
    avatar: row.avatar ?? undefined,
    schedule_id: row.schedule_id,
    scheduleName: row.schedule_name ?? undefined,
    shift_id: row.shift_id ?? undefined,
    shiftName: row.shift_name ?? undefined,
    estrutura_id: row.estrutura_id ?? undefined,
    estruturaName: row.estrutura_name ?? undefined,
    departamento: row.departamento ?? undefined,
    jornada_tipo: row.jornada_tipo ?? undefined,
    carga_horaria: row.carga_horaria ?? undefined,
    phone: row.phone ?? undefined,
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

  if (!hasLocalToken) {
    return null;
  }

  try {
    const res = (await apiGet('/auth/me')) as MeResponse;
    const user = res.user ?? res.data;
    if ((!res?.ok && !res?.success) || !user?.id) {
      clearToken();
      return null;
    }
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
      shouldClearTokenForAuthMe401(authCode)
    ) {
      clearToken();
    }
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
    if (status === 401 && shouldClearTokenForAuthMe401(authCode)) clearToken();
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
