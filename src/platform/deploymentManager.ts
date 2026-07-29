/**
 * DeploymentManager — ponto único de decisão de implantação (frontend).
 *
 * Identifica automaticamente: ambiente, modo (SAAS|LOCAL|HYBRID), provider,
 * sincronização, licença e integrações.
 *
 * Não altera regras de negócio: apenas agrega Config / Deployment / License / Flags.
 * Consumo preferencial; PlatformService delega para cá.
 */
import { ConfigService } from './configService';
import { DeploymentService } from './deploymentService';
import { FeatureFlagService } from './featureFlagService';
import { LicenseService } from './licenseService';
import type {
  AppEnvironment,
  DataProviderMode,
  DeploymentCapabilities,
  DeploymentIdentity,
  DeploymentIntegrationsIdentity,
  DeploymentLicenseIdentity,
  DeploymentMode,
  DeploymentSyncIdentity,
  FeatureFlagContext,
  LicenseEntitlement,
  LicenseTier,
  PlatformFeatureFlag,
} from './types';

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
  /** Snapshot completo (cacheado) — saída canônica. */
  getIdentity(): DeploymentIdentity {
    if (cachedIdentity) return cachedIdentity;
    cachedIdentity = {
      mode: DeploymentService.getMode(),
      environment: ConfigService.getAppEnvironment(),
      provider: ConfigService.getDataProvider(),
      capabilities: DeploymentService.getCapabilities(),
      sync: buildSyncIdentity(),
      license: buildLicenseIdentity(),
      integrations: buildIntegrationsIdentity(),
    };
    return cachedIdentity;
  },

  /** identify ambiente (runtime). */
  getEnvironment(): AppEnvironment {
    return this.getIdentity().environment;
  },

  /** identify modo SAAS | LOCAL | HYBRID. */
  getMode(): DeploymentMode {
    return this.getIdentity().mode;
  },

  getDeploymentMode(): DeploymentMode {
    return this.getMode();
  },

  /** identify provider de dados (LOCAL_API | SUPABASE). */
  getDataProvider(): DataProviderMode {
    return this.getIdentity().provider;
  },

  /** identify sincronização. */
  getSync(): DeploymentSyncIdentity {
    return { ...this.getIdentity().sync };
  },

  /** identify licença. */
  getLicense(): DeploymentLicenseIdentity {
    const lic = this.getIdentity().license;
    return {
      ...lic,
      modules: [...lic.modules],
      entitlements: [...lic.entitlements],
      limits: { ...lic.limits },
    };
  },

  /** identify integrações. */
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
    return FeatureFlagService.isEnabled('realtimeCoordinator');
  },

  canUseCloudSync(): boolean {
    return this.getSync().canUseCloudSync;
  },

  canUseFeature(feature: PlatformFeatureFlag, context?: FeatureFlagContext): boolean {
    return FeatureFlagService.isEnabled(feature, context);
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

  isLocalApiProvider(): boolean {
    return this.getDataProvider() === 'LOCAL_API';
  },

  isSupabaseProvider(): boolean {
    return this.getDataProvider() === 'SUPABASE';
  },

  getApiBaseUrl(): string {
    return ConfigService.getApiBaseUrl();
  },

  getRawApiUrl(): string {
    return ConfigService.getRawApiUrl();
  },

  getRawDataProviderEnv(): string {
    return ConfigService.getRawDataProviderEnv();
  },

  isApiConfigured(): boolean {
    return ConfigService.isApiConfigured();
  },

  getSupabaseUrl(): string {
    return ConfigService.getSupabaseUrl();
  },

  getSupabaseAnonKey(): string {
    return ConfigService.getSupabaseAnonKey();
  },

  isSupabaseCloudEnvConfigured(): boolean {
    return ConfigService.isSupabaseCloudEnvConfigured();
  },

  isDataLayerConfigured(): boolean {
    return ConfigService.isDataLayerConfigured();
  },

  getConfigString(key: string, fallback = ''): string {
    return ConfigService.getString(key, fallback);
  },

  getConfigBoolean(key: string, defaultValue: boolean): boolean {
    return ConfigService.getBoolean(key, defaultValue);
  },

  getLocalRealtimePollMs(defaultMs = 12_000): number {
    const raw = this.getConfigString('VITE_LOCAL_REALTIME_POLL_MS', '');
    const parsed = Number.parseInt(String(raw).trim(), 10);
    return Number.isFinite(parsed) && parsed >= 3_000 ? Math.min(parsed, 120_000) : defaultMs;
  },

  isRepWebPunchQueueEnabled(): boolean {
    return this.canUseRep() && this.getConfigString('VITE_REP_WEB_PUNCH_QUEUE', '') !== '0';
  },

  isCloudDeployedClient(): boolean {
    if (typeof window === 'undefined') return true;
    const host = window.location.hostname.toLowerCase();
    return host !== 'localhost' && host !== '127.0.0.1' && !host.endsWith('.local');
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
