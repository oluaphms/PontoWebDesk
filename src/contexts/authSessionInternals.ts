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

export function clearStoredSessionUser(): void {
  sessionUserCache = null;
  if (typeof window === 'undefined') return;
  try {
    getUserProfileStorage().removeItem('current_user');
    window.dispatchEvent(new Event('current_user_changed'));
  } catch {
    // ignore
  }
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
      roleRaw === 'admin' || roleRaw === 'hr' || roleRaw === 'employee' || roleRaw === 'supervisor'
        ? (roleRaw as User['role'])
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
      departmentName: parsed.departmentName != null ? String(parsed.departmentName) : parsed.department_name != null ? String(parsed.department_name) : undefined,
      schedule_id: parsed.schedule_id != null ? String(parsed.schedule_id) : undefined,
      scheduleName: parsed.scheduleName != null ? String(parsed.scheduleName) : parsed.schedule_name != null ? String(parsed.schedule_name) : undefined,
      shift_id: parsed.shift_id != null ? String(parsed.shift_id) : undefined,
      shiftName: parsed.shiftName != null ? String(parsed.shiftName) : parsed.shift_name != null ? String(parsed.shift_name) : undefined,
      estrutura_id: parsed.estrutura_id != null ? String(parsed.estrutura_id) : undefined,
      estruturaName: parsed.estruturaName != null ? String(parsed.estruturaName) : parsed.estrutura_name != null ? String(parsed.estrutura_name) : undefined,
      departamento: parsed.departamento != null ? String(parsed.departamento) : undefined,
      jornada_tipo: parsed.jornada_tipo != null ? String(parsed.jornada_tipo) : undefined,
      carga_horaria: parsed.carga_horaria != null ? Number(parsed.carga_horaria) : undefined,
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
