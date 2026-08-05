/**
 * TenantManager — cada tenant: Plano, Status, Modo, Tipo de instalação,
 * Licença, Empresa, Administrador, Domínio, Storage.
 *
 * Backend only. Sem frontend. Sem gateway de pagamento (Fase 6.6).
 */
import { randomUUID } from 'node:crypto';
import { conflict, invalid, notFound } from '../errors.js';
import {
  assertInstallationPlanCycle,
  installationTypeFromMode,
  modeFromInstallationType,
  parseInstallationType,
  planCycleFromInstallationType,
  type InstallationType,
} from '../commercial/installationType.js';
import type { TenantManagerStore } from './ports/TenantManagerStore.js';
import { InMemoryTenantManagerStore } from './adapters/InMemoryTenantManagerStore.js';
import type {
  CreateManagedTenantInput,
  ManagedTenant,
  TenantManagerStatus,
  UpdateManagedTenantInput,
} from './tenantManager.types.js';

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeDomain(domain: string): string {
  const d = String(domain || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/+$/, '');
  if (!d) throw invalid('domain is required');
  return d;
}

export class TenantManager {
  constructor(private readonly store: TenantManagerStore) {}

  static createInMemory(): TenantManager {
    return new TenantManager(new InMemoryTenantManagerStore());
  }

  async create(input: CreateManagedTenantInput): Promise<ManagedTenant> {
    const companyName = String(input.company?.name || '').trim();
    const adminEmail = String(input.admin?.email || '').trim().toLowerCase();
    const adminName = String(input.admin?.name || '').trim();
    if (!companyName) throw invalid('company.name is required');
    if (!adminEmail || !adminName) throw invalid('admin.name and admin.email are required');

    const domain = normalizeDomain(input.domain);
    const existing = await this.store.findByDomain(domain);
    if (existing) throw conflict(`domain already in use: ${domain}`);

    const installationType: InstallationType = input.installationType
      ? parseInstallationType(input.installationType)
      : input.mode
        ? installationTypeFromMode(input.mode)
        : 'SAAS_WEB';
    const mode = input.mode ?? modeFromInstallationType(installationType);
    const plan =
      input.plan ?? planCycleFromInstallationType(installationType);
    if (plan === 'MONTHLY' || plan === 'ANNUAL') {
      try {
        assertInstallationPlanCycle(installationType, plan);
      } catch (err) {
        throw invalid(err instanceof Error ? err.message : 'combinação instalação/plano inválida');
      }
    }

    const now = nowIso();
    const tenant: ManagedTenant = {
      id: `tn_${randomUUID().replace(/-/g, '').slice(0, 16)}`,
      operationalCompanyId: input.operationalCompanyId ?? null,
      plan,
      status: input.status ?? 'draft',
      mode,
      gateway: 'none',
      installationType,
      license: {
        licenseKey: input.license?.licenseKey ?? null,
        tier: input.license?.tier ?? null,
        localLicenseBound: input.license?.localLicenseBound ?? false,
        expiresAt: input.license?.expiresAt ?? null,
      },
      company: {
        name: companyName,
        document: input.company.document ?? null,
        tradeName: input.company.tradeName ?? null,
      },
      admin: {
        name: adminName,
        email: adminEmail,
        userId: input.admin.userId ?? null,
      },
      domain,
      storage: {
        driver: input.storage?.driver ?? 'local',
        bucket: input.storage?.bucket ?? null,
        prefix: input.storage?.prefix ?? domain,
        maxGb: input.storage?.maxGb ?? null,
        meta: input.storage?.meta,
      },
      createdAt: now,
      updatedAt: now,
      meta: input.meta,
    };

    return this.store.save(tenant);
  }

  async get(id: string): Promise<ManagedTenant> {
    const row = await this.store.findById(id);
    if (!row) throw notFound('tenant', id);
    return row;
  }

  async getByDomain(domain: string): Promise<ManagedTenant> {
    const row = await this.store.findByDomain(domain);
    if (!row) throw notFound('tenant_domain', domain);
    return row;
  }

  async update(id: string, input: UpdateManagedTenantInput): Promise<ManagedTenant> {
    const current = await this.get(id);

    if (input.operationalCompanyId !== undefined) {
      current.operationalCompanyId = input.operationalCompanyId;
    }
    if (input.domain != null) {
      const domain = normalizeDomain(input.domain);
      const other = await this.store.findByDomain(domain);
      if (other && other.id !== id) throw conflict(`domain already in use: ${domain}`);
      current.domain = domain;
    }
    if (input.plan) current.plan = input.plan;
    if (input.status) current.status = input.status;
    if (input.installationType) {
      current.installationType = parseInstallationType(input.installationType);
      // Mantém mode alinhado ao tipo comercial (compatibilidade).
      if (!input.mode) {
        current.mode = modeFromInstallationType(current.installationType);
      }
    }
    if (input.mode) {
      current.mode = input.mode;
      if (!input.installationType) {
        current.installationType = installationTypeFromMode(input.mode);
      }
    }
    // Fase 6.6 — gateway comercial removido; coluna permanece sempre 'none'.
    current.gateway = 'none';
    if (current.plan === 'MONTHLY' || current.plan === 'ANNUAL') {
      try {
        assertInstallationPlanCycle(current.installationType, current.plan);
      } catch (err) {
        throw invalid(err instanceof Error ? err.message : 'combinação instalação/plano inválida');
      }
    }
    if (input.license) current.license = { ...current.license, ...input.license };
    if (input.company) current.company = { ...current.company, ...input.company };
    if (input.admin) {
      current.admin = {
        ...current.admin,
        ...input.admin,
        email: input.admin.email
          ? input.admin.email.trim().toLowerCase()
          : current.admin.email,
      };
    }
    if (input.storage) current.storage = { ...current.storage, ...input.storage };
    if (input.meta) current.meta = { ...current.meta, ...input.meta };

    current.updatedAt = nowIso();
    return this.store.save(current);
  }

  async setStatus(id: string, status: TenantManagerStatus): Promise<ManagedTenant> {
    return this.update(id, { status });
  }

  async setPlan(id: string, plan: ManagedTenant['plan']): Promise<ManagedTenant> {
    return this.update(id, { plan });
  }

  async setMode(id: string, mode: ManagedTenant['mode']): Promise<ManagedTenant> {
    return this.update(id, { mode });
  }

  /** @deprecated Fase 6.6 — sempre força `none` (sem provedor). */
  async setGateway(id: string, _gateway?: ManagedTenant['gateway']): Promise<ManagedTenant> {
    return this.update(id, { gateway: 'none' });
  }

  async setInstallationType(id: string, installationType: InstallationType): Promise<ManagedTenant> {
    return this.update(id, { installationType });
  }

  async list(): Promise<ManagedTenant[]> {
    return this.store.list();
  }

  async listByStatus(status: TenantManagerStatus): Promise<ManagedTenant[]> {
    return (await this.list()).filter((t) => t.status === status);
  }

  async count(): Promise<number> {
    return (await this.list()).length;
  }

  async delete(id: string): Promise<boolean> {
    const row = await this.store.findById(id);
    if (!row) return false;
    return this.store.delete(id);
  }
}
