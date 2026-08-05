export type {
  TenantManagerStatus,
  TenantStorageDriver,
  TenantStorageConfig,
  TenantCompanyInfo,
  TenantAdminInfo,
  TenantLicenseInfo,
  ManagedTenant,
  CreateManagedTenantInput,
  UpdateManagedTenantInput,
} from './tenantManager.types.js';

export type { TenantManagerStore } from './ports/TenantManagerStore.js';
export { InMemoryTenantManagerStore } from './adapters/InMemoryTenantManagerStore.js';
export { TenantManager } from './TenantManager.js';
