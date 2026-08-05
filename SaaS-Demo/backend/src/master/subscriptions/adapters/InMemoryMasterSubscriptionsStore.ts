/**
 * Adapter InMemory — reexport do repository (troca futura: HTTP/Postgres).
 */
export {
  InMemorySubscriptionRepository as InMemoryMasterSubscriptionsStore,
  type SubscriptionRepository as MasterSubscriptionsStore,
} from '../subscription.repository.js';
