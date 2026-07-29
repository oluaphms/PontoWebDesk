import type { TenantDeployment } from '../types.js';
import type { TenantDeploymentStore } from '../ports/TenantDeploymentStore.js';

function clone(row: TenantDeployment): TenantDeployment {
  return {
    ...row,
    cloud: { ...row.cloud },
    server: { ...row.server },
    license: { ...row.license },
    repAgent: { ...row.repAgent },
    realtime: { ...row.realtime },
    synchronization: { ...row.synchronization },
    capabilities: { ...row.capabilities },
    meta: row.meta ? { ...row.meta } : undefined,
  };
}

export class InMemoryTenantDeploymentStore implements TenantDeploymentStore {
  private readonly byId = new Map<string, TenantDeployment>();

  async list(): Promise<TenantDeployment[]> {
    return [...this.byId.values()]
      .map(clone)
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  }

  async get(id: string): Promise<TenantDeployment | null> {
    const row = this.byId.get(id);
    return row ? clone(row) : null;
  }

  async getByTenantId(tenantId: string): Promise<TenantDeployment | null> {
    for (const row of this.byId.values()) {
      if (row.tenantId === tenantId) return clone(row);
    }
    return null;
  }

  async save(row: TenantDeployment): Promise<TenantDeployment> {
    const next = clone(row);
    this.byId.set(row.id, next);
    return clone(next);
  }

  async delete(id: string): Promise<boolean> {
    return this.byId.delete(id);
  }

  async clear(): Promise<void> {
    this.byId.clear();
  }
}
