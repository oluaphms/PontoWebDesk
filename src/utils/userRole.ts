import type { User } from '../../types';

/** Normaliza roles legadas (administrador, rh, gestor…) para o enum do app. */
export function normalizeUserRole(role: unknown): User['role'] {
  const value = String(role ?? 'employee').trim().toLowerCase();
  if (value === 'admin' || value === 'administrador' || value === 'admin_rh' || value === 'admin/rh') return 'admin';
  if (value === 'hr' || value === 'rh') return 'hr';
  if (value === 'supervisor' || value === 'gestor') return 'supervisor';
  if (value === 'employee' || value === 'colaborador' || value === 'funcionario' || value === 'funcionário') {
    return 'employee';
  }
  return 'employee';
}

export function isAdminOrHrRole(role: unknown): boolean {
  const normalized = normalizeUserRole(role);
  return normalized === 'admin' || normalized === 'hr';
}
