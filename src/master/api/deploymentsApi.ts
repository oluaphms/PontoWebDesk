/**
 * API frontend — Deployment Manager Master (por tenant, InMemory).
 */
import { masterApi } from './masterApi';

export type TenantDeploymentMode = 'SAAS' | 'LOCAL' | 'HYBRID';
export type TenantDeploymentStatus =
  | 'healthy'
  | 'degraded'
  | 'offline'
  | 'syncing'
  | 'unknown';

export type TenantDeployment = {
  id: string;
  tenantId: string;
  empresa: string;
  mode: TenantDeploymentMode;
  currentDeployment: string;
  lastSyncAt: string | null;
  status: TenantDeploymentStatus;
  cloud: {
    enabled: boolean;
    region: string | null;
    endpoint: string | null;
  };
  server: {
    host: string | null;
    environment: string | null;
    lastSeenAt: string | null;
  };
  license: {
    bound: boolean;
    tier: string | null;
    expiresAt: string | null;
  };
  version: string;
  repAgent: {
    enabled: boolean;
    connected: boolean;
    lastHeartbeat: string | null;
    version: string | null;
  };
  realtime: {
    enabled: boolean;
    bridgeActive: boolean;
  };
  synchronization: {
    enabled: boolean;
    pending: number;
    failed: number;
    lastSyncAt: string | null;
  };
  capabilities: Record<string, boolean>;
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

export type PlatformDeploymentIdentity = {
  mode?: string;
  environment?: string;
  provider?: string;
};

export async function fetchTenantDeployments(): Promise<{
  tenants: TenantDeployment[];
  platform: PlatformDeploymentIdentity;
}> {
  const res = await masterApi<{
    ok: boolean;
    tenants?: TenantDeployment[];
    deployments?: TenantDeployment[];
    deployment?: PlatformDeploymentIdentity;
    mode?: string;
    environment?: string;
    provider?: string;
  }>('/deployments');
  return {
    tenants: res.tenants ?? res.deployments ?? [],
    platform: {
      mode: res.deployment?.mode ?? res.mode,
      environment: res.deployment?.environment ?? res.environment,
      provider: res.deployment?.provider ?? res.provider,
    },
  };
}

export async function createTenantDeployment(input: {
  tenantId: string;
  empresa?: string;
  mode?: TenantDeploymentMode;
  version?: string;
}): Promise<TenantDeployment> {
  const res = await masterApi<{ ok: boolean; deployment: TenantDeployment }>('/deployments', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return res.deployment;
}

export async function runDeploymentAction(
  id: string,
  action: TenantDeploymentAction,
): Promise<TenantDeployment> {
  const res = await masterApi<{ ok: boolean; deployment: TenantDeployment }>(
    `/deployments/${encodeURIComponent(id)}/actions/${action}`,
    { method: 'POST', body: '{}' },
  );
  return res.deployment;
}

export function formatDeployDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(t));
}
