/**
 * DeploymentManager — ponto único de decisão de implantação (backend).
 *
 * Identifica automaticamente: ambiente, modo (SAAS|LOCAL|HYBRID), provider,
 * sincronização, licença e integrações.
 *
 * Não altera regras de negócio: apenas agrega Config / Deployment / License / Flags.
 * Consumo preferencial; PlatformService delega para cá.
 */
import { ConfigService } from './configService.js';
import { DeploymentService } from './deploymentService.js';
import { FeatureFlagService } from './featureFlagService.js';
import { LicenseService } from './licenseService.js';
import type {
  AppEnvironment,
  DataProviderMode,
  DeploymentCapabilities,
  DeploymentIdentity,
  DeploymentIntegrationsIdentity,
  DeploymentLicenseIdentity,
  DeploymentMode,
  DeploymentSyncIdentity,
  LicenseEntitlement,
  LicenseTier,
  PlatformFeatureFlag,
} from './types.js';

export type PlatformModule =
  | 'admin_console'
  | 'rep'
  | 'cloud_sync'
  | 'operational_geo'
  | 'multi_tenant'
  | 'local_persistence';

const MODULE_ENTITLEMENT: Record<PlatformModule, LicenseEntitlement> = {
  admin_console: 'admin_console',
  rep: 'rep_agent',
  cloud_sync: 'cloud_sync',
  operational_geo: 'operational_geo',
  multi_tenant: 'multi_tenant',
  local_persistence: 'local_persistence',
};

function buildLicenseIdentity(): DeploymentLicenseIdentity {
  return {
    type: LicenseService.getType(),
    tier: LicenseService.getTier(),
    plan: LicenseService.getPlan(),
    licensed: LicenseService.isLicensed(),
    active: LicenseService.isActive(),
    expired: LicenseService.isExpired(),
    expiresAt: LicenseService.getExpiresAt(),
    modules: LicenseService.getModules(),
    entitlements: LicenseService.getEntitlements(),
    limits: LicenseService.getLimits(),
  };
}

function buildIntegrationsIdentity(): DeploymentIntegrationsIdentity {
  const integrations = LicenseService.getIntegrations();
  return {
    integrations,
    aiFeatures: LicenseService.getAiFeatures(),
    hasRepAgent: LicenseService.hasIntegration('rep_agent'),
    hasControlId: LicenseService.hasIntegration('control_id'),
    hasSupabase: LicenseService.hasIntegration('supabase'),
    hasWebhook: LicenseService.hasIntegration('webhook'),
    hasSso: LicenseService.hasIntegration('sso'),
  };
}

function buildSyncIdentity(): DeploymentSyncIdentity {
  const enableCloudSync = DeploymentService.shouldEnableCloudSync();
  return {
    enableCloudSync,
    canUseCloudSync: enableCloudSync && LicenseService.hasEntitlement('cloud_sync'),
    preferLocalOps: DeploymentService.shouldPreferLocalOps(),
  };
}

let cachedIdentity: DeploymentIdentity | null = null;

export const DeploymentManager = {
  getIdentity(): DeploymentIdentity {
    if (cachedIdentity) return cachedIdentity;
    cachedIdentity = {
      mode: DeploymentService.getMode(),
      environment: ConfigService.getAppEnvironment(),
      provider: 'native',
      capabilities: DeploymentService.getCapabilities(),
      sync: buildSyncIdentity(),
      license: buildLicenseIdentity(),
      integrations: buildIntegrationsIdentity(),
    };
    return cachedIdentity;
  },

  getEnvironment(): AppEnvironment {
    return this.getIdentity().environment;
  },

  getMode(): DeploymentMode {
    return this.getIdentity().mode;
  },

  getDeploymentMode(): DeploymentMode {
    return this.getMode();
  },

  getDataProvider(): DataProviderMode {
    return this.getIdentity().provider;
  },

  getSync(): DeploymentSyncIdentity {
    return { ...this.getIdentity().sync };
  },

  getLicense(): DeploymentLicenseIdentity {
    const lic = this.getIdentity().license;
    return {
      ...lic,
      modules: [...lic.modules],
      entitlements: [...lic.entitlements],
      limits: { ...lic.limits },
    };
  },

  getIntegrations(): DeploymentIntegrationsIdentity {
    const integ = this.getIdentity().integrations;
    return {
      ...integ,
      integrations: [...integ.integrations],
      aiFeatures: [...integ.aiFeatures],
    };
  },

  isCloud(): boolean {
    return this.getMode() === 'SAAS';
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

  getCapabilities(): DeploymentCapabilities {
    return this.getIdentity().capabilities;
  },

  canUseRep(): boolean {
    return LicenseService.hasEntitlement('rep_agent');
  },

  canUseRealtime(): boolean {
    return FeatureFlagService.isEnabled('repBridge') || LicenseService.hasEntitlement('rep_agent');
  },

  canUseCloudSync(): boolean {
    return this.getSync().canUseCloudSync;
  },

  canUseFeature(feature: PlatformFeatureFlag): boolean {
    return FeatureFlagService.isEnabled(feature);
  },

  isLicenseValid(): boolean {
    return LicenseService.isLicensed();
  },

  isLicenseActive(): boolean {
    return LicenseService.isActive();
  },

  isLicenseExpired(): boolean {
    return LicenseService.isExpired();
  },

  getLicenseType(): ReturnType<typeof LicenseService.getType> {
    return LicenseService.getType();
  },

  getLicensePlanName(): string {
    return LicenseService.getPlan();
  },

  getLicenseLimits(): ReturnType<typeof LicenseService.getLimits> {
    return LicenseService.getLimits();
  },

  shouldShowBilling(): boolean {
    return false;
  },

  canUseModule(module: PlatformModule): boolean {
    const entitlement = MODULE_ENTITLEMENT[module];
    return entitlement ? LicenseService.hasEntitlement(entitlement) : false;
  },

  getCurrentPlan(): LicenseTier {
    return LicenseService.getTier();
  },

  getCurrentTier(): LicenseTier {
    return LicenseService.getTier();
  },

  getConfigString(key: string, fallback = ''): string {
    return ConfigService.getString(key, fallback);
  },

  getConfigBoolean(key: string, defaultValue: boolean): boolean {
    return ConfigService.getBoolean(key, defaultValue);
  },

  getRepBridgeToken(): string {
    return (
      this.getConfigString('REP_BRIDGE_TOKEN', '') ||
      this.getConfigString('REP_AGENT_TOKEN', '') ||
      this.getConfigString('API_KEY', '') ||
      this.getConfigString('REP_API_KEY', '')
    ).trim();
  },

  isRepBridgeLegacyEnabled(): boolean {
    const raw = this.getConfigString('REP_BRIDGE_LEGACY_ENABLED', '').trim().toLowerCase();
    if (raw === 'false' || raw === '0') return false;
    if (raw === 'true' || raw === '1') return true;
    return Boolean(this.getRepBridgeToken());
  },

  isRepPostIngestAsync(): boolean {
    return FeatureFlagService.isEnabled('repPostIngestAsync');
  },

  isRepPipelineDiagEnabled(): boolean {
    return (
      FeatureFlagService.isEnabled('pipelineDiag') || this.getEnvironment() === 'development'
    );
  },

  shouldRequireRepAgentForLanDevices(): boolean {
    return DeploymentService.shouldRequireRepAgentForLanDevices();
  },

  resetCache(): void {
    cachedIdentity = null;
    DeploymentService.resetCache();
    LicenseService.resetCache();
    ConfigService.resetCache();
  },
};
