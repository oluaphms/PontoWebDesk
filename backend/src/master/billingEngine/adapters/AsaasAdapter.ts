import type { BillingProviderName } from '../types.js';
import { MockBillingAdapter } from './MockBillingAdapter.js';
import type { InMemoryBillingStore } from './InMemoryBillingStore.js';

/** Adapter Asaas — apenas mock InMemory. Pronto para HTTP futuro. */
export class AsaasAdapter extends MockBillingAdapter {
  readonly name: BillingProviderName = 'asaas';

  constructor(store?: InMemoryBillingStore) {
    super(store);
  }
}
