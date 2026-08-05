/**
 * TenantDeploymentManager — controle Master de como cada cliente opera.
 *
 * InMemory. Preparado para expansão (adapters futuros).
 * NÃO altera Platform DeploymentManager nem runtime operacional.
 */
import { randomUUID } from 'node:crypto';
import { conflict, invalid, notFound } from '../errors.js';
import { InMemoryTenantDeploymentStore } from './adapters/InMemoryTenantDeploymentStore.js';
import type { TenantDeploymentStore } from './ports/TenantDeploymentStore.js';
import {
  DEPLOYMENT_MODES,
  DEPLOYMENT_STATUSES,
  type CreateTenantDeploymentInput,
  type TenantDeployment,
  type TenantDeploymentAction,
  type TenantDeploymentMode,
  type TenantDeploymentStatus,
  type UpdateTenantDeploymentInput,
} from './types.js';

function nowIso(): string {
  return new Date().toISOString();
}

function assertMode(mode: string): asserts mode is TenantDeploymentMode {
  if (!(DEPLOYMENT_MODES as readonly string[]).includes(mode)) {
    throw invalid(`mode must be one of: ${DEPLOYMENT_MODES.join(', ')}`);
  }
}

function assertStatus(status: string): asserts status is TenantDeploymentStatus {
  if (!(DEPLOYMENT_STATUSES as readonly string[]).includes(status)) {
    throw invalid(`status must be one of: ${DEPLOYMENT_STATUSES.join(', ')}`);
  }
}

/** Defaults por modo — arquitetura preparada para providers futuros. */
export function defaultsForMode(mode: TenantDeploymentMode): {
  currentDeployment: string;
  cloud: TenantDeployment['cloud'];
  server: TenantDeployment['server'];
  repAgent: TenantDeployment['repAgent'];
  realtime: TenantDeployment['realtime'];
  synchronization: TenantDeployment['synchronization'];
  capabilities: Record<string, boolean>;
} {
  if (mode === 'SAAS') {
    return {
      currentDeployment: 'cloud-primary',
      cloud: { enabled: true, region: 'sa-east-1', endpoint: 'https://api.pontowebdesk.cloud' },
      server: { host: null, environment: 'cloud', lastSeenAt: nowIso() },
      repAgent: { enabled: true, connected: true, lastHeartbeat: nowIso(), version: '1.0.0-mock' },
      realtime: { enabled: true, bridgeActive: true },
      synchronization: { enabled: true, pending: 0, failed: 0, lastSyncAt: nowIso() },
      capabilities: {
        useRemoteApi: true,
        preferLocalOps: false,
        enableCloudSync: true,
        multiTenant: true,
        requireRepAgentForLanDevices: false,
      },
    };
  }
  if (mode === 'LOCAL') {
    return {
      currentDeployment: 'on-prem-local',
      cloud: { enabled: false, region: null, endpoint: null },
      server: { host: '127.0.0.1', environment: 'local', lastSeenAt: nowIso() },
      repAgent: {
        enabled: true,
        connected: true,
        lastHeartbeat: nowIso(),
        version: '1.0.0-local',
      },
      realtime: { enabled: false, bridgeActive: false },
      synchronization: { enabled: false, pending: 0, failed: 0, lastSyncAt: null },
      capabilities: {
        useRemoteApi: false,
        preferLocalOps: true,
        enableCloudSync: false,
        multiTenant: false,
        requireRepAgentForLanDevices: true,
      },
    };
  }
  // HYBRID
  return {
    currentDeployment: 'hybrid-bridge',
    cloud: { enabled: true, region: 'sa-east-1', endpoint: 'https://api.pontowebdesk.cloud' },
    server: { host: 'local-gateway', environment: 'hybrid', lastSeenAt: nowIso() },
    repAgent: {
      enabled: true,
      connected: true,
      lastHeartbeat: nowIso(),
      version: '1.0.0-hybrid',
    },
    realtime: { enabled: true, bridgeActive: true },
    synchronization: { enabled: true, pending: 2, failed: 0, lastSyncAt: nowIso() },
    capabilities: {
      useRemoteApi: true,
      preferLocalOps: true,
      enableCloudSync: true,
      multiTenant: true,
      requireRepAgentForLanDevices: true,
    },
  };
}

export class TenantDeploymentManager {
  private readonly store: TenantDeploymentStore;
  private seeded = false;

  constructor(store?: TenantDeploymentStore) {
    this.store = store ?? new InMemoryTenantDeploymentStore();
  }

