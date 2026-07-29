// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { createMasterDashboard } from './createMasterDashboard.js';
import { MASTER_DASHBOARD_MODULES } from './dashboard.types.js';

describe('Master Dashboard', () => {
  it('expõe os 8 módulos e summary', async () => {
    const dash = createMasterDashboard();
    expect(dash.listModules().map((m) => m.id)).toEqual(
      MASTER_DASHBOARD_MODULES.map((m) => m.id),
    );

    const customer = await dash.customers.create({
      name: 'Acme',
      email: 'a@acme.test',
    });
    const tenant = await dash.getMasterServices().tenants.create({
      customerId: customer.id,
      name: 'Acme Op',
    });
    await dash.subscriptions.create({
      tenantId: tenant.id,
      customerId: customer.id,
      plan: 'PRO',
    });
    await dash.payments.createPix({ amountCents: 1990 });

    const summary = await dash.getSummary();
    expect(summary.counts.customers).toBe(1);
    expect(summary.counts.tenants).toBe(1);
    expect(summary.counts.subscriptions).toBe(1);
    expect(summary.counts.payments).toBe(1);
    expect(summary.counts.plans).toBe(7);
    expect(summary.counts.gateways).toBe(3);
    expect(summary.counts.logs).toBeGreaterThan(0);

    expect(dash.plans.list().some((p) => p.plan === 'ENTERPRISE')).toBe(true);
    expect(dash.gateway.getActive()?.name).toBe('asaas');
  });

  it('getExecutive cobre KPIs dos serviços Master', async () => {
    const dash = createMasterDashboard();
    const customer = await dash.customers.create({
      name: 'Beta',
      email: 'b@beta.test',
    });
    await dash.getMasterServices().tenants.create({
      customerId: customer.id,
      name: 'Beta Local',
      deploymentMode: 'LOCAL',
    });
    await dash.getMasterServices().tenants.create({
      customerId: customer.id,
      name: 'Beta SaaS',
      deploymentMode: 'SAAS',
    });
    await dash.getMasterServices().tenants.create({
      customerId: customer.id,
      name: 'Beta Hybrid',
      deploymentMode: 'HYBRID',
    });

    const executive = await dash.getExecutive();
    expect(executive.companies).toBe(3);
    expect(executive.users).toBe(1);
    expect(executive.modeLocal).toBe(1);
    expect(executive.modeSaas).toBe(1);
    expect(executive.modeHybrid).toBe(1);
    expect(executive.revenueCents).toBe(0);
    expect(executive.monthlyRevenueCents).toBe(0);
    expect(executive.annualRevenueCents).toBe(0);
    expect(executive.companiesActive).toBe(0);
    expect(executive.companiesBlocked).toBe(0);
    expect(executive.pixPending).toBe(0);
    expect(executive.renewalsDue).toBe(0);
    expect(executive.licensesExpiring).toBe(0);
    expect(Array.isArray(executive.recentPayments)).toBe(true);
    expect(executive.currency).toBe('BRL');
    expect(executive.gateway).toBe(3);
    expect(executive.gatewayActive).toBe('asaas');
    expect(executive.source).toBe('in_memory');
    expect(executive.companiesTrial).toBe(0);
    expect(executive.updates.available).toBe(false);
    expect(executive.revenue.available).toBe(false);
    expect(executive.support.awaitingFirstLogin).toBeNull();
    expect(Array.isArray(executive.charts.modeMix)).toBe(true);
  });
});
