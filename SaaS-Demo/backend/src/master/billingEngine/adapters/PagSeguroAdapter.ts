import type { BillingProviderName } from '../types.js';
import { MockBillingAdapter } from './MockBillingAdapter.js';
import type { InMemoryBillingStore } from './InMemoryBillingStore.js';

/** Adapter PagSeguro — apenas mock InMemory. Pronto para HTTP futuro. */
export class PagSeguroAdapter extends MockBillingAdapter {
  readonly name: BillingProviderName = 'pagseguro';

  constructor(store?: InMemoryBillingStore) {
    super(store);
  }
}
