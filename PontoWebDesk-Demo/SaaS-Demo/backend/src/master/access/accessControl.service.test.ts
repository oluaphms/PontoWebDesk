// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { AccessControlService } from './accessControl.service.js';
import { SubscriptionService } from '../subscriptions/subscription.service.js';

describe('AccessControlService (Fase 11)', () => {
  it('ACTIVE → acesso total', async () => {
    const subs = SubscriptionService.createInMemory();
    const sub = await subs.createSubscription({
      tenantId: 't',
      customerId: 'c',
      plan: 'PRO',
      status: 'ACTIVE',
    });
    const ac = AccessControlService.fromSubscription(sub);
    expect(ac.resolve().level).toBe('full');
    expect(ac.canLogin()).toBe(true);
    expect(ac.canPunch()).toBe(true);
    expect(ac.canAccessApi()).toBe(true);
    expect(ac.canUseModule('dashboard')).toBe(true);
    expect(ac.canSync()).toBe(true);
  });

  it('SUSPENDED / CANCELLED → somente login', async () => {
    const subs = SubscriptionService.createInMemory();
    const sub = await subs.createSubscription({
      tenantId: 't',
      customerId: 'c',
      plan: 'PRO',
    });
    await subs.cancel(sub.id);
    const cancelled = AccessControlService.fromSubscription(await subs.get(sub.id));
    expect(cancelled.canLogin()).toBe(true);
    expect(cancelled.canPunch()).toBe(false);
    expect(cancelled.canAccessApi()).toBe(false);
    expect(cancelled.canUseModule('rep')).toBe(false);
    expect(cancelled.canSync()).toBe(false);
  });

  it('PENDING_PAYMENT → acesso normal; LOCAL ignora cobrança', async () => {
    const subs = SubscriptionService.createInMemory();
    const pending = await subs.createSubscription({
      tenantId: 't1',
      customerId: 'c1',
      plan: 'PRO',
      status: 'PENDING_PAYMENT',
    });
    const acPending = AccessControlService.fromSubscription(pending);
    expect(acPending.resolve().level).toBe('normal');
    expect(acPending.canPunch()).toBe(true);
    expect(acPending.canAccessApi()).toBe(true);

    const local = await subs.createSubscription({
      tenantId: 't2',
      customerId: 'c2',
      plan: 'LOCAL',
      status: 'PENDING_PAYMENT',
    });
    const acLocal = AccessControlService.fromSubscription(local);
    expect(acLocal.resolve().reason).toBe('local_ignore_billing');
    expect(acLocal.resolve().level).toBe('full');
    expect(acLocal.canSync()).toBe(false);
    expect(acLocal.canPunch()).toBe(true);
  });

  it('GRACE → acesso normal', async () => {
    const past = new Date(Date.now() - 2 * 86_400_000).toISOString();
    const grace = new Date(Date.now() + 3 * 86_400_000).toISOString();
    const subs = SubscriptionService.createInMemory();
    const sub = await subs.createSubscription({
      tenantId: 't',
      customerId: 'c',
      plan: 'STARTER',
      status: 'ACTIVE',
      startsAt: past,
      expiresAt: past,
      graceUntil: grace,
    });
    const ac = AccessControlService.fromSubscription(sub);
    expect(ac.resolve().reason).toBe('grace');
    expect(ac.resolve().level).toBe('normal');
    expect(ac.canLogin()).toBe(true);
    expect(ac.canPunch()).toBe(true);
  });

  it('HYBRID → local + cloud para sync', async () => {
    const subs = SubscriptionService.createInMemory();
    const local = await subs.createSubscription({
      tenantId: 't',
      customerId: 'c',
      plan: 'HYBRID',
      status: 'ACTIVE',
    });
    const cloud = await subs.createSubscription({
      tenantId: 't-cloud',
      customerId: 'c',
      plan: 'PRO',
      status: 'ACTIVE',
    });
    const ac = AccessControlService.fromSubscription(local, { cloudSubscription: cloud });
    expect(ac.resolve().hybrid).toBe(true);
    expect(ac.canSync()).toBe(true);
    expect(ac.canUseModule('rep')).toBe(true);

    const cloudSuspended = await SubscriptionService.createInMemory().createSubscription({
      tenantId: 't-cloud-2',
      customerId: 'c',
      plan: 'PRO',
      status: 'SUSPENDED',
    });
    const acBlockedCloud = AccessControlService.fromSubscription(local, {
      cloudSubscription: cloudSuspended,
    });
    expect(acBlockedCloud.canSync()).toBe(false);
    expect(acBlockedCloud.canPunch()).toBe(true);
  });
});
