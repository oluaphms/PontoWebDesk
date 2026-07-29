import type { TenantDeployment } from '../types.js';

export interface TenantDeploymentStore {
  list(): Promise<TenantDeployment[]>;
  get(id: string): Promise<TenantDeployment | null>;
  getByTenantId(tenantId: string): Promise<TenantDeployment | null>;
  save(row: TenantDeployment): Promise<TenantDeployment>;
  delete(id: string): Promise<boolean>;
  clear(): Promise<void>;
}
