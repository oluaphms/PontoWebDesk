export type {
  MasterRole,
  MasterUser,
  MasterSession,
  MasterAuthSession,
  MasterAuthContext,
  CreateMasterUserInput,
  MasterLoginInput,
  MasterRefreshInput,
  MasterLogoutInput,
  MasterAuthAuditAction,
} from './masterAuth.types.js';
export { MASTER_ROLES } from './masterAuth.types.js';
export type { MasterUserStore } from './ports/MasterUserStore.js';
export type {
  MasterSessionStore,
  MasterSessionRecord,
  CreateMasterSessionInput,
} from './ports/MasterSessionStore.js';
export { InMemoryMasterUserStore } from './adapters/InMemoryMasterUserStore.js';
export { InMemoryMasterSessionStore } from './adapters/InMemoryMasterSessionStore.js';
export { MasterAuthService, roleAtLeast } from './MasterAuthService.js';
export type { MasterAuthServiceOptions } from './MasterAuthService.js';
export type { MasterJWT, MasterTokenPayload } from './MasterJWT.js';
export {
  signMasterToken,
  verifyMasterToken,
  decodeMasterJWT,
  newMasterJti,
  MASTER_AUTH_COOKIE,
  MASTER_REFRESH_COOKIE,
  MASTER_AUTH_HEADER,
  getMasterTokenTtl,
  getMasterTokenTtlMs,
  MasterJWTModule,
} from './MasterJWT.js';
export {
  getMasterAccessTtl,
  getMasterAccessTtlMs,
  getMasterRefreshTtl,
  getMasterRefreshTtlMs,
  getMasterMaxSessions,
} from './masterSessionConfig.js';
export {
  setMasterSessionCookie,
  setMasterRefreshCookie,
  clearMasterSessionCookie,
  clearMasterRefreshCookie,
  MASTER_COOKIE_PATH,
} from './masterSessionCookies.js';
export type { MasterPermission } from './MasterPermission.js';
export {
  MASTER_ROLE_PERMISSIONS,
  permissionsForRole,
  roleHasPermission,
  roleHasAnyPermission,
} from './MasterPermission.js';
export {
  canManageMasterRole,
  canManageMasterUser,
  canExecuteTenantAction,
  canMutateFounderAccount,
} from './MasterAuthorizationPolicy.js';
export {
  assertFounderMutationAllowed,
  bootstrapSlotIsFounder,
  configuredFounderUserIds,
  MasterFounderProtectedError,
  FOUNDER_DENIAL_ACTIONS,
} from './founderProtection.js';
export type { FounderDenialAction } from './founderProtection.js';
