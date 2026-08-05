/**
 * PlatformService — alias fino sobre DeploymentManager (compatibilidade).
 *
 * Toda decisão de implantação sai do DeploymentManager.
 * Preferir `DeploymentManager` em código novo; este módulo preserva imports existentes.
 */
export {
  DeploymentManager as PlatformService,
  type PlatformModule,
} from './deploymentManager.js';
