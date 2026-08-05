/**
 * Adapters PostgreSQL do Painel Master.
 * InMemory permanece o default (testes). Ative com MASTER_PERSISTENCE=postgres.
 */
export { masterSql, type MasterSqlQuery } from './masterSql.js';
export { MasterTenantsRepository } from './MasterTenantsRepository.js';
export { MasterSubscriptionsRepository } from './MasterSubscriptionsRepository.js';
export { MasterLicensesRepository } from './MasterLicensesRepository.js';
export { MasterInvoicesRepository } from './MasterInvoicesRepository.js';
export { MasterPaymentsRepository } from './MasterPaymentsRepository.js';
export { MasterAuditRepository } from './MasterAuditRepository.js';
export { MasterLogsRepository } from './MasterLogsRepository.js';
export { PgBillingStore, confirmBillingPersist } from './PgBillingStore.js';
export { PgLocalLicenseStore } from './PgLocalLicenseStore.js';
export { PgTenantDeploymentStore } from './PgTenantDeploymentStore.js';
export {
  resolveMasterPersistenceMode,
  isMasterPostgresPersistence,
  type MasterPersistenceMode,
} from './persistenceMode.js';
