/**
 * Camada de assinaturas Master — desacoplada, sem gateway, sem banco.
 */
export type {
  LicensePlan,
  SubscriptionStatus,
  SubscriptionPeriodicity,
  SubscriptionSituacao,
  SubscriptionId,
  SubscriptionTenantId,
  SubscriptionCustomerId,
  SubscriptionProps,
  CreateSubscriptionInput,
  RenewSubscriptionInput,
} from './subscription.types.js';
export {
  LICENSE_PLANS,
  SUBSCRIPTION_STATUSES,
  SUBSCRIPTION_PERIODICITIES,
  PLAN_DEFAULT_AMOUNT_CENTS,
  PLAN_DEFAULT_PERIODICITY,
  PERIODICITY_LABEL,
  periodicityDurationDays,
} from './subscription.types.js';
export { SubscriptionEntity } from './subscription.entity.js';
export {
  InMemorySubscriptionRepository,
  type SubscriptionRepository,
} from './subscription.repository.js';
export { SubscriptionService } from './subscription.service.js';
export {
  MasterSubscriptionsService,
  type MasterSubscriptionView,
} from './MasterSubscriptionsService.js';
export {
  InMemoryMasterSubscriptionsStore,
  type MasterSubscriptionsStore,
} from './adapters/InMemoryMasterSubscriptionsStore.js';
export {
  isTrialOrFreePlan,
  resolveLicenseExpiry,
  buildJourneyLicenseExpiryInput,
  TRIAL_LICENSE_DURATION_DAYS,
  ADMIN_LICENSE_DEFAULT_DURATION_DAYS,
  type LicenseExpirySource,
  type ResolveLicenseExpiryInput,
  type ResolveLicenseExpiryResult,
} from './subscriptionLicensePeriod.js';
export {
  SubscriptionLicenseSyncService,
  type SubscriptionPeriodSnapshot,
  type SubscriptionLicenseSyncDeps,
  type OnPaymentConfirmedResult,
} from './SubscriptionLicenseSyncService.js';
export {
  calculateSubscriptionExpiresAt,
  addMonthsUtc,
  addYearsUtc,
  addPlanCycle,
  cycleToMonths,
  type SubscriptionCycleInput,
} from './subscriptionPeriodCalculator.js';
