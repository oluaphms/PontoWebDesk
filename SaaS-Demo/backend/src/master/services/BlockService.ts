import { conflict, invalid, notFound } from '../errors.js';
import type { BlockRepository, TenantRepository } from '../ports/repositories.js';
import type { MasterBlockRecord, MasterId, MasterTenant } from '../types.js';
import { newMasterId, nowIso } from '../utils.js';

export type BlockTenantInput = {
  tenantId: MasterId;
  reason: string;
  blockedBy?: string | null;
};

/**
 * BlockService — bloqueia tenant no registro Master legado (Dashboard).
 *
 * @deprecated Fase 6.2: o caminho oficial de bloqueio administrativo é
 * `MasterTenantsService.applyAction('block')` via
 * `POST /api/master/tenants/:id/actions/block`, que projeta
 * `companies.commercial_blocked` e revoga sessões. Este serviço não aplica
 * middleware/HTTP nem projeção comercial no SaaS.
 */
export class BlockService {
  constructor(
    private readonly blocks: BlockRepository,
    private readonly tenants: TenantRepository,
  ) {}

  async block(input: BlockTenantInput): Promise<{
    block: MasterBlockRecord;
    tenant: MasterTenant;
  }> {
    const reason = String(input.reason || '').trim();
    if (!reason) throw invalid('reason is required');
    const tenant = await this.tenants.findById(input.tenantId);
    if (!tenant) throw notFound('tenant', input.tenantId);
    const active = await this.blocks.findActiveByTenant(tenant.id);
    if (active) throw conflict('tenant already blocked');

    const now = nowIso();
    const block: MasterBlockRecord = {
      id: newMasterId(),
      tenantId: tenant.id,
      reason,
      blockedAt: now,
      blockedBy: input.blockedBy ?? null,
      unlockedAt: null,
      unlockedBy: null,
    };
    await this.blocks.save(block);

    tenant.status = 'blocked';
    tenant.blockedAt = now;
    tenant.blockedReason = reason;
    tenant.updatedAt = now;
    const saved = await this.tenants.save(tenant);
    return { block, tenant: saved };
  }

  async getActiveBlock(tenantId: MasterId): Promise<MasterBlockRecord | null> {
    return this.blocks.findActiveByTenant(tenantId);
  }

  async listByTenant(tenantId: MasterId): Promise<MasterBlockRecord[]> {
    return this.blocks.listByTenant(tenantId);
  }
}
