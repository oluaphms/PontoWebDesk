import { invalid, notFound } from '../errors.js';
import type { TenantRepository } from '../ports/repositories.js';
import type { MasterDeploymentMode, MasterId, MasterTenant } from '../types.js';
import { nowIso } from '../utils.js';

export type DeploymentControlTarget = {
  tenantId: MasterId;
  mode: MasterDeploymentMode;
};

/**
 * DeploymentControlService — intenção de modo SAAS|LOCAL|HYBRID por tenant.
 * Não altera DeploymentManager/runtime do produto; só registra controle Master.
 */
export class DeploymentControlService {
  constructor(private readonly tenants: TenantRepository) {}

  async getMode(tenantId: MasterId): Promise<MasterDeploymentMode> {
    const tenant = await this.tenants.findById(tenantId);
    if (!tenant) throw notFound('tenant', tenantId);
    return tenant.deploymentMode;
  }

  async setMode(tenantId: MasterId, mode: MasterDeploymentMode): Promise<MasterTenant> {
    if (mode !== 'SAAS' && mode !== 'LOCAL' && mode !== 'HYBRID') {
      throw invalid(`invalid deployment mode: ${String(mode)}`);
    }
    const tenant = await this.tenants.findById(tenantId);
    if (!tenant) throw notFound('tenant', tenantId);
    tenant.deploymentMode = mode;
    tenant.updatedAt = nowIso();
    tenant.meta = {
      ...tenant.meta,
      deploymentControl: {
        mode,
        updatedAt: tenant.updatedAt,
        source: 'master_deployment_control',
      },
    };
    return this.tenants.save(tenant);
  }

  async listTargets(): Promise<DeploymentControlTarget[]> {
    const all = await this.tenants.list();
    return all.map((t) => ({ tenantId: t.id, mode: t.deploymentMode }));
  }
}
