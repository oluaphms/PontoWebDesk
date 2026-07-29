// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { addPlanCycle } from '../plans/SaasPlansService.js';
import { LicenseManagerService } from '../licenseManager/LicenseManagerService.js';
import { SubscriptionService } from './subscription.service.js';
import {
  buildJourneyLicenseExpiryInput,
  isTrialOrFreePlan,
  resolveLicenseExpiry,
  TRIAL_LICENSE_DURATION_DAYS,
} from './subscriptionLicensePeriod.js';
import { SubscriptionLicenseSyncService } from './SubscriptionLicenseSyncService.js';

describe('subscriptionLicensePeriod', () => {
  it('TRIAL/FREE usa 14 dias', () => {
    expect(isTrialOrFreePlan('TRIAL')).toBe(true);
    expect(isTrialOrFreePlan('PRO')).toBe(false);
    const now = Date.parse('2026-07-24T12:00:00.000Z');
    const trial = resolveLicenseExpiry({ plan: 'TRIAL', nowMs: now });
    expect(trial.source).toBe('trial_14');
    expect(Date.parse(trial.expiresAt!)).toBe(now + TRIAL_LICENSE_DURATION_DAYS * 86_400_000);
  });

  it('plano pago usa master_subscriptions.expires_at', () => {
    const subExp = '2026-08-24T12:00:00.000Z';
    const paid = resolveLicenseExpiry({
      plan: 'PRO',
      subscriptionExpiresAt: subExp,
      requireSubscriptionForPaid: true,
    });
    expect(paid.source).toBe('subscription_expires_at');
    expect(paid.expiresAt).toBe(subExp);
  });

  it('plano pago sem subscription.expires_at falha quando exigido', () => {
    expect(() =>
      resolveLicenseExpiry({
        plan: 'PRO',
        requireSubscriptionForPaid: true,
      }),
    ).toThrow(/subscription\.expires_at/);
  });

  it('admin sem assinatura aceita durationDays ou default 365', () => {
    const now = Date.parse('2026-07-24T12:00:00.000Z');
    const byDays = resolveLicenseExpiry({ plan: 'PRO', durationDays: 45, nowMs: now });
    expect(byDays.source).toBe('duration_days');
    expect(Date.parse(byDays.expiresAt!)).toBe(now + 45 * 86_400_000);

    const admin = resolveLicenseExpiry({ plan: 'PRO', nowMs: now });
    expect(admin.source).toBe('admin_default');
    expect(Date.parse(admin.expiresAt!)).toBe(now + 365 * 86_400_000);
  });
});

