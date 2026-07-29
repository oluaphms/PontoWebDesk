/**
 * Contratos da camada de implantação (SAAS | LOCAL | HYBRID).
 * Sem alteração de regras de negócio — apenas tipagem/arquitetura.
 */

/** Modos oficiais de implantação do produto. */
export type DeploymentMode = 'SAAS' | 'LOCAL' | 'HYBRID';

/** Ambiente de runtime (build / Node). */
export type AppEnvironment = 'development' | 'production' | 'test';

/** Tier de licença — nesta etapa sem enforcement; default = full. */
export type LicenseTier = 'full' | 'standard' | 'trial' | 'none';

/** Tipo contractual da licença (não confundir com tier/plano). */
export type LicenseType = 'subscription' | 'perpetual' | 'oem' | 'trial' | 'unlicensed';

/** Entitlements estáveis (chaves de produto, não regras de ponto). */
export type LicenseEntitlement =
  | 'multi_tenant'
  | 'rep_agent'
  | 'cloud_sync'
  | 'local_persistence'
  | 'operational_geo'
  | 'admin_console';

/** Módulos de produto cobertos pela licença. */
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

/** Integrações externas habilitadas pela licença. */
export type LicenseIntegration =
  | 'rep_agent'
  | 'control_id'
  | 'supabase'
  | 'webhook'
  | 'sso';

/** Recursos de IA listados na licença (sem cobrança / sem runtime enforcement). */
export type LicenseAiFeature =
  | 'chat'
  | 'insights'
  | 'anomaly_detection'
  | 'forecast';

/** Limites (`null` = ilimitado). */
export type LicenseLimits = {
  maxUsers: number | null;
  maxDevices: number | null;
  maxCompanies: number | null;
};

/** Claims estruturados (LICENSE_PAYLOAD / VITE_LICENSE_PAYLOAD). */
export type LicensePayload = {
  type: LicenseType;
  tier: LicenseTier;
  plan: string;
  issuedAt?: string;
  /** `null` / omitido = sem vencimento. */
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

/** Registro bruto lido pelo repository (sem banco). */
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

/** Licença resolvida (cacheável) — fonte única para o LicenseService. */
export type ResolvedLicense = {
  record: LicenseRecord;
  validation: LicenseValidationResult;
  /** Ativa = licenciada e não vencida (reportável; não corta entitlements nesta fase). */
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

/** Flags conhecidas pela FeatureFlagService (operacionais + de implantação). */
export type PlatformFeatureFlag =
  | 'geoConsensus'
  | 'nativeGps'
  | 'realtimeCoordinator'
  | 'geoForensics'
  | 'operationalIncidents'
  | 'scaleMode'
  | 'cosStrictMode'
  | 'mapStaleBlock'
  | 'geoHealthGuard'
  | 'cloudSync'
  | 'multiTenant'
  | 'repBridge'
  | 'localOnlyMode'
  | 'hybridAgentRequired';

export type FeatureFlagContext = {
  tenantId?: string | null;
  companyId?: string | null;
};

/**
 * Recursos de produto do Feature Matrix (catálogo central).
 * Telas futuras consultam FeatureMatrix → FeatureFlagService + LicenseService.
 * Nesta fase: só estrutura; não esconde UI.
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

/** Snapshot imutável de configuração relevante à implantação. */
export type PlatformConfigSnapshot = {
  appEnv: AppEnvironment;
  deploymentModeExplicit: DeploymentMode | null;
  dataProvider: 'LOCAL_API' | 'SUPABASE';
  apiBaseUrl: string;
  appPublicUrl: string;
  isDev: boolean;
  isProduction: boolean;
  apiHostIsLocal: boolean;
  licenseKeyPresent: boolean;
  licenseTierExplicit: LicenseTier | null;
  /** Variáveis brutas normalizadas (somente chaves de plataforma). */
  raw: Readonly<Record<string, string | undefined>>;
};

export type DeploymentCapabilities = {
  mode: DeploymentMode;
  /** API remota (HTTP) disponível / esperada. */
  useRemoteApi: boolean;
  /** Persistência/operacional local (agente, SQLite, LAN). */
  preferLocalOps: boolean;
  /** Sincronização com nuvem/SaaS. */
  enableCloudSync: boolean;
  /** Multi-tenant SaaS. */
  multiTenant: boolean;
  /** Browser hospedado fora da LAN — bate-ponto REP via agente. */
  requireRepAgentForLanDevices: boolean;
};

/** Data provider (FE). Distinto de DeploymentMode. */
export type DataProviderMode = 'LOCAL_API' | 'SUPABASE';

/** Identidade de sync agregada pelo DeploymentManager. */
export type DeploymentSyncIdentity = {
  enableCloudSync: boolean;
  canUseCloudSync: boolean;
  preferLocalOps: boolean;
};

/** Identidade de licença agregada (sem enforcement novo). */
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

/** Identidade de integrações agregada a partir da licença. */
export type DeploymentIntegrationsIdentity = {
  integrations: LicenseIntegration[];
  aiFeatures: LicenseAiFeature[];
  hasRepAgent: boolean;
  hasControlId: boolean;
  hasSupabase: boolean;
  hasWebhook: boolean;
  hasSso: boolean;
};

/** Snapshot completo — saída canônica do DeploymentManager. */
export type DeploymentIdentity = {
  mode: DeploymentMode;
  environment: AppEnvironment;
  provider: DataProviderMode;
  capabilities: DeploymentCapabilities;
  sync: DeploymentSyncIdentity;
  license: DeploymentLicenseIdentity;
  integrations: DeploymentIntegrationsIdentity;
};
