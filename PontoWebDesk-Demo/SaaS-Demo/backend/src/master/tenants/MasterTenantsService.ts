/**
 * MasterTenantsService — cadastro de empresas do Painel Master.
 *
 * Separado do Companies operacional. Usa adapters (InMemory hoje;
 * preparado para HTTP/DB no futuro). Sem migrations.
 *
 * Fase 6.1 — status de licença da empresa/tenant:
 *   ACTIVE | TRIAL | SUSPENDED | BLOCKED | CANCELLED
 * Persistidos em lowercase; mudam só via actions.
 */
import { invalid } from '../errors.js';
import { TenantManager } from '../tenantManager/TenantManager.js';
import type { TenantManagerStore } from '../tenantManager/ports/TenantManagerStore.js';
import { InMemoryTenantManagerStore } from '../tenantManager/adapters/InMemoryTenantManagerStore.js';
import type {
  CreateManagedTenantInput,
  ManagedTenant,
  TenantManagerStatus,
  UpdateManagedTenantInput,
} from '../tenantManager/tenantManager.types.js';
import { normalizeCompanyStatusWire } from '../license/companyLicenseStatus.js';

export type MasterTenantAction =
  | 'block'
  | 'unblock'
  | 'suspend'
  | 'cancel'
  | 'activate'
  | 'start_trial';

export const MASTER_TENANT_ACTIONS: readonly MasterTenantAction[] = [
  'block',
  'unblock',
  'suspend',
  'cancel',
  'activate',
  'start_trial',
] as const;

const ACTION_STATUS: Record<MasterTenantAction, TenantManagerStatus> = {
  block: 'blocked',
  unblock: 'active',
  suspend: 'suspended',
  cancel: 'cancelled',
  activate: 'active',
  start_trial: 'trial',
};

export type MasterTenantsListFilter = {
  q?: string;
  plan?: string;
  mode?: string;
  status?: string;
};

export class MasterTenantsService {
  private readonly manager: TenantManager;

  constructor(store: TenantManagerStore) {
    this.manager = new TenantManager(store);
  }

  /** Adapter InMemory — troca futura por store HTTP/DB sem mudar a API. */
  static createInMemory(store?: TenantManagerStore): MasterTenantsService {
    return new MasterTenantsService(store ?? new InMemoryTenantManagerStore());
  }

  /** Expõe o TenantManager subjacente (compat MasterPlatformService). */
  getManager(): TenantManager {
    return this.manager;
  }

  async list(filter?: MasterTenantsListFilter): Promise<ManagedTenant[]> {
    let rows = await this.manager.list();
    if (filter?.plan) rows = rows.filter((t) => t.plan === filter.plan);
    if (filter?.mode) rows = rows.filter((t) => t.mode === filter.mode);
    if (filter?.status) {
      const statusWire = normalizeCompanyStatusWire(filter.status) ?? filter.status;
      rows = rows.filter((t) => t.status === statusWire);
    }
    const q = String(filter?.q || '')
      .trim()
      .toLowerCase();
    if (q) {
      rows = rows.filter((t) => {
        const hay = [
          t.company.name,
          t.company.document || '',
          t.company.tradeName || '',
          t.admin.name,
          t.admin.email,
          t.domain,
          t.plan,
          t.mode,
          t.status,
        ]
          .join(' ')
          .toLowerCase();
        return hay.includes(q);
      });
    }
    return rows.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  }

  async get(id: string): Promise<ManagedTenant> {
    return this.manager.get(id);
  }

  async create(input: CreateManagedTenantInput): Promise<ManagedTenant> {
    return this.manager.create(input);
  }

  async update(id: string, input: UpdateManagedTenantInput): Promise<ManagedTenant> {
    // Status muda só via actions — evita bypass de regras.
    const { status: _status, ...safe } = input;
    return this.manager.update(id, safe);
  }

  async applyAction(
    id: string,
    action: MasterTenantAction,
    meta?: { reason?: string },
  ): Promise<ManagedTenant> {
    if (!MASTER_TENANT_ACTIONS.includes(action)) {
      throw invalid(`invalid tenant action: ${action}`);
    }
    const current = await this.manager.get(id);
    const nextStatus = ACTION_STATUS[action];

    if (action === 'unblock' && current.status !== 'blocked' && current.status !== 'suspended') {
      throw invalid(`cannot unblock tenant in status: ${current.status}`);
    }
    if (action === 'block' && current.status === 'cancelled') {
      throw invalid('cannot block a cancelled tenant');
    }
    if (action === 'start_trial' && current.status === 'cancelled') {
      throw invalid('cannot start trial on a cancelled tenant');
    }
    if (action === 'cancel' && current.status === 'cancelled') {
      return current;
    }
    if (action === 'start_trial' && current.status === 'trial') {
      return current;
    }

    const updated = await this.manager.setStatus(id, nextStatus);
    if (meta?.reason) {
      return this.manager.update(id, {
        meta: {
          ...updated.meta,
          lastAction: action,
          lastActionReason: meta.reason,
          lastActionAt: new Date().toISOString(),
        },
      });
    }
    return updated;
  }

  async count(): Promise<number> {
    return this.manager.count();
  }

  async delete(id: string): Promise<boolean> {
    return this.manager.delete(id);
  }
}
