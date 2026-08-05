// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { BillingEngine } from '../billing/BillingEngine.js';
import { InMemoryBillingStore } from '../billingEngine/adapters/InMemoryBillingStore.js';
import { SubscriptionService } from '../subscriptions/subscription.service.js';
import {
  bindLegacyBillingChargesToStore,
  restoreLegacyChargesFromStore,
} from './bindLegacyBillingCharges.js';

describe('bindLegacyBillingChargesToStore', () => {
  it('dual-write charge → invoice e restaura após clear do Map', async () => {
    const lifecycle = SubscriptionService.createInMemory();
    const sub = await lifecycle.createSubscription({
      tenantId: 'tn_1',
      customerId: 'cust_1',
      plan: 'PRO',
      periodicity: 'monthly',
      amountCents: 9900,
    });
    const engine = new BillingEngine(lifecycle);
    const store = new InMemoryBillingStore();
    bindLegacyBillingChargesToStore(engine, store, lifecycle, () => 'asaas');

    const charged = await engine.generateNextCharge(sub.id, { amountCents: 9900 });
    expect(charged.charge?.id).toMatch(/^chg_/);
    expect(store.invoices.has(charged.charge!.id)).toBe(true);
    expect(store.invoices.get(charged.charge!.id)?.meta?.source).toBe('billing_engine');

    await engine.markChargePaid(charged.charge!.id);
    expect(store.invoices.get(charged.charge!.id)?.status).toBe('paid');

    const engine2 = new BillingEngine(lifecycle);
    restoreLegacyChargesFromStore(engine2, store);
    const all = await engine2.listAllCharges();
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe(charged.charge!.id);
    expect(all[0].status).toBe('paid');
  });
});
