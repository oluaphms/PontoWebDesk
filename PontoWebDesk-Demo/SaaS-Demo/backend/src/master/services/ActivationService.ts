import { conflict, invalid, notFound } from '../errors.js';
import type {
  ActivationRepository,
  LicenseRecordRepository,
  TenantRepository,
} from '../ports/repositories.js';
import type { MasterActivationRecord, MasterId, MasterTenant } from '../types.js';
import { newMasterId, nowIso } from '../utils.js';

export type ActivateInput = {
  tenantId: MasterId;
  licenseId: MasterId;
  activatedBy?: string | null;
  note?: string | null;
};

/**
 * ActivationService — ativa licença / tenant no registro Master.
 * Não altera runtime LicenseService do produto nesta fase.
 */
export class ActivationService {
  constructor(
    private readonly activations: ActivationRepository,
    private readonly licenses: LicenseRecordRepository,
    private readonly tenants: TenantRepository,
  ) {}

  async activate(input: ActivateInput): Promise<{
    activation: MasterActivationRecord;
    tenant: MasterTenant;
  }> {
    const tenant = await this.tenants.findById(input.tenantId);
    if (!tenant) throw notFound('tenant', input.tenantId);
    if (tenant.status === 'blocked') {
      throw conflict('tenant is blocked; unlock before activation');
    }
    const license = await this.licenses.findById(input.licenseId);
    if (!license) throw notFound('license', input.licenseId);
    if (license.tenantId !== tenant.id) {
      throw invalid('license does not belong to tenant');
    }
    if (license.revokedAt) throw conflict('license is revoked');
    if (license.expiresAt && Date.parse(license.expiresAt) < Date.now()) {
      throw conflict('license is expired');
    }

    const now = nowIso();
    license.activatedAt = now;
    await this.licenses.save(license);

    const activation: MasterActivationRecord = {
      id: newMasterId(),
      tenantId: tenant.id,
      licenseId: license.id,
      activatedAt: now,
      activatedBy: input.activatedBy ?? null,
      note: input.note ?? null,
    };
    await this.activations.save(activation);

    tenant.status = 'active';
    tenant.activatedAt = now;
    tenant.updatedAt = now;
    const saved = await this.tenants.save(tenant);
    return { activation, tenant: saved };
  }

  async listByTenant(tenantId: MasterId): Promise<MasterActivationRecord[]> {
    return this.activations.listByTenant(tenantId);
  }

  async list(): Promise<MasterActivationRecord[]> {
    return this.activations.list();
  }
}
