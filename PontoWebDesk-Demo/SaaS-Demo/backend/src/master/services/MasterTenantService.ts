import { conflict, invalid, notFound } from '../errors.js';
import type { CustomerRepository, TenantRepository } from '../ports/repositories.js';
import type {
  MasterDeploymentMode,
  MasterId,
  MasterTenant,
  MasterTenantStatus,
} from '../types.js';
import { newMasterId, nowIso, slugify } from '../utils.js';
import type { MasterTenantsService } from '../tenants/MasterTenantsService.js';
import { syncManagedTenantToLegacy } from '../registry/syncManagedTenantToLegacy.js';

export type CreateTenantInput = {
  customerId: MasterId;
  name: string;
  slug?: string;
  deploymentMode?: MasterDeploymentMode;
  status?: MasterTenantStatus;
  meta?: Record<string, unknown>;
};

export type UpdateTenantInput = {
  name?: string;
  slug?: string;
  deploymentMode?: MasterDeploymentMode;
  meta?: Record<string, unknown>;
};

/**
 * @deprecated Use MasterTenantsService (oficial).
 * Wrapper de compatibilidade — encaminha quando bindOfficial() é chamado.
 * Mantido para createMasterServices / Block / Activation.
 */
export class MasterTenantService {
  private official: MasterTenantsService | null = null;

  constructor(
    private readonly tenants: TenantRepository,
    private readonly customers: CustomerRepository,
  ) {}

  /** Liga o serviço oficial (TenantManager) — create/update encaminham. */
  bindOfficial(service: MasterTenantsService): this {
    this.official = service;
    return this;
  }

  async create(input: CreateTenantInput): Promise<MasterTenant> {
    if (this.official) {
      const managed = await this.official.create({
        company: { name: String(input.name || '').trim() },
        admin: {
          name: String(input.name || '').trim() || 'Admin',
          email: `${slugify(input.name) || 'tenant'}@master.local`,
          userId: input.customerId,
        },
        domain: `${slugify(input.slug || input.name) || newMasterId()}.local`,
        mode: input.deploymentMode ?? 'SAAS',
        status:
          input.status === 'active'
            ? 'active'
            : input.status === 'blocked'
              ? 'blocked'
              : input.status === 'suspended'
                ? 'suspended'
                : input.status === 'cancelled'
                  ? 'cancelled'
                  : 'draft',
        meta: { ...input.meta, customerId: input.customerId, via: 'MasterTenantService' },
      });
      const mirrored = await this.tenants.findById(managed.id);
      if (mirrored) return mirrored;
    }

    const customer = await this.customers.findById(input.customerId);
    if (!customer) throw notFound('customer', input.customerId);
    const name = String(input.name || '').trim();
    if (!name) throw invalid('name is required');
    const slug = slugify(input.slug || name);
    if (!slug) throw invalid('slug is required');
    const exists = await this.tenants.findBySlug(slug);
    if (exists) throw conflict(`tenant slug already exists: ${slug}`);
    const now = nowIso();
    const row: MasterTenant = {
      id: newMasterId(),
      customerId: input.customerId,
      name,
      slug,
      status: input.status ?? 'draft',
      deploymentMode: input.deploymentMode ?? 'SAAS',
      createdAt: now,
      updatedAt: now,
      meta: input.meta,
    };
    return this.tenants.save(row);
  }

  async get(id: MasterId): Promise<MasterTenant> {
    if (this.official) {
      try {
        const managed = await this.official.get(id);
        await syncManagedTenantToLegacy(
          { tenants: this.tenants, customers: this.customers },
          managed,
        );
        const mirrored = await this.tenants.findById(id);
        if (mirrored) return mirrored;
      } catch {
        /* fallthrough legado */
      }
    }
    const row = await this.tenants.findById(id);
    if (!row) throw notFound('tenant', id);
    return row;
  }

  async update(id: MasterId, input: UpdateTenantInput): Promise<MasterTenant> {
    if (this.official) {
      const managed = await this.official.update(id, {
        company: input.name != null ? { name: input.name.trim() } : undefined,
        mode: input.deploymentMode,
        meta: input.meta,
      });
      await syncManagedTenantToLegacy(
        { tenants: this.tenants, customers: this.customers },
        managed,
      );
      const mirrored = await this.tenants.findById(id);
      if (mirrored) return mirrored;
    }
    const current = await this.get(id);
    if (input.name != null) {
      const name = input.name.trim();
      if (!name) throw invalid('name cannot be empty');
      current.name = name;
    }
    if (input.slug != null) {
      const slug = slugify(input.slug);
      if (!slug) throw invalid('slug cannot be empty');
      const other = await this.tenants.findBySlug(slug);
      if (other && other.id !== id) throw conflict(`tenant slug already exists: ${slug}`);
      current.slug = slug;
    }
    if (input.deploymentMode) current.deploymentMode = input.deploymentMode;
    if (input.meta !== undefined) current.meta = input.meta;
    current.updatedAt = nowIso();
    return this.tenants.save(current);
  }

  async list(): Promise<MasterTenant[]> {
    if (this.official) {
      const managed = await this.official.list();
      const mirror = { tenants: this.tenants, customers: this.customers };
      for (const row of managed) {
        await syncManagedTenantToLegacy(mirror, row);
      }
      return this.tenants.list();
    }
    return this.tenants.list();
  }

  async listByCustomer(customerId: MasterId): Promise<MasterTenant[]> {
    return this.tenants.listByCustomer(customerId);
  }

  /** Persistência interna usada por Block/Unlock/Activation — sem API pública. */
  async save(tenant: MasterTenant): Promise<MasterTenant> {
    tenant.updatedAt = nowIso();
    return this.tenants.save(tenant);
  }
}
