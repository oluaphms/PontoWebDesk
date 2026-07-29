/**
 * Painel Master — infraestrutura desacoplada (InMemory).
 *
 * Composition root HTTP: services/master/masterPlatformService.ts
 * Store único: master/registry/MasterRepositoryRegistry.ts
 *
 * NÃO altera REP / Espelho / Banco de Horas / Auth Empresa / APIs operacionais.
 */
export type * from './types.js';
export { MasterError, notFound, conflict, invalid } from './errors.js';
export type {
  CustomerRepository,
  TenantRepository,
  SubscriptionRepository,
  BillingRepository,
  LicenseRecordRepository,
  ActivationRepository,
  BlockRepository,
  MasterRepositories,
} from './ports/repositories.js';
export { createInMemoryMasterRepositories } from './adapters/memory/createInMemoryMasterRepositories.js';
export {
  MasterTenantsRepository,
  MasterSubscriptionsRepository,
  MasterLicensesRepository,
  MasterInvoicesRepository,
  MasterPaymentsRepository,
  MasterAuditRepository,
  MasterLogsRepository,
  PgBillingStore,
  resolveMasterPersistenceMode,
  isMasterPostgresPersistence,
  type MasterPersistenceMode,
  type MasterSqlQuery,
} from './adapters/postgres/index.js';
export { createMasterServices, type MasterServices } from './createMasterServices.js';

/** Store único + composition consolidada. */
export {
  MasterRepositoryRegistry,
  getMasterRepositoryRegistry,
  resetMasterRepositoryRegistry,
  createMasterComposition,
  BridgingBillingRepository,
  type MasterComposition,
  type MasterRepositoryRegistrySnapshot,
} from './registry/index.js';

export {
  MasterTenantsService,
  MASTER_TENANT_ACTIONS,
  type MasterTenantAction,
} from './tenants/index.js';


export { CustomerService } from './services/CustomerService.js';
export { MasterTenantService } from './services/MasterTenantService.js';
export { SubscriptionService } from './services/SubscriptionService.js';
export { BillingService } from './services/BillingService.js';
export { DeploymentControlService } from './services/DeploymentControlService.js';
export { LicenseGenerationService } from './services/LicenseGenerationService.js';
export { ActivationService } from './services/ActivationService.js';
export { BlockService } from './services/BlockService.js';
export { UnlockService } from './services/UnlockService.js';

/** Fase 9 — ciclo de vida de planos (paralelo ao SubscriptionService da Fase 8). */
export {
  SubscriptionEntity,
  SubscriptionService as SubscriptionLifecycleService,
  InMemorySubscriptionRepository,
  LICENSE_PLANS,
  SUBSCRIPTION_STATUSES,
  type LicensePlan,
  type SubscriptionStatus as PlanSubscriptionStatus,
  type SubscriptionProps,
  type CreateSubscriptionInput as CreatePlanSubscriptionInput,
  type RenewSubscriptionInput,
  type SubscriptionRepository as PlanSubscriptionRepository,
} from './subscriptions/index.js';

export {
  isTrialOrFreePlan,
  resolveLicenseExpiry,
  buildJourneyLicenseExpiryInput,
  TRIAL_LICENSE_DURATION_DAYS,
  ADMIN_LICENSE_DEFAULT_DURATION_DAYS,
  SubscriptionLicenseSyncService,
  calculateSubscriptionExpiresAt,
  addMonthsUtc,
  addYearsUtc,
} from './subscriptions/index.js';

/** Fase 6.3 — catálogo mensal/anual e vínculo empresa → plano → assinatura. */
export {
  SaasPlansService,
  addPlanCycle,
  SAAS_PLAN_CYCLES,
  SAAS_SUBSCRIPTION_STATUSES,
  type SaasPlan,
  type SaasPlanCycle,
  type SaasSubscriptionStatus,
  type CompanyPlanSubscription,
} from './plans/index.js';

/** Fase 6.4 — financeiro e timeline da assinatura. */
export {
  SubscriptionFinanceService,
  processSubscriptionOverdues,
  processSubscriptionFinanceCycle,
  startSubscriptionFinanceAutomation,
  SUBSCRIPTION_FINANCE_KINDS,
  SUBSCRIPTION_FINANCE_STATUSES,
  type SubscriptionFinanceEntry,
  type SubscriptionFinanceKind,
  type SubscriptionFinanceStatus,
} from './subscriptionFinance/index.js';

/** Fase 6.5 — notificações automáticas da assinatura. */
export {
  SubscriptionNotificationService,
  processDueSubscriptionNotifications,
  releaseCompanyAfterSubscriptionPayment,
  templateForKind,
  SUBSCRIPTION_NOTIFICATION_KINDS,
  SUBSCRIPTION_NOTIFICATION_CHANNELS,
  SUBSCRIPTION_NOTIFICATION_STATUSES,
  type SubscriptionNotification,
  type SubscriptionNotificationKind,
  type SubscriptionNotificationPreferences,
  type UpdateSubscriptionNotificationPreferences,
} from './subscriptionNotifications/index.js';

/** Fase 10 — decisões de feature por assinatura (não altera telas / platform LicenseService). */
export {
  LicenseService as MasterLicenseService,
  featuresForPlan,
  LICENSE_FEATURES,
  type LicenseFeature,
  type LicenseFeatureSnapshot,
  type LicenseServiceContext,
} from './license/index.js';

