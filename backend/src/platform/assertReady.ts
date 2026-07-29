/**
 * Smoke tipado da camada de plataforma (backend).
 * Garante exports e resolução de modo sem I/O de rede.
 */
import {
  ConfigService,
  DeploymentManager,
  DeploymentService,
  FeatureFlagService,
  LicenseService,
} from './index.js';

export function assertPlatformLayerReady(): {
  mode: ReturnType<typeof DeploymentManager.getMode>;
  licensed: boolean;
  multiTenant: boolean;
  identity: ReturnType<typeof DeploymentManager.getIdentity>;
} {
  DeploymentManager.resetCache();
  ConfigService.resetCache();
  DeploymentService.resetCache();
  LicenseService.resetCache();
  const identity = DeploymentManager.getIdentity();
  const mode = identity.mode;
  const licensed = identity.license.licensed;
  const multiTenant = FeatureFlagService.isEnabled('multiTenant');
  if (!licensed) {
    throw new Error('platform_license_unexpected_none');
  }
  return { mode, licensed, multiTenant, identity };
}
