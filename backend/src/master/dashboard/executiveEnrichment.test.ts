// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { withExecutiveDefaults } from './executiveEnrichment.js';
import type { MasterExecutiveSummary } from './dashboard.types.js';

function base(): MasterExecutiveSummary {
  return withExecutiveDefaults({
    companies: 2,
    companiesActive: 1,
    companiesBlocked: 1,
    companiesTrial: 0,
    users: 1,
    subscriptions: 1,
    licenses: 1,
    licensesActive: 1,
    licensesExpired: 0,
    licensesTrial: 0,
    licensesScheduled: 0,
    licensesExpiring7d: 0,
    licensesExpiring30d: 0,
    revenueCents: 0,
    monthlyRevenueCents: 0,
    annualRevenueCents: 0,
    pixPending: 0,
    renewalsDue: 0,
    licensesExpiring: 0,
    currency: 'BRL',
    gateway: 1,
    gatewayActive: 'asaas',
    modeSaas: 1,
    modeLocal: 0,
    modeHybrid: 1,
    recentPayments: [],
    updates: {
      current: 0,
      outdated: 0,
      unknown: 0,
      failedRequests: 0,
      available: false,
    },
    revenue: {
      contractedMrrCents: null,
      predictedMrrCents: null,
      overdueClients: null,
      monthReceiptsCents: null,
      overdueCents: null,
      available: false,
    },
    support: {
      awaitingFirstLogin: null,
      outdatedInstallations: null,
      syncConflicts: null,
      syncPending: null,
      offlinePending: null,
    },
    charts: {
      companiesByStatus: [],
      modeMix: [],
      updatesByStatus: [],
      licensesByStatus: [],
    },
    licenseValidities: [],
    source: 'in_memory',
  });
}

describe('executiveEnrichment defaults', () => {
  it('garante blocos updates/revenue/support/charts', () => {
    const partial = {
      companies: 0,
      companiesActive: 0,
      companiesBlocked: 0,
      users: 0,
      subscriptions: 0,
      licenses: 0,
      revenueCents: 0,
      monthlyRevenueCents: 0,
      annualRevenueCents: 0,
      pixPending: 0,
      renewalsDue: 0,
      licensesExpiring: 0,
      currency: 'BRL' as const,
      gateway: 0,
      gatewayActive: null,
      modeSaas: 0,
      modeLocal: 0,
      modeHybrid: 0,
      recentPayments: [],
      source: 'in_memory' as const,
    };
    const filled = withExecutiveDefaults(partial as unknown as MasterExecutiveSummary);
    expect(filled.updates.available).toBe(false);
    expect(filled.revenue.available).toBe(false);
    expect(filled.support.awaitingFirstLogin).toBeNull();
    expect(Array.isArray(filled.charts.modeMix)).toBe(true);
    expect(Array.isArray(filled.licenseValidities)).toBe(true);
  });

  it('mantém KPIs base', () => {
    const e = base();
    expect(e.companies).toBe(2);
    expect(e.companiesActive).toBe(1);
    expect(e.modeHybrid).toBe(1);
  });
});
