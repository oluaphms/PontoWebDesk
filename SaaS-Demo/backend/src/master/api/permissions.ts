/**
 * Permissões do Painel Master — reexport canônico de auth/MasterPermission.
 */
export type { MasterPermission } from '../auth/MasterPermission.js';
export {
  MASTER_ROLE_PERMISSIONS,
  permissionsForRole,
  roleHasPermission,
  roleHasAnyPermission,
} from '../auth/MasterPermission.js';
