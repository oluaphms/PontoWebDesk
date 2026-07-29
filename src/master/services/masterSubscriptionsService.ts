/**
 * Service frontend de Assinaturas Master — arquitetura only (sem pagamento).
 */
import {
  createMasterSubscription,
  fetchMasterSubscriptions,
  formatSubDate,
  runSubscriptionAction,
  type CreateMasterSubscriptionInput,
  type MasterSubscriptionAction,
  type MasterSubscriptionRow,
} from '../api/subscriptionsApi';

export const MasterSubscriptionsService = {
  list: fetchMasterSubscriptions,
  create: createMasterSubscription,
  action: runSubscriptionAction,
  formatDate: formatSubDate,
};

export type {
  CreateMasterSubscriptionInput,
  MasterSubscriptionAction,
  MasterSubscriptionRow,
};

export default MasterSubscriptionsService;
