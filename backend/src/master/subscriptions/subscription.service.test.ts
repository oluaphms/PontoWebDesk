// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { SubscriptionService } from './subscription.service.js';

describe('Subscription lifecycle (Fase 9)', () => {
  it('createSubscription + pause/resume/renew/cancel e checks de tempo', async () => {
    const svc = SubscriptionService.createInMemory();
    const sub = await svc.createSubscription({
      tenantId: 'tenant-1',
      customerId: 'customer-1',
      plan: 'PRO',
      durationDays: 30,
      graceDays: 7,
    });

    expect(sub.status).toBe('ACTIVE');
    expect(sub.plan).toBe('PRO');
    expect(sub.amountCents).toBe(19_900);
    expect(sub.periodicity).toBe('monthly');
    expect(sub.resolveSituacao()).toBe('Ativa');
    expect(sub.startsAt).toBeTruthy();
    expect(sub.expiresAt).toBeTruthy();
    expect(sub.nextBilling).toBe(sub.expiresAt);
    expect(sub.graceUntil).toBeTruthy();
    expect(svc.isActive(sub)).toBe(true);
    expect(svc.isExpired(sub)).toBe(false);
    expect(svc.isInGracePeriod(sub)).toBe(false);

    const paused = await svc.pause(sub.id);
    expect(paused.status).toBe('PAUSED');
    expect(paused.resolveSituacao()).toBe('Pendente');
    expect(svc.isActive(paused)).toBe(false);

    const resumed = await svc.resume(sub.id);
    expect(resumed.status).toBe('ACTIVE');
    expect(svc.isActive(resumed)).toBe(true);

    const renewed = await svc.renew(sub.id, { durationDays: 30, graceDays: 3 });
    expect(Date.parse(renewed.expiresAt!)).toBeGreaterThan(Date.parse(sub.expiresAt!));
    expect(renewed.status).toBe('ACTIVE');
    expect(renewed.renewedAt).toBeTruthy();

    await expect(
      svc.createSubscription({
        tenantId: 'tenant-1',
        customerId: 'customer-2',
        plan: 'STARTER',
      }),
    ).rejects.toThrow(/already has a subscription/);

    const cancelled = await svc.cancel(sub.id);
    expect(cancelled.status).toBe('CANCELLED');
    expect(cancelled.resolveSituacao()).toBe('Cancelada');
    expect(svc.isActive(cancelled)).toBe(false);

    // Após cancelar, pode criar outra para a mesma empresa.
    const again = await svc.createSubscription({
      tenantId: 'tenant-1',
      customerId: 'customer-1',
      plan: 'STARTER',
    });
    expect(again.plan).toBe('STARTER');
  });

  it('isInGracePeriod quando expiresAt passou e graceUntil futuro', async () => {
    const svc = SubscriptionService.createInMemory();
    const past = new Date(Date.now() - 2 * 86_400_000).toISOString();
    const grace = new Date(Date.now() + 2 * 86_400_000).toISOString();
    const sub = await svc.createSubscription({
      tenantId: 't',
      customerId: 'c',
      plan: 'STARTER',
      startsAt: past,
      expiresAt: past,
      graceUntil: grace,
      status: 'ACTIVE',
    });
    expect(svc.isExpired(sub)).toBe(true);
    expect(svc.isInGracePeriod(sub)).toBe(true);
    expect(svc.isActive(sub)).toBe(true);
  });

  it('enterGrace + block/unblock/reactivate (Fase 24)', async () => {
    const svc = SubscriptionService.createInMemory();
    const sub = await svc.createSubscription({
      tenantId: 't2',
      customerId: 'c2',
      plan: 'PRO',
      durationDays: 30,
    });

    const grace = await svc.enterGrace(sub.id, { graceDays: 5 });
    expect(svc.isInGracePeriod(grace)).toBe(true);
    expect(grace.graceUntil).toBeTruthy();

    const blocked = await svc.block(sub.id);
    expect(blocked.status).toBe('SUSPENDED');
    expect(blocked.resolveSituacao()).toBe('Bloqueada');
    expect(blocked.suspendedAt).toBeTruthy();
    expect(svc.isActive(blocked)).toBe(false);

    const unblocked = await svc.unblock(sub.id);
    expect(unblocked.status).toBe('ACTIVE');

    await svc.pause(sub.id);
    const reactivated = await svc.reactivate(sub.id);
    expect(reactivated.status).toBe('ACTIVE');
  });
});
