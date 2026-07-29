/**
 * API HTTP do Painel Master — área administrativa global isolada.
 *
 * - JWT próprio (MASTER_JWT_SECRET)
 * - Sem auth das empresas
 * - Sem alterar REP / ponto / espelho / banco de horas
 * - Sem migrations
 */
export { default as masterApiRouter } from './routes/masterApiRouter.js';
export {
  requireMasterLogin,
  requireMasterPermission,
  type MasterApiRequest,
} from './middlewares/index.js';
export { MASTER_ROLE_PERMISSIONS, type MasterPermission } from './permissions.js';
export { MasterApiServices } from './services/index.js';
export { getMasterOpenApiJson } from './openapi/master.openapi.js';
