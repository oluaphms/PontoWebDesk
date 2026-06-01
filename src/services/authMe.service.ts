import { ApiError, apiGet } from './apiClient';
import { clearToken, setToken } from './authToken';
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

export async function fetchAuthMe(): Promise<User | null> {
  try {
    const res = (await apiGet('/auth/me')) as MeResponse;
    const user = res.user ?? res.data;
    if ((!res?.ok && !res?.success) || !user?.id) {
      clearToken();
      return null;
    }
    setToken('cookie');
    return mapMeUser(user);
  } catch (error) {
    const status = error instanceof ApiError ? error.status : undefined;
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
    clearToken();
    return null;
  }
}
