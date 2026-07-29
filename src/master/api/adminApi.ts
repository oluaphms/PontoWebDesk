import { masterApi } from './masterApi';

export type MasterAdminResponse = {
  ok: boolean;
  prompt: string;
  sections: string[];
  overview: {
    deploy: string;
    licencas: {
      licensed: boolean;
      tier: string;
      plan: string;
      expired: boolean;
    };
    gateway: string;
    featureFlagsEnabled: number;
    logs: number;
    sync: {
      enableCloudSync: boolean;
      canUseCloudSync: boolean;
      preferLocalOps: boolean;
    };
    storage: string;
    monitoramento: string;
    sistema: string;
  };
  deployment: Record<string, unknown>;
  license: Record<string, unknown>;
  gateway: {
    providers: Array<{
      name: string;
      implemented: boolean;
      active: boolean;
      capabilities: string[];
    }>;
    active: { name: string; implemented: boolean; active: boolean } | null;
    integrated: boolean;
    note: string;
  };
  featureFlags: Array<{ flag: string; enabled: boolean }>;
  featureMatrix: Record<string, boolean>;
  storage: Record<string, unknown>;
  sync: {
    identity: Record<string, unknown>;
    queue: unknown[];
    offline: unknown[];
    conflicts: unknown[];
    counts: { sync: number; offline: number; conflicts: number };
  };
  logs: Array<{
    id: string;
    module: string;
    level: string;
    action: string;
    message: string;
    at: string;
  }>;
  health: {
    ok: boolean;
    platformReady: boolean;
    licensed: boolean;
    mode: string;
    environment: string;
    chargingEnabled: boolean;
    gatewayActive: string | null;
    syncPending: number;
    offlinePending: number;
    unresolvedConflicts: number;
    checkedAt: string;
  };
  monitoring: Record<string, unknown>;
  settings: {
    config: Record<string, unknown>;
    auth: unknown;
    persistence: string;
    chargingEnabled: boolean;
  };
  note?: string;
};

export async function fetchMasterAdmin(): Promise<MasterAdminResponse> {
  return masterApi<MasterAdminResponse>('/admin');
}

export function formatAdminDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(t));
}
