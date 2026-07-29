/**
 * FeatureFlagService (backend) — flags de implantação / infra via Config + Deployment + License.
 * Não altera defaults: REP_POST_INGEST_ASYNC, VPS_RLS, DATA_API_WRITES etc. seguem env atual.
 */
import { ConfigService } from './configService.js';
import { DeploymentService } from './deploymentService.js';
import { LicenseService } from './licenseService.js';
import type { PlatformFeatureFlag } from './types.js';

export const FeatureFlagService = {
  isEnabled(flag: PlatformFeatureFlag): boolean {
    const cfg = ConfigService.getSnapshot();
    const caps = DeploymentService.getCapabilities();

    switch (flag) {
      case 'cloudSync':
        return caps.enableCloudSync && LicenseService.hasEntitlement('cloud_sync');
      case 'multiTenant':
        return caps.multiTenant && LicenseService.hasEntitlement('multi_tenant');
      case 'repBridge':
        return (
          LicenseService.hasEntitlement('rep_agent') &&
          ConfigService.getBoolean('REP_BRIDGE_LEGACY_ENABLED', !cfg.isProduction)
        );
      case 'localOnlyMode':
        return caps.mode === 'LOCAL';
      case 'hybridAgentRequired':
        return caps.requireRepAgentForLanDevices;
      case 'repPostIngestAsync':
        // Mesmo default do código atual: off, a menos que env=1
        return ConfigService.getBoolean('REP_POST_INGEST_ASYNC', false);
      case 'vpsRlsEnforced':
        return ConfigService.getBoolean('VPS_RLS_ENFORCED', false);
      case 'dataApiWrites': {
        // Compat: em production default off; em dev default on (como dataTablePolicy)
        const defaultOn = !cfg.isProduction;
        return ConfigService.getBoolean('DATA_API_WRITES_ENABLED', defaultOn);
      }
      case 'pipelineDiag':
        return ConfigService.getBoolean('REP_PIPELINE_DIAG', false);
      default:
        return false;
    }
  },
};
