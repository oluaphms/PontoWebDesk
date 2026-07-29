/**
 * Port — store do TenantManager (sem banco remoto nesta fase).
 */
import type { ManagedTenant } from '../tenantManager.types.js';

export interface TenantManagerStore {
  save(tenant: ManagedTenant): Promise<ManagedTenant>;
  findById(id: string): Promise<ManagedTenant | null>;
  findByDomain(domain: string): Promise<ManagedTenant | null>;
  list(): Promise<ManagedTenant[]>;
  delete(id: string): Promise<boolean>;
}