  static createInMemory(): TenantDeploymentManager {
    return new TenantDeploymentManager(new InMemoryTenantDeploymentStore());
  }

  async ensureSeed(options: { force?: boolean } = {}): Promise<void> {
    if (this.seeded) return;
    const allow =
      options.force === true ||
      String(process.env.MASTER_DEPLOYMENT_DEMO_SEED || '').toLowerCase() === 'true';
    if (!allow) {
      this.seeded = true;
      return;
    }
    const existing = await this.store.list();
    if (existing.length > 0) {
      this.seeded = true;
      return;
    }
    const demos: CreateTenantDeploymentInput[] = [
      {
        tenantId: 'tn_saas_demo',
        empresa: 'Demo SAAS Cloud',
        mode: 'SAAS',
        version: '2.4.1',
        license: { bound: true, tier: 'PRO', expiresAt: new Date(Date.now() + 90 * 86400000).toISOString() },
      },
      {
        tenantId: 'tn_local_demo',
        empresa: 'Demo LOCAL On-Prem',
        mode: 'LOCAL',
        version: '2.3.0',
        license: { bound: true, tier: 'LOCAL', expiresAt: new Date(Date.now() + 14 * 86400000).toISOString() },
      },
      {
        tenantId: 'tn_hybrid_demo',
        empresa: 'Demo HYBRID Bridge',
        mode: 'HYBRID',
        version: '2.4.0',
        license: { bound: true, tier: 'HYBRID', expiresAt: new Date(Date.now() + 10 * 86400000).toISOString() },
      },
      {
        tenantId: 'tn_offline_demo',
        empresa: 'Demo Offline',
        mode: 'LOCAL',
        version: '2.1.0',
        license: { bound: false, tier: null, expiresAt: null },
      },
    ];
    for (const d of demos) {
      const row = await this.create(d);
      if (d.tenantId === 'tn_offline_demo') {
        await this.action(row.id, 'mark_offline');
        await this.update(row.id, {
          repAgent: { connected: false, lastHeartbeat: null },
          lastSyncAt: null,
        });
      }
    }
    this.seeded = true;
  }

  async list(): Promise<TenantDeployment[]> {
    return this.store.list();
  }

  async get(id: string): Promise<TenantDeployment> {
    const row = await this.store.get(id);
    if (!row) throw notFound('tenant_deployment', id);
    return row;
  }

  async getByTenantId(tenantId: string): Promise<TenantDeployment | null> {
    return this.store.getByTenantId(tenantId);
  }

  async create(input: CreateTenantDeploymentInput): Promise<TenantDeployment> {
    const tenantId = String(input.tenantId || '').trim();
    if (!tenantId) throw invalid('tenantId is required');

    const existing = await this.store.getByTenantId(tenantId);
    if (existing) throw conflict(`deployment already exists for tenant: ${tenantId}`);

    const mode = input.mode ?? 'SAAS';
    assertMode(mode);
    const defaults = defaultsForMode(mode);
    const now = nowIso();

    const row: TenantDeployment = {
      id: `dep_${randomUUID().replace(/-/g, '').slice(0, 12)}`,
      tenantId,
      empresa: String(input.empresa || tenantId).trim() || tenantId,
      mode,
      currentDeployment: input.currentDeployment || defaults.currentDeployment,
      lastSyncAt: defaults.synchronization.lastSyncAt,
      status: 'healthy',
      cloud: { ...defaults.cloud, ...input.cloud },
      server: { ...defaults.server, ...input.server },
      license: {
        bound: true,
        tier: 'BASIC',
        expiresAt: null,
        ...input.license,
      },
      version: input.version || '2.0.0-mock',
      repAgent: { ...defaults.repAgent, ...input.repAgent },
      realtime: { ...defaults.realtime, ...input.realtime },
      synchronization: { ...defaults.synchronization, ...input.synchronization },
      capabilities: defaults.capabilities,
      createdAt: now,
      updatedAt: now,
      meta: {
        simulated: true,
        platformRuntimeWired: false,
        source: 'master_tenant_deployment_manager',
      },
    };
    return this.store.save(row);
  }

