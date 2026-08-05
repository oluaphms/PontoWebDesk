/**
 * Compat: reexporta requireMasterAuth / requireMasterRole do Painel Master.
 * Implementação real em masterAuth.ts (não usa JWT das empresas).
 *
 * @deprecated Prefira importar de `./masterAuth.js`.
 */
export {
  requireMasterAuth,
  requireMasterRole,
  hasValidMasterApiKey,
  type MasterRequest,
} from './masterAuth.js';

/** @deprecated Use requireMasterAuth(). Mantido para imports antigos da Fase 19. */
export { requireMasterAuth as masterAuthGate } from './masterAuth.js';
