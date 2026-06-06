import { isAdminOrHrRole, normalizeUserRole } from './userRole';

/** Perfil de acesso do colaborador (camada de produto). */
export type AccessProfile = 'COLABORADOR' | 'ADMIN_RH';
export type AdminRhRole = 'admin' | 'hr';

const ADMIN_RH_ALIASES = new Set(['admin', 'hr', 'administrador', 'rh', 'admin_rh', 'admin/rh']);

export function isAdminRH(role: unknown): boolean {
  const raw = String(role ?? '').trim().toLowerCase();
  if (ADMIN_RH_ALIASES.has(raw)) return true;
  return isAdminOrHrRole(normalizeUserRole(role));
}

export function isCollaborator(role: unknown): boolean {
  return !isAdminRH(role);
}

export function hasAdminAccess(role: unknown): boolean {
  return isAdminRH(role);
}

export function resolveAccessProfile(role: unknown): AccessProfile {
  return isAdminRH(role) ? 'ADMIN_RH' : 'COLABORADOR';
}

export function accessProfileToRole(
  accessProfile: AccessProfile,
  adminRhRole: AdminRhRole = 'admin',
): string {
  if (accessProfile === 'ADMIN_RH') return adminRhRole;
  return 'employee';
}

export function roleToAccessProfileForm(role: unknown): {
  accessProfile: AccessProfile;
  adminRhRole: AdminRhRole;
} {
  const normalized = normalizeUserRole(role);
  if (normalized === 'hr') return { accessProfile: 'ADMIN_RH', adminRhRole: 'hr' };
  if (normalized === 'admin') return { accessProfile: 'ADMIN_RH', adminRhRole: 'admin' };
  return { accessProfile: 'COLABORADOR', adminRhRole: 'admin' };
}

export function accessProfileLabel(accessProfile: AccessProfile, adminRhRole?: AdminRhRole): string {
  if (accessProfile === 'ADMIN_RH') {
    return adminRhRole === 'hr' ? 'Admin/RH (RH)' : 'Admin/RH (Administrador)';
  }
  return 'Colaborador';
}

/** Rotas permitidas no menu lateral do colaborador. */
export const COLLABORATOR_MENU_PATHS = new Set([
  '/employee/dashboard',
  '/dashboard-colaborador',
  '/employee/clock',
  '/employee/timesheet',
  '/employee/work-schedule',
  '/employee/time-balance',
  '/employee/profile',
]);

export function isCollaboratorMenuPath(path: string): boolean {
  return COLLABORATOR_MENU_PATHS.has(path);
}
