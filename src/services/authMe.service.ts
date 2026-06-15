import { ApiError, apiGet } from './apiClient';
import { clearToken, getToken } from './authToken';
import type { User } from '../../types';
import { normalizeUserRole } from '../utils/userRole';
import { logger } from '../shared/logger/logger';
import { observabilityConsole } from '../shared/logger/observabilityConsole';

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
  code?: string;
};

export type AuthMeSessionCheck = {
  user: User | null;
  /** Quando true, a sessão deve ser encerrada (token + perfil). */
  invalidateSession: boolean;
  reason?: string;
};

let authMeInflight: Promise<AuthMeSessionCheck> | null = null;

function authFlowLog(event: string, detail?: Record<string, unknown>): void {
  observabilityConsole.info(`[AUTH-FLOW] ${event}`, detail ?? {});
}

function extractAuthCode(body: unknown): string {
  if (!body || typeof body !== 'object') return '';
  const record = body as Record<string, unknown>;
  const code = typeof record.code === 'string' ? record.code : '';
  const error = typeof record.error === 'string' ? record.error : '';
  return (code || error).trim();
}

/** Códigos em que a sessão deve ser invalidada (logout definitivo). */
export function shouldInvalidateAuthSession(status: number | undefined, authCode: string): boolean {
  if (status === 401) {
    return (
      authCode === 'AUTH_INVALID_TOKEN' ||
      authCode === 'AUTH_TOKEN_EXPIRED' ||
      authCode === 'AUTH_TOKEN_REVOKED' ||
      authCode === 'AUTH_USER_NOT_FOUND' ||
      authCode === 'AUTH_TENANT_CHANGED' ||
      authCode === 'AUTH_MISSING_TOKEN' ||
      authCode === 'invalid_token' ||
      authCode === 'token_expired' ||
      authCode === 'token_revoked' ||
      authCode === 'user_not_found' ||
      authCode === 'tenant_changed' ||
      authCode === 'missing_token'
    );
  }
  if (status === 404) {
    return authCode === 'AUTH_USER_NOT_FOUND' || authCode === 'user_not_found';
  }
  return false;
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

async function fetchAuthMeOnce(): Promise<AuthMeSessionCheck> {
  const hasLocalToken = Boolean(getToken());

  if (!hasLocalToken) {
    authFlowLog('AUTH CHECK SKIPPED', { reason: 'no_token' });
    return { user: null, invalidateSession: false, reason: 'no_token' };
  }

  authFlowLog('AUTH CHECK START');

  try {
    const res = (await apiGet('/auth/me')) as MeResponse;
    const user = res.user ?? res.data;
    if ((res?.ok || res?.success) && user?.id) {
      authFlowLog('AUTH CHECK SUCCESS', { userId: user.id, companyId: user.company_id });
      return { user: mapMeUser(user), invalidateSession: false };
    }
    const authCode = extractAuthCode(res);
    const invalidate = shouldInvalidateAuthSession(undefined, authCode);
    authFlowLog('AUTH CHECK FAILED', { reason: 'invalid_me_payload', authCode, invalidate });
    if (invalidate) clearToken();
    return { user: null, invalidateSession: invalidate, reason: 'invalid_me_payload' };
  } catch (error) {
    const status = error instanceof ApiError ? error.status : undefined;
    const body =
      error instanceof ApiError && error.body && typeof error.body === 'object'
        ? (error.body as Record<string, unknown>)
        : null;
    const authCode = extractAuthCode(body);
    const invalidate = shouldInvalidateAuthSession(status, authCode);

    if (status === 401 && authCode === 'AUTH_TOKEN_EXPIRED') {
      authFlowLog('TOKEN EXPIRED');
    } else if (status === 401 && authCode === 'AUTH_INVALID_TOKEN') {
      authFlowLog('TOKEN INVALID');
    } else if (status === 401 && authCode === 'AUTH_TENANT_CHANGED') {
      authFlowLog('TENANT_CHANGED');
    } else if (status === 401 && authCode === 'AUTH_USER_NOT_FOUND') {
      authFlowLog('USER_NOT_FOUND');
    } else if (status === 401) {
      authFlowLog('API 401', { authCode, invalidate });
    } else if (status === 403) {
      authFlowLog('API 403', { authCode });
    } else {
      authFlowLog('AUTH CHECK FAILED', { status, authCode, transient: !invalidate });
    }

    if (invalidate) {
      clearToken();
      authFlowLog('TOKEN REMOVED', { status, authCode });
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

    return {
      user: null,
      invalidateSession: invalidate,
      reason: authCode || (status != null ? `http_${status}` : 'network_error'),
    };
  }
}

/** Consulta /auth/me com decisão explícita de invalidar sessão. */
export async function fetchAuthMeSessionCheck(): Promise<AuthMeSessionCheck> {
  if (authMeInflight) return authMeInflight;
  authMeInflight = fetchAuthMeOnce().finally(() => {
    authMeInflight = null;
  });
  return authMeInflight;
}

/** Compat: retorna usuário ou null (não invalida sessão em falhas transitórias). */
export async function fetchAuthMe(): Promise<User | null> {
  const result = await fetchAuthMeSessionCheck();
  return result.user;
}
