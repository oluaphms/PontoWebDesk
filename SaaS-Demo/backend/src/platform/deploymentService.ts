/**
 * DeploymentService (backend).
 * Defaults preservam o comportamento atual (dev/local → LOCAL, prod → SAAS).
 */
import { ConfigService } from './configService.js';
import type { DeploymentCapabilities, DeploymentMode } from './types.js';

function deriveMode(): DeploymentMode {
  const cfg = ConfigService.getSnapshot();
  if (cfg.deploymentModeExplicit) return cfg.deploymentModeExplicit;
  if (cfg.isLocalDevProfile || cfg.databaseHostIsLocal) return 'LOCAL';
  if (cfg.isProduction) return 'SAAS';
  return 'LOCAL';
}

function capabilitiesFor(mode: DeploymentMode): DeploymentCapabilities {
  switch (mode) {
    case 'LOCAL':
      return {
        mode,
        useRemoteApi: true,
        preferLocalOps: true,
        enableCloudSync: false,
        multiTenant: true,
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
    if (!cachedCaps) cachedCaps = capabilitiesFor(this.getMode());
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
