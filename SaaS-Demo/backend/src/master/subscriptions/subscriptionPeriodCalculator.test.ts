// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  addMonthsUtc,
  addYearsUtc,
  calculateSubscriptionExpiresAt,
} from './subscriptionPeriodCalculator.js';
import { SubscriptionService } from './subscription.service.js';

describe('subscriptionPeriodCalculator', () => {
  it('31/01 + MONTHLY → 28/02 ou 29/02 conforme ano', () => {
    expect(calculateSubscriptionExpiresAt('2024-01-31T12:00:00.000Z', 'MONTHLY')).toBe(
      '2024-02-29T12:00:00.000Z',
    );
    expect(calculateSubscriptionExpiresAt('2025-01-31T12:00:00.000Z', 'MONTHLY')).toBe(
      '2025-02-28T12:00:00.000Z',
    );
    expect(addMonthsUtc('2025-01-31T12:00:00.000Z', 1)).toBe('2025-02-28T12:00:00.000Z');
  });

  it('24/07 + MONTHLY → 24/08', () => {
    expect(calculateSubscriptionExpiresAt('2026-07-24T15:00:00.000Z', 'MONTHLY')).toBe(
      '2026-08-24T15:00:00.000Z',
    );
    expect(calculateSubscriptionExpiresAt('2026-07-24T15:00:00.000Z', 'monthly')).toBe(
      '2026-08-24T15:00:00.000Z',
    );
  });

  it('24/07 + ANNUAL/YEARLY → 24/07 ano seguinte', () => {
    expect(calculateSubscriptionExpiresAt('2026-07-24T10:00:00.000Z', 'ANNUAL')).toBe(
      '2027-07-24T10:00:00.000Z',
    );
    expect(calculateSubscriptionExpiresAt('2026-07-24T10:00:00.000Z', 'yearly')).toBe(
      '2027-07-24T10:00:00.000Z',
    );
    expect(addYearsUtc('2026-07-24T10:00:00.000Z', 1)).toBe('2027-07-24T10:00:00.000Z');
  });

  it('renovação mantém o padrão calendário (não +30/+365 dias)', async () => {
    const svc = SubscriptionService.createInMemory();
    const startsAt = '2026-07-24T12:00:00.000Z';
    const sub = await svc.createSubscription({
      tenantId: 'tn_cycle_renew',
      customerId: 'cust_cycle',
      plan: 'PRO',
      periodicity: 'monthly',
      startsAt,
    });
    expect(sub.expiresAt).toBe('2026-08-24T12:00:00.000Z');

    const renewed = await svc.renew(sub.id);
    expect(renewed.expiresAt).toBe('2026-09-24T12:00:00.000Z');

    const annual = await svc.createSubscription({
      tenantId: 'tn_cycle_annual',
      customerId: 'cust_annual',
      plan: 'PRO',
      periodicity: 'yearly',
      startsAt,
    });
    expect(annual.expiresAt).toBe('2027-07-24T12:00:00.000Z');
    const renewedAnnual = await svc.renew(annual.id);
    expect(renewedAnnual.expiresAt).toBe('2028-07-24T12:00:00.000Z');
  });
});
