/**
 * Compat: reexporta MasterJWT.
 * Preferir import de ./MasterJWT.js
 */
export {
  type MasterJWT,
  type MasterTokenPayload,
  signMasterToken,
  verifyMasterToken,
  decodeMasterJWT,
  getMasterTokenTtl,
  getMasterTokenTtlMs,
  MASTER_AUTH_HEADER,
  MASTER_AUTH_COOKIE,
  MasterJWTModule,
} from './MasterJWT.js';
