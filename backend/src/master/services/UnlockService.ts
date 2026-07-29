import { conflict, notFound } from '../errors.js';
import type { BlockRepository, TenantRepository } from '../ports/repositories.js';
import type { MasterBlockRecord, MasterId, MasterTenant } from '../types.js';
import { nowIso } from '../utils.js';

export type UnlockTenantInput = {
  tenantId: MasterId;
  unlockedBy?: string | null;
  /** Status após unlock (default active). */
  restoreStatus?: 'active' | 'draft' | 'suspended';
};

/**
 * UnlockService — remove bloqueio ativo do tenant no registro Master.
 * Não reaplica policies de runtime do produto nesta fase.
 */
export class UnlockService {
  constructor(
    private readonly blocks: BlockRepository,
    private readonly tenants: TenantRepository,
  ) {}

  async unlock(input: UnlockTenantInput): Promise<{
    block: MasterBlockRecord;
    tenant: MasterTenant;
  }> {
    const tenant = await this.tenants.findById(input.tenantId);
    if (!tenant) throw notFound('tenant', input.tenantId);
    const active = await this.blocks.findActiveByTenant(tenant.id);
    if (!active) throw conflict('tenant is not blocked');

    const now = nowIso();
    active.unlockedAt = now;
    active.unlockedBy = input.unlockedBy ?? null;
    await this.blocks.save(active);

    tenant.status = input.restoreStatus ?? 'active';
    tenant.blockedAt = null;
    tenant.blockedReason = null;
    tenant.updatedAt = now;
    const saved = await this.tenants.save(tenant);
    return { block: active, tenant: saved };
  }
}
