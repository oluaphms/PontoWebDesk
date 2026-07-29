/**
 * Sincroniza ManagedTenant (oficial) → MasterTenant/MasterCustomer (legado Dashboard).
 * Garante que Dashboard e API de tenants vejam o mesmo estado.
 */
import type { MasterRepositories } from '../ports/repositories.js';
import type { ManagedTenant } from '../tenantManager/tenantManager.types.js';
import type { MasterCustomer, MasterTenant, MasterTenantStatus } from '../types.js';
import { slugify } from '../utils.js';

export type LegacyTenantMirrorRepos = Pick<MasterRepositories, 'tenants' | 'customers'>;

function mapStatus(status: ManagedTenant['status']): MasterTenantStatus {
  if (status === 'draft') return 'draft';
  if (status === 'active') return 'active';
  if (status === 'trial') return 'trial';
  if (status === 'blocked') return 'blocked';
  if (status === 'suspended') return 'suspended';
  if (status === 'cancelled') return 'cancelled';
  return 'draft';
}

function customerIdFor(tenant: ManagedTenant): string {
  return tenant.admin.userId || `cust_${tenant.id}`;
}

export async function syncManagedTenantToLegacy(
  repos: LegacyTenantMirrorRepos,
  tenant: ManagedTenant,
): Promise<void> {
  const customerId = customerIdFor(tenant);
  const now = tenant.updatedAt || new Date().toISOString();

  const existingCustomer = await repos.customers.findById(customerId);
  const customer: MasterCustomer = {
    id: customerId,
    name: tenant.admin.name || tenant.company.name,
    email: tenant.admin.email,
    document: tenant.company.document ?? null,
    createdAt: existingCustomer?.createdAt ?? tenant.createdAt,
    updatedAt: now,
    meta: { syncedFrom: 'MasterTenantsService', domain: tenant.domain },
  };
  await repos.customers.save(customer);

  const legacy: MasterTenant = {
    id: tenant.id,
    customerId,
    name: tenant.company.name,
    slug: slugify(tenant.domain || tenant.company.name) || tenant.id,
    status: mapStatus(tenant.status),
    deploymentMode: tenant.mode,
    createdAt: tenant.createdAt,
    updatedAt: now,
    blockedAt: tenant.status === 'blocked' ? now : null,
    blockedReason:
      typeof tenant.meta?.lastActionReason === 'string'
        ? tenant.meta.lastActionReason
        : null,
    activatedAt: tenant.status === 'active' ? now : null,
    meta: {
      syncedFrom: 'MasterTenantsService',
      plan: tenant.plan,
      gateway: tenant.gateway,
      domain: tenant.domain,
    },
  };
  await repos.tenants.save(legacy);
}
