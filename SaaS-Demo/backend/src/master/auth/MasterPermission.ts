/**
 * MasterPermission — permissões do Painel Master (não roles de empresa).
 */
import type { MasterRole } from './masterAuth.types.js';

export type MasterPermission =
  | 'dashboard:read'
  | 'tenants:read'
  | 'tenants:write'
  | 'tenants:block'
  | 'tenants:impersonate'
  | 'licenses:read'
  | 'licenses:write'
  | 'subscriptions:read'
  | 'subscriptions:write'
  | 'payments:read'
  | 'payments:write'
  | 'deployments:read'
  | 'deployments:write'
  | 'hybrid:read'
  | 'hybrid:write'
  | 'system:read'
  | 'audit:read'
  | 'users:read'
  | 'users:write'
  | 'owners:write'
  | 'admin:read'
  | 'admin:write';

const ALL: MasterPermission[] = [
  'dashboard:read',
  'tenants:read',
  'tenants:write',
  'tenants:block',
  'tenants:impersonate',
  'licenses:read',
  'licenses:write',
  'subscriptions:read',
  'subscriptions:write',
  'payments:read',
  'payments:write',
  'deployments:read',
  'deployments:write',
  'hybrid:read',
  'hybrid:write',
  'system:read',
  'audit:read',
  'users:read',
  'users:write',
  'owners:write',
  'admin:read',
  'admin:write',
];

/**
 * Hierarquia real:
 * OWNER: tudo, inclusive gerir outros Owners.
 * ADMIN: operação completa, mas sem criar/alterar Owners.
 * SUPPORT: leitura técnica e capacidade reservada de entrar como empresa.
 * FINANCE: licenças, cobrança e bloqueios comerciais.
 * AUDITOR: somente leitura e logs.
 */
export const MASTER_ROLE_PERMISSIONS: Record<MasterRole, readonly MasterPermission[]> = {
  MASTER_OWNER: ALL,
  MASTER_ADMIN: [
    'dashboard:read',
    'tenants:read',
    'tenants:write',
    'tenants:block',
    'tenants:impersonate',
    'licenses:read',
    'licenses:write',
    'subscriptions:read',
    'subscriptions:write',
    'payments:read',
    'payments:write',
    'deployments:read',
    'deployments:write',
    'hybrid:read',
    'hybrid:write',
    'system:read',
    'audit:read',
    'users:read',
    'users:write',
    'admin:read',
    'admin:write',
  ],
  MASTER_SUPPORT: [
    'dashboard:read',
    'tenants:read',
    'tenants:impersonate',
    'licenses:read',
    'subscriptions:read',
    'deployments:read',
    'hybrid:read',
    'system:read',
    'audit:read',
  ],
  MASTER_FINANCE: [
    'dashboard:read',
    'tenants:read',
    'tenants:block',
    'licenses:read',
    'licenses:write',
    'subscriptions:read',
    'subscriptions:write',
    'payments:read',
    'payments:write',
    'audit:read',
  ],
  /** Auditoria somente leitura — sem escrita comercial/admin. */
  MASTER_AUDITOR: [
    'dashboard:read',
    'tenants:read',
    'licenses:read',
    'subscriptions:read',
    'payments:read',
    'deployments:read',
    'hybrid:read',
    'system:read',
    'audit:read',
    'users:read',
    'admin:read',
  ],
};

export function permissionsForRole(role: MasterRole): readonly MasterPermission[] {
  return MASTER_ROLE_PERMISSIONS[role] ?? [];
}

export function roleHasPermission(role: MasterRole, permission: MasterPermission): boolean {
  return MASTER_ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}

export function roleHasAnyPermission(
  role: MasterRole,
  permissions: readonly MasterPermission[],
): boolean {
  if (permissions.length === 0) return true;
  return permissions.some((p) => roleHasPermission(role, p));
}
