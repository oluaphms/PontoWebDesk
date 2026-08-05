import type { ManagedTenant } from '../tenantManager.types.js';
import type { TenantManagerStore } from '../ports/TenantManagerStore.js';

export class InMemoryTenantManagerStore implements TenantManagerStore {
  private readonly byId = new Map<string, ManagedTenant>();

  async save(tenant: ManagedTenant): Promise<ManagedTenant> {
    const copy = structuredClone(tenant);
    this.byId.set(copy.id, copy);
    return structuredClone(copy);
  }

  async findById(id: string): Promise<ManagedTenant | null> {
    const row = this.byId.get(id);
    return row ? structuredClone(row) : null;
  }

  async findByDomain(domain: string): Promise<ManagedTenant | null> {
    const needle = normalizeDomain(domain);
    for (const row of this.byId.values()) {
      if (normalizeDomain(row.domain) === needle) return structuredClone(row);
    }
    return null;
  }

  async list(): Promise<ManagedTenant[]> {
    return [...this.byId.values()].map((t) => structuredClone(t));
  }

  async delete(id: string): Promise<boolean> {
    return this.byId.delete(id);
  }
}

function normalizeDomain(domain: string): string {
  return String(domain || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/+$/, '');
}

function structuredClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
