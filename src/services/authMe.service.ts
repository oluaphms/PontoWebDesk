import { apiGet } from './apiClient';
import { clearToken, getToken } from './authToken';
import type { User } from '../../types';

type MeResponse = {
  ok?: boolean;
  user?: {
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
  error?: string;
};

function mapMeUser(row: NonNullable<MeResponse['user']>): User {
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
  if (!getToken()) return null;
  try {
    const res = (await apiGet('/auth/me')) as MeResponse;
    if (!res?.ok || !res.user?.id) {
      clearToken();
      return null;
    }
    return mapMeUser(res.user);
  } catch {
    clearToken();
    return null;
  }
}
