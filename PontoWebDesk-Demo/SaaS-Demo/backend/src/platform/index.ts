/**
 * Camada de implantação do backend (SAAS | LOCAL | HYBRID).
 * Preferir `DeploymentManager` (ou `PlatformService` alias) para decisões.
 * Serviços internos permanecem exportados para compatibilidade.
 */
export type {
  AppEnvironment,
  DataProviderMode,
  DeploymentCapabilities,
  DeploymentIdentity,
  DeploymentIntegrationsIdentity,
  DeploymentLicenseIdentity,
  DeploymentMode,
  DeploymentSyncIdentity,
  FeatureMatrixEntry,
  FeatureMatrixSnapshot,
  LicenseAiFeature,
  LicenseEntitlement,
  LicenseIntegration,
  LicenseLimits,
  LicenseModule,
  LicensePayload,
  LicenseRecord,
  LicenseSource,
  LicenseTier,
  LicenseType,
  LicenseValidationResult,
  LicenseValidationStatus,
  PlatformConfigSnapshot,
  PlatformFeatureFlag,
  ProductFeature,
  ResolvedLicense,
} from './types.js';

export { DeploymentManager } from './deploymentManager.js';
export { PlatformService, type PlatformModule } from './PlatformService.js';
export { ConfigService } from './configService.js';
export { DeploymentService } from './deploymentService.js';
export { LicenseService } from './licenseService.js';
export {
  LicenseCache,
  LicenseRepository,
  LicenseResolver,
  LicenseValidator,
} from './license/index.js';
export { FeatureFlagService } from './featureFlagService.js';
export { FeatureMatrix, FEATURE_MATRIX_CATALOG, PRODUCT_FEATURES } from './featureMatrix/index.js';
