// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { BillingEngine } from './BillingEngine.js';
import { MasterError } from '../errors.js';

describe('BillingEngine', () => {
  it('ACTIVE → charge → grace → block → reactivate → renew', async () => {
    const engine = BillingEngine.createInMemory();
    const subs = engine.getSubscriptionService();
    const sub = await subs.createSubscription({
      tenantId: 't',
      customerId: 'c',
      plan: 'PRO',
      durationDays: 30,
    });

    expect(await engine.getState(sub.id)).toBe('ACTIVE');

    const charged = await engine.generateNextCharge(sub.id, { amountCents: 9900 });
    expect(charged.state).toBe('PENDING_PAYMENT');
    expect(charged.charge?.amountCents).toBe(9900);
    expect((await engine.listCharges(sub.id)).length).toBe(1);

    const grace = await engine.enterGracePeriod(sub.id, { graceDays: 5 });
    expect(grace.state).toBe('GRACE');

    const blocked = await engine.blockSubscription(sub.id);
    expect(blocked.state).toBe('SUSPENDED');

    const reactivated = await engine.reactivateSubscription(sub.id);
    expect(['ACTIVE', 'TRIAL']).toContain(reactivated.state);

    const renewed = await engine.renew(sub.id, { durationDays: 30 });
    expect(renewed.transition).toBe('renew');
    expect(['ACTIVE', 'TRIAL']).toContain(renewed.state);
  });

  it('listAllCharges + markChargePaid (Fase 26)', async () => {
    const engine = BillingEngine.createInMemory();
    const sub = await engine.getSubscriptionService().createSubscription({
      tenantId: 't',
      customerId: 'c',
      plan: 'PRO',
      durationDays: 30,
    });
    const charged = await engine.generateNextCharge(sub.id, { amountCents: 1500 });
    expect(charged.charge).toBeTruthy();
    expect((await engine.listAllCharges()).length).toBe(1);

    const paid = await engine.markChargePaid(charged.charge!.id);
    expect(paid.status).toBe('paid');
    expect(paid.paidAt).toBeTruthy();
    expect(paid.meta?.asaas).toBeTruthy();
  });

  it('LOCAL não gera cobrança', async () => {
    const engine = BillingEngine.createInMemory();
    const sub = await engine.getSubscriptionService().createSubscription({
      tenantId: 't',
      customerId: 'c',
      plan: 'LOCAL',
    });
    await expect(
      engine.generateNextCharge(sub.id, { amountCents: 100 }),
    ).rejects.toBeInstanceOf(MasterError);
  });

  it('CANCELLED não pode gerar cobrança; pode reativar', async () => {
    const engine = BillingEngine.createInMemory();
    const subs = engine.getSubscriptionService();
    const sub = await subs.createSubscription({
      tenantId: 't',
      customerId: 'c',
      plan: 'STARTER',
    });
    await subs.cancel(sub.id);
    expect(await engine.getState(sub.id)).toBe('CANCELLED');

    await expect(
      engine.generateNextCharge(sub.id, { amountCents: 100 }),
    ).rejects.toBeInstanceOf(MasterError);

    const reactivated = await engine.reactivateSubscription(sub.id);
    expect(reactivated.state).toBe('ACTIVE');
  });
});