describe('buildJourneyLicenseExpiryInput + LicenseManager', () => {
  it('PRO MONTHLY: licença acompanha expires_at da assinatura (~1 mês)', async () => {
    const lifecycle = SubscriptionService.createInMemory();
    const startsAt = '2026-07-24T15:00:00.000Z';
    const sub = await lifecycle.createSubscription({
      tenantId: 'tn_pro_monthly',
      customerId: 'cust_1',
      plan: 'PRO',
      periodicity: 'monthly',
      startsAt,
    });
    const expiry = buildJourneyLicenseExpiryInput({
      plan: 'PRO',
      subscriptionExpiresAt: sub.expiresAt,
    });
    expect(expiry.expiresAt).toBe(sub.expiresAt);
    expect(expiry.durationDays).toBeUndefined();

    const licenses = LicenseManagerService.createInMemory();
    const lic = await licenses.create({
      tenantId: 'tn_pro_monthly',
      status: 'Ativa',
      plan: 'PRO',
      startsAt,
      ...expiry,
    });
    expect(lic.expiresAt).toBe(sub.expiresAt);
    const days =
      (Date.parse(lic.expiresAt!) - Date.parse(startsAt)) / 86_400_000;
    expect(days).toBeGreaterThan(27);
    expect(days).toBeLessThan(32);
  });

  it('PRO ANNUAL: licença acompanha ~365 dias da assinatura', async () => {
    const lifecycle = SubscriptionService.createInMemory();
    const startsAt = '2026-07-24T15:00:00.000Z';
    const sub = await lifecycle.createSubscription({
      tenantId: 'tn_pro_annual',
      customerId: 'cust_2',
      plan: 'PRO',
      periodicity: 'yearly',
      startsAt,
    });
    const expiry = buildJourneyLicenseExpiryInput({
      plan: 'PRO',
      subscriptionExpiresAt: sub.expiresAt,
    });
    const licenses = LicenseManagerService.createInMemory();
    const lic = await licenses.create({
      tenantId: 'tn_pro_annual',
      status: 'Ativa',
      plan: 'PRO',
      startsAt,
      ...expiry,
    });
    expect(lic.expiresAt).toBe(sub.expiresAt);
    const days =
      (Date.parse(lic.expiresAt!) - Date.parse(startsAt)) / 86_400_000;
    expect(days).toBeGreaterThan(360);
    expect(days).toBeLessThan(370);
  });

  it('TRIAL: 14 dias (não usa subscription)', async () => {
    const expiry = buildJourneyLicenseExpiryInput({
      plan: 'TRIAL',
      subscriptionExpiresAt: '2099-01-01T00:00:00.000Z',
    });
    expect(expiry.durationDays).toBe(14);
    expect(expiry.expiresAt).toBeUndefined();

    const licenses = LicenseManagerService.createInMemory();
    const lic = await licenses.create({
      tenantId: 'tn_trial',
      status: 'Trial',
      plan: 'TRIAL',
      ...expiry,
    });
    const days = (Date.parse(lic.expiresAt!) - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(13);
    expect(days).toBeLessThan(15);
  });

  it('renew com expiresAt da assinatura (não 365 fixo)', async () => {
    const licenses = LicenseManagerService.createInMemory();
    const lic = await licenses.create({
      tenantId: 'tn_renew',
      status: 'Ativa',
      plan: 'PRO',
      durationDays: 10,
    });
    const nextPeriod = addPlanCycle(new Date().toISOString(), 'MONTHLY');
    const renewed = await licenses.action(lic.id, 'renew', { expiresAt: nextPeriod });
    expect(renewed.expiresAt).toBe(nextPeriod);
  });
});

describe('SubscriptionLicenseSyncService (in-memory)', () => {
  it('syncLicenseFromSubscription alinha expires_at e não toca TRIAL', async () => {
    const lifecycle = SubscriptionService.createInMemory();
    const licenses = LicenseManagerService.createInMemory();
    const startsAt = '2026-07-24T12:00:00.000Z';
    const sub = await lifecycle.createSubscription({
      tenantId: 'tn_sync',
      customerId: 'cust_sync',
      plan: 'PRO',
      periodicity: 'monthly',
      startsAt,
    });
    await licenses.create({
      tenantId: 'tn_sync',
      status: 'Ativa',
      plan: 'PRO',
      durationDays: 365,
    });

    const sync = new SubscriptionLicenseSyncService({
      licenseManager: licenses,
      lifecycle,
      sql: async () => ({ rows: [], rowCount: 0 }),
    });
    const aligned = await sync.syncLicenseFromSubscription('tn_sync');
    expect(aligned?.expiresAt).toBe(sub.expiresAt);

    await licenses.create({
      tenantId: 'tn_trial_sync',
      status: 'Trial',
      plan: 'TRIAL',
      durationDays: 14,
    });
    await lifecycle.createSubscription({
      tenantId: 'tn_trial_sync',
      customerId: 'cust_t',
      plan: 'TRIAL',
      startsAt,
    });
    const before = await licenses.getByTenantId('tn_trial_sync');
    const afterTrial = await sync.syncLicenseFromSubscription('tn_trial_sync');
    expect(afterTrial?.expiresAt).toBe(before!.expiresAt);
  });

  it('bloqueio financeiro separado: sync não exige expires_at curto por overdue', async () => {
    const licenses = LicenseManagerService.createInMemory();
    const future = new Date(Date.now() + 20 * 86_400_000).toISOString();
    const lic = await licenses.create({
      tenantId: 'tn_overdue',
      status: 'Ativa',
      plan: 'PRO',
      expiresAt: future,
    });
    // Inadimplência bloqueia tenant/finance — licença mantém período contratado.
    expect(Date.parse(lic.expiresAt!)).toBeGreaterThan(Date.now());
  });
});
