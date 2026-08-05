/**
 * Contratos da camada de implantação (backend) — espelha o frontend.
 */

export type DeploymentMode = 'SAAS' | 'LOCAL' | 'HYBRID';
export type AppEnvironment = 'development' | 'production' | 'test';
export type LicenseTier = 'full' | 'standard' | 'trial' | 'none';

/** Tipo contractual da licença (não confundir com tier/plano). */
export type LicenseType = 'subscription' | 'perpetual' | 'oem' | 'trial' | 'unlicensed';

export type LicenseEntitlement =
  | 'multi_tenant'
  | 'rep_agent'
  | 'cloud_sync'
  | 'local_persistence'
  | 'operational_geo'
  | 'admin_console';

export type LicenseModule =
  | 'admin_console'
  | 'rep'
  | 'cloud_sync'
  | 'operational_geo'
  | 'multi_tenant'
  | 'local_persistence'
  | 'bank_hours'
  | 'timesheet'
  | 'exports'
  | 'ai_assistant'
  | 'ai_insights';

export type LicenseIntegration =
  | 'rep_agent'
  | 'control_id'
  | 'supabase'
  | 'webhook'
  | 'sso';

export type LicenseAiFeature =
  | 'chat'
  | 'insights'
  | 'anomaly_detection'
  | 'forecast';

export type LicenseLimits = {
  maxUsers: number | null;
  maxDevices: number | null;
  maxCompanies: number | null;
};

export type LicensePayload = {
  type: LicenseType;
  tier: LicenseTier;
  plan: string;
  issuedAt?: string;
  expiresAt?: string | null;
  customerId?: string;
  modules: LicenseModule[];
  entitlements: LicenseEntitlement[];
  integrations: LicenseIntegration[];
  aiFeatures: LicenseAiFeature[];
  limits: LicenseLimits;
  meta?: Readonly<Record<string, unknown>>;
};

export type LicenseSource = 'env_payload' | 'env_tier' | 'default_full';

export type LicenseRecord = {
  key: string | null;
  source: LicenseSource;
  payload: LicensePayload;
  rawPayload: string | null;
};

export type LicenseValidationStatus =
  | 'valid'
  | 'expired'
  | 'invalid'
  | 'missing'
  | 'default';

export type LicenseValidationResult = {
  ok: boolean;
  status: LicenseValidationStatus;
  errors: string[];
  expiresAt: string | null;
  isExpired: boolean;
};

export type ResolvedLicense = {
  record: LicenseRecord;
  validation: LicenseValidationResult;
  active: boolean;
  tier: LicenseTier;
  type: LicenseType;
  plan: string;
  modules: LicenseModule[];
  entitlements: LicenseEntitlement[];
  integrations: LicenseIntegration[];
  aiFeatures: LicenseAiFeature[];
  limits: LicenseLimits;
};

export type PlatformFeatureFlag =
  | 'cloudSync'
  | 'multiTenant'
  | 'repBridge'
  | 'localOnlyMode'
  | 'hybridAgentRequired'
  | 'repPostIngestAsync'
  | 'vpsRlsEnforced'
  | 'dataApiWrites'
  | 'pipelineDiag';

/**
 * Recursos de produto do Feature Matrix (catálogo central).
 * Nesta fase: só estrutura; não altera enforcement HTTP/UI.
 */
export type ProductFeature =
  | 'rep'
  | 'cloud_sync'
  | 'offline'
  | 'whatsapp'
  | 'ai'
  | 'payroll'
  | 'multi_company'
  | 'api'
  | 'realtime'
  | 'biometrics'
  | 'reports';

export type FeatureMatrixEntry = {
  id: ProductFeature;
  label: string;
  description: string;
};

export type FeatureMatrixSnapshot = Record<ProductFeature, boolean>;

export type PlatformConfigSnapshot = {
  appEnv: AppEnvironment;
  deploymentModeExplicit: DeploymentMode | null;
  isProduction: boolean;
  isLocalDevProfile: boolean;
  databaseHostIsLocal: boolean;
  licenseKeyPresent: boolean;
  licenseTierExplicit: LicenseTier | null;
  raw: Readonly<Record<string, string | undefined>>;
};

export type DeploymentCapabilities = {
  mode: DeploymentMode;
  useRemoteApi: boolean;
  preferLocalOps: boolean;
  enableCloudSync: boolean;
  multiTenant: boolean;
  requireRepAgentForLanDevices: boolean;
};

/** Backend não usa VITE_DATA_PROVIDER — provider nativo da API. */
export type DataProviderMode = 'native';

export type DeploymentSyncIdentity = {
  enableCloudSync: boolean;
  canUseCloudSync: boolean;
  preferLocalOps: boolean;
};

export type DeploymentLicenseIdentity = {
  type: LicenseType;
  tier: LicenseTier;
  plan: string;
  licensed: boolean;
  active: boolean;
  expired: boolean;
  expiresAt: string | null;
  modules: LicenseModule[];
  entitlements: LicenseEntitlement[];
  limits: LicenseLimits;
};

export type DeploymentIntegrationsIdentity = {
  integrations: LicenseIntegration[];
  aiFeatures: LicenseAiFeature[];
  hasRepAgent: boolean;
  hasControlId: boolean;
  hasSupabase: boolean;
  hasWebhook: boolean;
  hasSso: boolean;
};

export type DeploymentIdentity = {
  mode: DeploymentMode;
  environment: AppEnvironment;
  provider: DataProviderMode;
  capabilities: DeploymentCapabilities;
  sync: DeploymentSyncIdentity;
  license: DeploymentLicenseIdentity;
  integrations: DeploymentIntegrationsIdentity;
};
