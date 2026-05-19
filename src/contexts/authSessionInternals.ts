import type { User } from '../../types';
import { getUserProfileStorage } from '../services/supabaseClient';

let sessionUserCache: User | null = null;

/** Bloqueia re-hidratação do perfil a partir do storage durante logout explícito. */
let authLogoutGuard = false;

export function setAuthLogoutGuard(active: boolean): void {
  authLogoutGuard = active;
}

export function isAuthLogoutGuardActive(): boolean {
  return authLogoutGuard;
}

export function getSessionUserCache(): User | null {
  return sessionUserCache;
}

export function setSessionUserCache(user: User | null): void {
  sessionUserCache = user;
}

export function readUserFromProfileStore(): User | null {
  if (typeof window === 'undefined') return null;
  if (authLogoutGuard) return null;
  try {
    const raw = getUserProfileStorage().getItem('current_user');
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const id = String(parsed.id ?? '');
    if (!id) return null;
    const companyId = String(parsed.companyId ?? parsed.company_id ?? '').trim();
    const roleRaw = String(parsed.role ?? 'employee').toLowerCase();
    const role =
      roleRaw === 'admin' || roleRaw === 'hr' || roleRaw === 'employee'
        ? (roleRaw as User['role'])
        : roleRaw === 'supervisor'
          ? 'hr'
          : 'employee';
    return {
      id,
      nome: String(parsed.nome ?? parsed.email ?? 'Usuário'),
      email: String(parsed.email ?? ''),
      cargo: String(parsed.cargo ?? 'Colaborador'),
      role,
      createdAt: new Date(),
      companyId: companyId || '',
      tenantId: companyId || '',
      departmentId: String(parsed.departmentId ?? parsed.department_id ?? ''),
      schedule_id: parsed.schedule_id != null ? String(parsed.schedule_id) : undefined,
      shift_id: parsed.shift_id != null ? String(parsed.shift_id) : undefined,
      phone: parsed.phone != null ? String(parsed.phone) : undefined,
      avatar: parsed.avatar != null ? String(parsed.avatar) : undefined,
      preferences: {
        notifications: true,
        theme: 'light',
        allowManualPunch: true,
        language: 'pt-BR',
      },
    };
  } catch {
    return null;
  }
}

export function readInitialSessionUser(): User | null {
  return getSessionUserCache() ?? readUserFromProfileStore();
}
