import type { BillingProviderName } from '../types.js';
import { MockBillingAdapter } from './MockBillingAdapter.js';
import type { InMemoryBillingStore } from './InMemoryBillingStore.js';

/** Adapter Stripe — apenas mock InMemory. Pronto para HTTP futuro. */
export class StripeAdapter extends MockBillingAdapter {
  readonly name: BillingProviderName = 'stripe';

  constructor(store?: InMemoryBillingStore) {
    super(store);
  }
}
