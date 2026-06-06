import { isAdminOrHr, normalizeRole } from './authContext.js';

/** Perfil de acesso exposto na API (mapeia roles canônicas do banco). */
export type AccessProfile = 'COLABORADOR' | 'ADMIN_RH';

const ADMIN_RH_ALIASES = new Set(['admin', 'hr', 'administrador', 'rh', 'admin_rh', 'admin/rh']);

export function isAdminRH(role: string | undefined): boolean {
  const raw = String(role ?? '').trim().toLowerCase();
  if (ADMIN_RH_ALIASES.has(raw)) return true;
  return isAdminOrHr(normalizeRole(role));
}

export function isCollaborator(role: string | undefined): boolean {
  return !isAdminRH(role);
}

/** Alias semântico para rotas administrativas. */
export function hasAdminAccess(role: string | undefined): boolean {
  return isAdminRH(role);
}

export function resolveAccessProfile(role: string | undefined): AccessProfile {
  return isAdminRH(role) ? 'ADMIN_RH' : 'COLABORADOR';
}

export function accessProfileFromRole(role: string | undefined): AccessProfile {
  return resolveAccessProfile(role);
}
