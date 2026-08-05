/**
 * Policies contextuais do Painel Master.
 *
 * Permissões de rota resolvem o módulo; estas policies resolvem o recurso/ação
 * para impedir escalada (ex.: ADMIN criando OWNER).
 */
import type { MasterTenantAction } from '../tenants/MasterTenantsService.js';
import type { MasterRole } from './masterAuth.types.js';
import { roleHasPermission } from './MasterPermission.js';

const FINANCE_BLOCK_ACTIONS = new Set<MasterTenantAction>([
  'block',
  'unblock',
  'suspend',
]);

/** OWNER pode gerir qualquer perfil; ADMIN somente perfis não-OWNER. */
export function canManageMasterRole(
  actorRole: MasterRole,
  targetRole: MasterRole,
): boolean {
  if (!roleHasPermission(actorRole, 'users:write')) return false;
  if (targetRole === 'MASTER_OWNER') {
    return roleHasPermission(actorRole, 'owners:write');
  }
  return true;
}

/** Protege tanto o perfil atual quanto o perfil pretendido do usuário. */
export function canManageMasterUser(
  actorRole: MasterRole,
  currentRole: MasterRole,
  nextRole: MasterRole = currentRole,
): boolean {
  return (
    canManageMasterRole(actorRole, currentRole) &&
    canManageMasterRole(actorRole, nextRole)
  );
}

/**
 * Conta Founder: OWNER comum não altera; somente outro Founder (ou o próprio)
 * pode mutar campos permitidos. Mutações destrutivas são bloqueadas no service.
 */
export function canMutateFounderAccount(input: {
  actorIsFounder: boolean;
  actorUserId?: string | null;
  targetIsFounder: boolean;
  targetUserId: string;
}): boolean {
  if (!input.targetIsFounder) return true;
  if (input.actorIsFounder) return true;
  return Boolean(input.actorUserId && input.actorUserId === input.targetUserId);
}

/**
 * Escrita ampla de tenant permite qualquer ação.
 * FINANCE recebe somente bloqueio/suspensão e suas reversões.
 */
export function canExecuteTenantAction(
  actorRole: MasterRole,
  action: MasterTenantAction,
): boolean {
  if (roleHasPermission(actorRole, 'tenants:write')) return true;
  return (
    roleHasPermission(actorRole, 'tenants:block') &&
    FINANCE_BLOCK_ACTIONS.has(action)
  );
}
