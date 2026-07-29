/**
 * DeploymentService — resolve SAAS | LOCAL | HYBRID e capacidades de sync/infra.
 *
 * Preserva comportamento atual:
 * - development / API localhost → LOCAL
 * - production remota → SAAS
 * - HYBRID só com `VITE_DEPLOYMENT_MODE=HYBRID` (explícito), para não mudar fluxos.
 */
import { ConfigService } from './configService';
import type { DeploymentCapabilities, DeploymentMode } from './types';

function deriveMode(): DeploymentMode {
  const cfg = ConfigService.getSnapshot();
  if (cfg.deploymentModeExplicit) return cfg.deploymentModeExplicit;

  // Compat: stack de desenvolvimento / API local = LOCAL
  if (cfg.isDev || cfg.appEnv === 'development' || cfg.apiHostIsLocal) {
    return 'LOCAL';
  }

  // Produção publicada → SAAS (path canônico atual)
  return 'SAAS';
}

function capabilitiesFor(mode: DeploymentMode): DeploymentCapabilities {
  switch (mode) {
    case 'LOCAL':
      return {
        mode,
        useRemoteApi: true, // LOCAL_API local ainda usa HTTP à API Node
        preferLocalOps: true,
        enableCloudSync: false,
        multiTenant: true, // regras de tenant atuais permanecem
        requireRepAgentForLanDevices: false,
      };
    case 'HYBRID':
      return {
        mode,
        useRemoteApi: true,
        preferLocalOps: true,
        enableCloudSync: true,
        multiTenant: true,
        requireRepAgentForLanDevices: true,
      };
    case 'SAAS':
    default:
      return {
        mode: 'SAAS',
        useRemoteApi: true,
        preferLocalOps: false,
        enableCloudSync: true,
        multiTenant: true,
        requireRepAgentForLanDevices: true,
      };
  }
}

let cachedMode: DeploymentMode | null = null;
let cachedCaps: DeploymentCapabilities | null = null;

export const DeploymentService = {
  getMode(): DeploymentMode {
    if (!cachedMode) {
      cachedMode = deriveMode();
      cachedCaps = capabilitiesFor(cachedMode);
    }
    return cachedMode;
  },

  getCapabilities(): DeploymentCapabilities {
    if (!cachedCaps) {
      const mode = this.getMode();
      cachedCaps = capabilitiesFor(mode);
    }
    return cachedCaps;
  },

  isSaas(): boolean {
    return this.getMode() === 'SAAS';
  },

  isLocal(): boolean {
    return this.getMode() === 'LOCAL';
  },

  isHybrid(): boolean {
    return this.getMode() === 'HYBRID';
  },

  /** Decisões de sincronização / infra — passar por aqui em vez de ler env solto. */
  shouldEnableCloudSync(): boolean {
    return this.getCapabilities().enableCloudSync;
  },

  shouldPreferLocalOps(): boolean {
    return this.getCapabilities().preferLocalOps;
  },

  shouldRequireRepAgentForLanDevices(): boolean {
    return this.getCapabilities().requireRepAgentForLanDevices;
  },

  isMultiTenant(): boolean {
    return this.getCapabilities().multiTenant;
  },

  resetCache(): void {
    cachedMode = null;
    cachedCaps = null;
  },
};
