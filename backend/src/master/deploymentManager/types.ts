/**
 * Deployment Manager Master — visão por tenant (InMemory).
 * Não altera Platform DeploymentManager / runtime operacional.
 */

export const DEPLOYMENT_MODES = ['SAAS', 'LOCAL', 'HYBRID'] as const;
export type TenantDeploymentMode = (typeof DEPLOYMENT_MODES)[number];

export const DEPLOYMENT_STATUSES = [
  'healthy',
  'degraded',
  'offline',
  'syncing',
  'unknown',
] as const;
export type TenantDeploymentStatus = (typeof DEPLOYMENT_STATUSES)[number];

export type TenantDeploymentCloud = {
  enabled: boolean;
  region: string | null;
  endpoint: string | null;
};

export type TenantDeploymentServer = {
  host: string | null;
  environment: string | null;
  lastSeenAt: string | null;
};

export type TenantDeploymentLicense = {
  bound: boolean;
  tier: string | null;
  expiresAt: string | null;
};

export type TenantDeploymentRepAgent = {
  enabled: boolean;
  connected: boolean;
  lastHeartbeat: string | null;
  version: string | null;
};

export type TenantDeploymentRealtime = {
  enabled: boolean;
  bridgeActive: boolean;
};

export type TenantDeploymentSync = {
  enabled: boolean;
  pending: number;
  failed: number;
  lastSyncAt: string | null;
};

/**
 * Registro de deployment por tenant — preparado para expansão futura.
 * Campos opcionais em `meta` / `capabilities` para providers futuros.
 */
export type TenantDeployment = {
  id: string;
  tenantId: string;
  empresa: string;
  /** Modo de operação do cliente. */
  mode: TenantDeploymentMode;
  /** Label do deployment atual (ex.: cloud-primary, on-prem-01). */
  currentDeployment: string;
  /** Último sync conhecido. */
  lastSyncAt: string | null;
  status: TenantDeploymentStatus;
  cloud: TenantDeploymentCloud;
  server: TenantDeploymentServer;
  license: TenantDeploymentLicense;
  /** Versão do sistema reportada / pretendida. */
  version: string;
  repAgent: TenantDeploymentRepAgent;
  realtime: TenantDeploymentRealtime;
  synchronization: TenantDeploymentSync;
  createdAt: string;
  updatedAt: string;
  /** Extensível — flags futuras sem breaking change. */
  capabilities: Readonly<Record<string, boolean>>;
  meta?: Readonly<Record<string, unknown>>;
};

export type CreateTenantDeploymentInput = {
  tenantId: string;
  empresa?: string;
  mode?: TenantDeploymentMode;
  currentDeployment?: string;
  version?: string;
  cloud?: Partial<TenantDeploymentCloud>;
  server?: Partial<TenantDeploymentServer>;
  license?: Partial<TenantDeploymentLicense>;
  repAgent?: Partial<TenantDeploymentRepAgent>;
  realtime?: Partial<TenantDeploymentRealtime>;
  synchronization?: Partial<TenantDeploymentSync>;
};

export type UpdateTenantDeploymentInput = {
  empresa?: string;
  mode?: TenantDeploymentMode;
  currentDeployment?: string;
  status?: TenantDeploymentStatus;
  version?: string;
  lastSyncAt?: string | null;
  cloud?: Partial<TenantDeploymentCloud>;
  server?: Partial<TenantDeploymentServer>;
  license?: Partial<TenantDeploymentLicense>;
  repAgent?: Partial<TenantDeploymentRepAgent>;
  realtime?: Partial<TenantDeploymentRealtime>;
  synchronization?: Partial<TenantDeploymentSync>;
};

export type TenantDeploymentAction =
  | 'set_mode_saas'
  | 'set_mode_local'
  | 'set_mode_hybrid'
  | 'mark_healthy'
  | 'mark_degraded'
  | 'mark_offline'
  | 'mark_syncing'
  | 'simulate_sync'
  | 'enable_cloud'
  | 'disable_cloud'
  | 'enable_rep_agent'
  | 'disable_rep_agent'
  | 'enable_realtime'
  | 'disable_realtime'
  | 'enable_sync'
  | 'disable_sync';
