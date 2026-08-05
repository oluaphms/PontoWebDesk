// @vitest-environment node
/**
 * Wiring do MasterRepositoryRegistry — memory (default) vs postgres (opt-in).
 * Não altera APIs; valida apenas composition/adapters.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  MasterRepositoryRegistry,
  resetMasterRepositoryRegistry,
} from './MasterRepositoryRegistry.js';
import { InMemoryTenantManagerStore } from '../tenantManager/adapters/InMemoryTenantManagerStore.js';
import { InMemorySubscriptionRepository } from '../subscriptions/subscription.repository.js';
import { InMemoryLicenseManagerStore } from '../licenseManager/adapters/InMemoryLicenseManagerStore.js';
import { InMemoryBillingStore } from '../billingEngine/adapters/InMemoryBillingStore.js';
import { DashboardLogsModule } from '../dashboard/modules/logs.module.js';
import {
  MasterTenantsRepository,
  MasterSubscriptionsRepository,
  MasterLicensesRepository,
  MasterLogsRepository,
  PgBillingStore,
} from '../adapters/postgres/index.js';
import { createMasterComposition } from './createMasterComposition.js';

afterEach(() => {
  resetMasterRepositoryRegistry();
});

describe('MasterRepositoryRegistry — Fase 16 persistence', () => {
  it('default memory usa adapters InMemory (testes)', () => {
    const registry = MasterRepositoryRegistry.create('memory');
    expect(registry.persistence).toBe('memory');
    expect(registry.tenantManagerStore).toBeInstanceOf(InMemoryTenantManagerStore);
    expect(registry.subscriptionLifecycleRepo).toBeInstanceOf(InMemorySubscriptionRepository);
    expect(registry.licenseManagerStore).toBeInstanceOf(InMemoryLicenseManagerStore);
    expect(registry.billingStore).toBeInstanceOf(InMemoryBillingStore);
    expect(registry.billingStore).not.toBeInstanceOf(PgBillingStore);
    expect(registry.logs).toBeInstanceOf(DashboardLogsModule);
    expect(registry.auditRepository).toBeNull();

    const snap = registry.snapshot();
    expect(snap.persistence).toBe('in_memory');
    expect(snap.backends.tenants).toBe('memory');
    expect(snap.backends.billing).toBe('memory');
    expect(snap.backends.deployments).toBe('memory');
  });

  it('postgres monta repositories PostgreSQL sem mudar composition root', () => {
    const registry = MasterRepositoryRegistry.create('postgres');
    expect(registry.persistence).toBe('postgres');
    expect(registry.tenantManagerStore).toBeInstanceOf(MasterTenantsRepository);
    expect(registry.subscriptionLifecycleRepo).toBeInstanceOf(MasterSubscriptionsRepository);
    expect(registry.licenseManagerStore).toBeInstanceOf(MasterLicensesRepository);
    expect(registry.billingStore).toBeInstanceOf(PgBillingStore);
    expect(registry.logs).toBeInstanceOf(MasterLogsRepository);
    expect(registry.auditRepository).not.toBeNull();

    const snap = registry.snapshot();
    expect(snap.persistence).toBe('postgres');
    expect(snap.backends.tenants).toBe('postgres');
    expect(snap.backends.subscriptionsLifecycle).toBe('postgres');
    expect(snap.backends.billing).toBe('postgres');
    expect(snap.backends.licenses).toBe('postgres');
    expect(snap.backends.logs).toBe('postgres');
    expect(snap.backends.audit).toBe('postgres');
    expect(snap.backends.localLicenses).toBe('postgres');
    expect(snap.backends.deployments).toBe('postgres');
    expect(snap.backends.hybridSync).toBe('disabled');
    expect(snap.backends.legacyRepos).toBe('compat_shim');
    expect(Object.values(snap.backends).every((v) => v !== 'memory')).toBe(true);

    const composition = createMasterComposition(registry);
    expect(composition.registry).toBe(registry);
    expect(composition.tenantsService).toBeTruthy();
    expect(composition.billingEngine).toBeTruthy();
    expect(composition.licenseManager).toBeTruthy();
    expect(composition.lifecycle).toBeTruthy();
  });
});
