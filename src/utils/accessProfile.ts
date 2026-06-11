import { isAdminOrHrRole, normalizeUserRole } from './userRole';

/** Perfil de acesso do colaborador (camada de produto). */
export type AccessProfile = 'COLABORADOR' | 'ADMIN_RH' | 'ADMIN_GERENTE';
export type AdminRhRole = 'admin' | 'hr';

const ADMIN_ACCESS_ALIASES = new Set([
  'admin',
  'hr',
  'administrador',
  'rh',
  'admin_rh',
  'admin/rh',
  'admin_gerente',
  'admin/gerente',
  'admin gerente',
]);

export const EMPLOYEE_PORTAL_ROLES = ['employee', 'supervisor', 'admin', 'hr'] as const;
export const ADMIN_PORTAL_ROLES = ['admin', 'hr', 'admin_gerente'] as const;

export function isAdminGerente(role: unknown): boolean {
  return normalizeUserRole(role) === 'admin_gerente';
}

export function isAdminRH(role: unknown): boolean {
  const normalized = normalizeUserRole(role);
  return normalized === 'admin' || normalized === 'hr';
}

export function isCollaborator(role: unknown): boolean {
  const normalized = normalizeUserRole(role);
  return normalized === 'employee' || normalized === 'supervisor';
}

export function hasAdminAccess(role: unknown): boolean {
  const raw = String(role ?? '').trim().toLowerCase();
  if (ADMIN_ACCESS_ALIASES.has(raw)) return true;
  const normalized = normalizeUserRole(role);
  return normalized === 'admin' || normalized === 'hr' || normalized === 'admin_gerente';
}

/** Pode registrar ponto e usar portal do colaborador (Admin/RH + colaboradores). */
export function canRegisterPunch(role: unknown): boolean {
  const normalized = normalizeUserRole(role);
  if (normalized === 'admin_gerente') return false;
  return (
    normalized === 'employee' ||
    normalized === 'supervisor' ||
    normalized === 'admin' ||
    normalized === 'hr'
  );
}

export function hasEmployeePortalAccess(role: unknown): boolean {
  return canRegisterPunch(role);
}

export function resolveAccessProfile(role: unknown): AccessProfile {
  const normalized = normalizeUserRole(role);
  if (normalized === 'admin_gerente') return 'ADMIN_GERENTE';
  if (normalized === 'admin' || normalized === 'hr') return 'ADMIN_RH';
  return 'COLABORADOR';
}

export function accessProfileToRole(
  accessProfile: AccessProfile,
  adminRhRole: AdminRhRole = 'admin',
): string {
  if (accessProfile === 'ADMIN_GERENTE') return 'admin_gerente';
  if (accessProfile === 'ADMIN_RH') return adminRhRole;
  return 'employee';
}

export function roleToAccessProfileForm(role: unknown): {
  accessProfile: AccessProfile;
  adminRhRole: AdminRhRole;
} {
  const normalized = normalizeUserRole(role);
  if (normalized === 'admin_gerente') return { accessProfile: 'ADMIN_GERENTE', adminRhRole: 'admin' };
  if (normalized === 'hr') return { accessProfile: 'ADMIN_RH', adminRhRole: 'hr' };
  if (normalized === 'admin') return { accessProfile: 'ADMIN_RH', adminRhRole: 'admin' };
  return { accessProfile: 'COLABORADOR', adminRhRole: 'admin' };
}

export function accessProfileLabel(accessProfile: AccessProfile, adminRhRole?: AdminRhRole): string {
  if (accessProfile === 'ADMIN_GERENTE') return 'Admin/Gerente';
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
  '/employee/requests',
  '/employee/absences',
  '/employee/settings',
]);

export function isCollaboratorMenuPath(path: string): boolean {
  return COLLABORATOR_MENU_PATHS.has(path);
}
