/**
 * Camada de implantação do frontend (SAAS | LOCAL | HYBRID).
 *
 * Preferir `DeploymentManager` (ou `PlatformService` alias) para decisões.
 * Serviços internos permanecem exportados para compatibilidade.
 * Não leia `import.meta.env` diretamente para novos caminhos de plataforma.
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
  FeatureFlagContext,
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
} from './types';

export { DeploymentManager } from './deploymentManager';
export { PlatformService, type PlatformModule } from './PlatformService';
export { ConfigService } from './configService';
export { DeploymentService } from './deploymentService';
export { LicenseService } from './licenseService';
export {
  LicenseCache,
  LicenseRepository,
  LicenseResolver,
  LicenseValidator,
} from './license';
export {
  FeatureFlagService,
  type OperationalFeatureFlagSet,
  type OperationalFeatureName,
} from './featureFlagService';
export { FeatureMatrix, FEATURE_MATRIX_CATALOG, PRODUCT_FEATURES } from './featureMatrix';
