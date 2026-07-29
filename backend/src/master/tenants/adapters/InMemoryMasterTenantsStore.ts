/**
 * Adapter InMemory — empresas Master (sem DB / sem migration).
 * Troca futura: HttpMasterTenantsStore / PostgresMasterTenantsStore.
 */
export { InMemoryTenantManagerStore as InMemoryMasterTenantsStore } from '../../tenantManager/adapters/InMemoryTenantManagerStore.js';
