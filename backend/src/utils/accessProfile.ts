import { isAdminOrHr, normalizeRole } from './authContext.js';

/** Perfil de acesso exposto na API (mapeia roles canônicas do banco). */
export type AccessProfile = 'COLABORADOR' | 'ADMIN_RH' | 'ADMIN_GERENTE';

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

export function isAdminGerente(role: string | undefined): boolean {
  return normalizeRole(role) === 'admin_gerente';
}

export function isAdminRH(role: string | undefined): boolean {
  const r = normalizeRole(role);
  return r === 'admin' || r === 'hr';
}

export function isCollaborator(role: string | undefined): boolean {
  const r = normalizeRole(role);
  return r === 'employee' || r === 'supervisor';
}

/** Acesso ao painel administrativo (admin, hr, admin_gerente). */
export function hasAdminAccess(role: string | undefined): boolean {
  const raw = String(role ?? '').trim().toLowerCase();
  if (ADMIN_ACCESS_ALIASES.has(raw)) return true;
  const r = normalizeRole(role);
  return r === 'admin' || r === 'hr' || r === 'admin_gerente';
}

/** Pode registrar ponto (colaborador, supervisor, admin, hr — não admin_gerente). */
export function canRegisterPunch(role: string | undefined): boolean {
  const r = normalizeRole(role);
  if (r === 'admin_gerente') return false;
  return r === 'employee' || r === 'supervisor' || r === 'admin' || r === 'hr';
}

export function resolveAccessProfile(role: string | undefined): AccessProfile {
  const r = normalizeRole(role);
  if (r === 'admin_gerente') return 'ADMIN_GERENTE';
  if (r === 'admin' || r === 'hr') return 'ADMIN_RH';
  return 'COLABORADOR';
}

export function accessProfileFromRole(role: string | undefined): AccessProfile {
  return resolveAccessProfile(role);
}
