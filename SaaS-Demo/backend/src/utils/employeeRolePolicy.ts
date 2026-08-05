import { normalizeRole } from './authContext.js';
import { isAdminRH } from './accessProfile.js';

const PRIVILEGED_ASSIGNABLE_ROLES = new Set(['admin', 'hr']);

/** Normaliza role atribuível a colaborador/usuário. */
export function normalizeAssignableEmployeeRole(role: unknown): string {
  const value = normalizeRole(String(role ?? 'employee'));
  if (value === 'admin' || value === 'hr') return value;
  if (value === 'supervisor') return 'supervisor';
  return 'employee';
}

export function validateEmployeeRoleAssignment(
  requestedRole: unknown,
  callerRole: string | undefined,
): { ok: true; role: string } | { ok: false; error: string; code: string } {
  const role = normalizeAssignableEmployeeRole(requestedRole);
  if (PRIVILEGED_ASSIGNABLE_ROLES.has(role) && !isAdminRH(callerRole)) {
    return {
      ok: false,
      error: 'Apenas Admin/RH pode atribuir perfil administrativo.',
      code: 'EMPLOYEE_ROLE_FORBIDDEN',
    };
  }
  return { ok: true, role };
}