/** Fase 11 — controle de acesso por status/plano (não altera Auth). */
export {
  AccessControlService,
  type AccessControlContext,
  type AccessLevel,
  type AccessReason,
  type AccessResolution,
} from './access/index.js';

/** Pagamentos — Ports & Adapters (contrato unificado + adapters legado). */
export {
  AsaasProvider,
  StripeProvider,
  PagSeguroProvider,
  createPaymentProvider,
  createUnifiedPaymentProvider,
  DecoupledPaymentProviderCompat,
  WebhookService,
  PAYMENT_WEBHOOK_EVENTS,
  type PaymentProvider,
  type PaymentRecord,
  type CreatePixInput,
  type PaymentProviderName,
  type WebhookResult,
  type PaymentWebhookEventType,
  type PaymentWebhookReceipt,
  type UnifiedPaymentProvider,
} from './payments/index.js';

/** BillingEngine — máquina de estados de cobrança/assinatura (sem banco). */
export {
  BillingEngine,
  BILLING_TRANSITIONS,
  resolveBillingState,
  type BillingState,
  type BillingTransition,
  type BillingCharge,
  type BillingEngineResult,
} from './billing/index.js';

/** Billing Engine desacoplado — ports + adapters mock (Asaas/PagSeguro/Stripe). */
export {
  DecoupledBillingEngine,
  AsaasAdapter,
  PagSeguroAdapter,
  StripeAdapter,
  InMemoryBillingStore,
  MockBillingAdapter,
  type BillingProvider,
  type InvoiceProvider,
  type PaymentProvider as DecoupledPaymentProvider,
  type PixProvider,
  type Invoice,
  type Payment as BillingPayment,
  type PixCharge,
  type Refund,
  type Webhook as BillingWebhook,
  type DecoupledBillingSnapshot,
} from './billingEngine/index.js';

/** Master Dashboard — módulos backend (sem frontend / sem rotas). */
export {
  createMasterDashboard,
  MasterDashboardService,
  MASTER_DASHBOARD_MODULES,
  type MasterDashboardModuleId,
  type MasterDashboardSummary,
  type DashboardLogEntry,
} from './dashboard/index.js';

/** Local License Manager — licença por instalação (offline / sem internet). */
export {
  LocalLicenseManager,
  InMemoryLocalLicenseStore,
  validateOffline,
  deriveMachineId,
  deriveHardwareHash,
  type LocalLicenseRecord,
  type LocalLicenseValidationResult,
  type IssueLocalLicenseInput,
} from './localLicense/index.js';

/** Hybrid Sync — infraestrutura local + cloud (sem alterar módulos existentes). */
export {
  createHybridSync,
  SyncQueue,
  OfflineQueue,
  ConflictResolver,
  LocalSyncService,
  CloudSyncService,
  type HybridSyncServices,
  type SyncItem,
  type SyncResult,
  type ConflictRecord,
  type ConflictStrategy,
} from './hybridSync/index.js';

/** TenantManager — plano/status/modo/gateway/licença/empresa/admin/domínio/storage. */
export {
  TenantManager,
  InMemoryTenantManagerStore,
  type ManagedTenant,
  type CreateManagedTenantInput,
  type TenantManagerStatus,
} from './tenantManager/index.js';

/** Fase 6.1 — modelo de licença: status de tenants/companies. */
export {
  COMPANY_LICENSE_STATUSES,
  COMPANY_PRE_LICENSE_STATUS,
  COMPANY_TENANT_STATUSES,
  COMPANY_BLOCKING_STATUSES,
  normalizeCompanyStatusWire,
  toCompanyStatusCanonical,
  isCompanyStatusBlocking,
  companyStatusLabel,
  type CompanyLicenseStatus,
  type CompanyTenantStatus,
  type CompanyTenantStatusWire,
} from './license/index.js';

/** Auth do Painel Master (separado do login das empresas). */
export {
  MasterAuthService,
  MASTER_ROLES,
  signMasterToken,
  verifyMasterToken,
  MASTER_ROLE_PERMISSIONS,
  permissionsForRole,
  type MasterRole,
  type MasterUser,
  type MasterSession,
  type MasterAuthSession,
  type MasterJWT,
  type MasterPermission,
} from './auth/index.js';

/** License Manager — controle comercial por empresa (InMemory; sem auth operacional). */
export {
  LicenseManagerService,
  InMemoryLicenseManagerStore,
  LICENSE_MODES,
  LICENSE_STATUSES,
  DEFAULT_EXPIRY_WARNING_DAYS,
  defaultRulesForStatus,
  resolveRules,
  type LicenseMode,
  type LicenseStatus,
  type LicenseControlRules,
  type CompanyLicense,
  type LicenseManagerAction,
} from './licenseManager/index.js';

/** Deployment Manager por tenant (InMemory; Platform DeploymentManager intacto). */
export {
  TenantDeploymentManager,
  InMemoryTenantDeploymentStore,
  DEPLOYMENT_MODES,
  DEPLOYMENT_STATUSES,
  defaultsForMode,
  type TenantDeployment,
  type TenantDeploymentMode,
  type TenantDeploymentStatus,
  type TenantDeploymentAction,
} from './deploymentManager/index.js';
