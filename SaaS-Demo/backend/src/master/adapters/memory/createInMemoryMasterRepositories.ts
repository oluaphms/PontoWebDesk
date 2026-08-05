import type { MasterRepositories } from '../../ports/repositories.js';
import { InMemoryCustomerRepository } from './InMemoryCustomerRepository.js';
import { InMemoryTenantRepository } from './InMemoryTenantRepository.js';
import { InMemorySubscriptionRepository } from './InMemorySubscriptionRepository.js';
import { InMemoryBillingRepository } from './InMemoryBillingRepository.js';
import { InMemoryLicenseRecordRepository } from './InMemoryLicenseRecordRepository.js';
import { InMemoryActivationRepository } from './InMemoryActivationRepository.js';
import { InMemoryBlockRepository } from './InMemoryBlockRepository.js';

/** Fábrica de adapters in-memory (sem DB). */
export function createInMemoryMasterRepositories(): MasterRepositories {
  return {
    customers: new InMemoryCustomerRepository(),
    tenants: new InMemoryTenantRepository(),
    subscriptions: new InMemorySubscriptionRepository(),
    billing: new InMemoryBillingRepository(),
    licenses: new InMemoryLicenseRecordRepository(),
    activations: new InMemoryActivationRepository(),
    blocks: new InMemoryBlockRepository(),
  };
}