  async update(id: string, input: UpdateTenantDeploymentInput): Promise<TenantDeployment> {
    const current = await this.get(id);
    if (input.mode) assertMode(input.mode);
    if (input.status) assertStatus(input.status);

    const modeChanged = input.mode && input.mode !== current.mode;
    const defaults = modeChanged ? defaultsForMode(input.mode!) : null;

    const next: TenantDeployment = {
      ...current,
      empresa: input.empresa?.trim() || current.empresa,
      mode: input.mode ?? current.mode,
      currentDeployment:
        input.currentDeployment ||
        (defaults ? defaults.currentDeployment : current.currentDeployment),
      status: input.status ?? current.status,
      version: input.version?.trim() || current.version,
      lastSyncAt: input.lastSyncAt !== undefined ? input.lastSyncAt : current.lastSyncAt,
      cloud: {
        ...(defaults ? defaults.cloud : current.cloud),
        ...input.cloud,
      },
      server: {
        ...(defaults ? defaults.server : current.server),
        ...input.server,
      },
      license: { ...current.license, ...input.license },
      repAgent: {
        ...(defaults ? defaults.repAgent : current.repAgent),
        ...input.repAgent,
      },
      realtime: {
        ...(defaults ? defaults.realtime : current.realtime),
        ...input.realtime,
      },
      synchronization: {
        ...(defaults ? defaults.synchronization : current.synchronization),
        ...input.synchronization,
      },
      capabilities: defaults ? defaults.capabilities : current.capabilities,
      updatedAt: nowIso(),
    };

    if (modeChanged && input.lastSyncAt === undefined) {
      next.lastSyncAt = next.synchronization.lastSyncAt;
    }

    return this.store.save(next);
  }

  async action(id: string, action: TenantDeploymentAction): Promise<TenantDeployment> {
    const current = await this.get(id);
    const now = nowIso();

    switch (action) {
      case 'set_mode_saas':
        return this.update(id, { mode: 'SAAS', status: 'healthy' });
      case 'set_mode_local':
        return this.update(id, { mode: 'LOCAL', status: 'healthy' });
      case 'set_mode_hybrid':
        return this.update(id, { mode: 'HYBRID', status: 'syncing' });
      case 'mark_healthy':
        return this.update(id, { status: 'healthy' });
      case 'mark_degraded':
        return this.update(id, { status: 'degraded' });
      case 'mark_offline':
        return this.update(id, { status: 'offline' });
      case 'mark_syncing':
        return this.update(id, { status: 'syncing' });
      case 'simulate_sync':
        return this.update(id, {
          status: 'healthy',
          lastSyncAt: now,
          synchronization: {
            ...current.synchronization,
            lastSyncAt: now,
            pending: 0,
            failed: 0,
            enabled: true,
          },
          server: { ...current.server, lastSeenAt: now },
          repAgent: {
            ...current.repAgent,
            connected: current.repAgent.enabled,
            lastHeartbeat: current.repAgent.enabled ? now : current.repAgent.lastHeartbeat,
          },
        });
      case 'enable_cloud':
        return this.update(id, {
          cloud: { ...current.cloud, enabled: true, region: current.cloud.region || 'sa-east-1' },
        });
      case 'disable_cloud':
        return this.update(id, { cloud: { ...current.cloud, enabled: false } });
      case 'enable_rep_agent':
        return this.update(id, {
          repAgent: {
            ...current.repAgent,
            enabled: true,
            connected: true,
            lastHeartbeat: now,
          },
        });
      case 'disable_rep_agent':
        return this.update(id, {
          repAgent: { ...current.repAgent, enabled: false, connected: false },
        });
      case 'enable_realtime':
        return this.update(id, {
          realtime: { enabled: true, bridgeActive: true },
        });
      case 'disable_realtime':
        return this.update(id, {
          realtime: { enabled: false, bridgeActive: false },
        });
      case 'enable_sync':
        return this.update(id, {
          synchronization: { ...current.synchronization, enabled: true },
        });
      case 'disable_sync':
        return this.update(id, {
          synchronization: { ...current.synchronization, enabled: false },
        });
      default:
        throw invalid(`unknown action: ${String(action)}`);
    }
  }

  async snapshot() {
    const rows = await this.list();
    const byMode = { SAAS: 0, LOCAL: 0, HYBRID: 0 };
    const byStatus = {
      healthy: 0,
      degraded: 0,
      offline: 0,
      syncing: 0,
      unknown: 0,
    };
    for (const r of rows) {
      byMode[r.mode] += 1;
      byStatus[r.status] += 1;
    }
    return {
      ok: true,
      count: rows.length,
      byMode,
      byStatus,
      persistence: 'in_memory' as const,
      platformRuntimeWired: false as const,
      note: 'TenantDeploymentManager — Master only; Platform DeploymentManager intacto',
    };
  }
}
