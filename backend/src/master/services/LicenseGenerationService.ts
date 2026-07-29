import { createHash, randomBytes } from 'node:crypto';
import { invalid, notFound } from '../errors.js';
import type {
  CustomerRepository,
  LicenseRecordRepository,
  TenantRepository,
} from '../ports/repositories.js';
import type { MasterId, MasterLicenseRecord, MasterLicenseTier } from '../types.js';
import { newMasterId, nowIso } from '../utils.js';

export type GenerateLicenseInput = {
  tenantId: MasterId;
  tier?: MasterLicenseTier;
  plan?: string;
  expiresAt?: string | null;
  modules?: string[];
  limits?: {
    maxUsers?: number | null;
    maxDevices?: number | null;
    maxCompanies?: number | null;
  };
  meta?: Record<string, unknown>;
};

/**
 * LicenseGenerationService — gera payload/chave de licença (em memória).
 * Não escreve em env do produto; não assina com HSM/cofre nesta fase.
 */
export class LicenseGenerationService {
  constructor(
    private readonly licenses: LicenseRecordRepository,
    private readonly tenants: TenantRepository,
    private readonly customers: CustomerRepository,
  ) {}

  async generate(input: GenerateLicenseInput): Promise<MasterLicenseRecord> {
    const tenant = await this.tenants.findById(input.tenantId);
    if (!tenant) throw notFound('tenant', input.tenantId);
    const customer = await this.customers.findById(tenant.customerId);
    if (!customer) throw notFound('customer', tenant.customerId);

    const tier: MasterLicenseTier = input.tier ?? 'standard';
    if (tier === 'none') throw invalid('cannot generate license with tier none');
    const plan = (input.plan || tier).toString();
    const generatedAt = nowIso();
    const key = `lic_${randomBytes(16).toString('hex')}`;
    const payload = {
      type: tier === 'trial' ? 'trial' : 'subscription',
      tier,
      plan,
      expiresAt: input.expiresAt ?? null,
      customerId: customer.id,
      tenantId: tenant.id,
      modules: input.modules ?? [],
      limits: {
        maxUsers: input.limits?.maxUsers ?? null,
        maxDevices: input.limits?.maxDevices ?? null,
        maxCompanies: input.limits?.maxCompanies ?? null,
      },
      generatedAt,
      meta: input.meta,
      fingerprint: createHash('sha256').update(`${tenant.id}:${key}:${generatedAt}`).digest('hex'),
    };

    const row: MasterLicenseRecord = {
      id: newMasterId(),
      tenantId: tenant.id,
      customerId: customer.id,
      tier,
      plan,
      payloadJson: JSON.stringify(payload),
      key,
      generatedAt,
      expiresAt: input.expiresAt ?? null,
      activatedAt: null,
      revokedAt: null,
    };
    return this.licenses.save(row);
  }

  async get(id: MasterId): Promise<MasterLicenseRecord> {
    const row = await this.licenses.findById(id);
    if (!row) throw notFound('license', id);
    return row;
  }

  async listByTenant(tenantId: MasterId): Promise<MasterLicenseRecord[]> {
    return this.licenses.listByTenant(tenantId);
  }

  async list(): Promise<MasterLicenseRecord[]> {
    return this.licenses.list();
  }

  async revoke(id: MasterId): Promise<MasterLicenseRecord> {
    const current = await this.get(id);
    current.revokedAt = nowIso();
    return this.licenses.save(current);
  }
}
