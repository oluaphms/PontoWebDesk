// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { LicenseService } from './license.service.js';
import { SubscriptionService } from '../subscriptions/subscription.service.js';

describe('Master LicenseService (Fase 10)', () => {
  it('PRO: REP/App/API/Dashboard/BH/Escalas/Multiempresa; sem API externa', async () => {
    const subs = SubscriptionService.createInMemory();
    const sub = await subs.createSubscription({
      tenantId: 't1',
      customerId: 'c1',
      plan: 'PRO',
      durationDays: 30,
    });
    const lic = LicenseService.fromSubscription(sub);

    expect(lic.isBlocked()).toBe(false);
    expect(lic.canUseRep()).toBe(true);
    expect(lic.canUseApp()).toBe(true);
    expect(lic.canUseApi()).toBe(true);
    expect(lic.canUseDashboard()).toBe(true);
    expect(lic.canUseBankHours()).toBe(true);
    expect(lic.canUseSchedules()).toBe(true);
    expect(lic.canUseMultiCompany()).toBe(true);
    expect(lic.canUseExternalApi()).toBe(false);
    expect(lic.hasFeature('external_api')).toBe(false);
    expect(lic.remainingTrialDays()).toBe(0);
  });

  it('TRIAL: remainingTrialDays + todas as features', async () => {
    const subs = SubscriptionService.createInMemory();
    const sub = await subs.createSubscription({
      tenantId: 't1',
      customerId: 'c1',
      plan: 'TRIAL',
      durationDays: 10,
    });
    const lic = LicenseService.fromSubscription(sub);
    expect(lic.canUseExternalApi()).toBe(true);
    const days = lic.remainingTrialDays();
    expect(days).toBeGreaterThanOrEqual(9);
    expect(days).toBeLessThanOrEqual(10);
  });

  it('cancelada ou bloqueio admin → isBlocked e hasFeature false', async () => {
    const subs = SubscriptionService.createInMemory();
    const sub = await subs.createSubscription({
      tenantId: 't1',
      customerId: 'c1',
      plan: 'ENTERPRISE',
    });
    await subs.cancel(sub.id);
    const cancelled = await subs.get(sub.id);
    const lic = LicenseService.fromSubscription(cancelled);
    expect(lic.isBlocked()).toBe(true);
    expect(lic.canUseRep()).toBe(false);

    const active = await SubscriptionService.createInMemory().createSubscription({
      tenantId: 't2',
      customerId: 'c2',
      plan: 'ENTERPRISE',
    });
    const blocked = LicenseService.fromSubscription(active, {
      administrativelyBlocked: true,
    });
    expect(blocked.isBlocked()).toBe(true);
    expect(blocked.hasFeature('app')).toBe(false);
  });
});
