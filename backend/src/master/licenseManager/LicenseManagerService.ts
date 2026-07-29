/**
 * License Manager — controle comercial de licenças por empresa.
 *
 * InMemory. Sem integração externa.
 * Flags de bloqueio são metadata Master — NÃO alteram autenticação operacional.
 */
import { randomUUID } from 'node:crypto';
import { conflict, invalid, notFound } from '../errors.js';
import { logger } from '../../logger/logger.js';
import {
  buildCommercialLicenseViewState,
  evaluateCommercialLicense,
} from '../license/licenseValidity.js';
import type {
  CompanyLicense,
  CreateCompanyLicenseInput,
  LicenseControlRules,
  LicenseManagerAction,
  LicenseMode,
  LicenseRuleOverrides,
  LicenseStatus,
  UpdateCompanyLicenseInput,
} from './types.js';
import { DEFAULT_EXPIRY_WARNING_DAYS, LICENSE_MODES, LICENSE_STATUSES } from './types.js';
import type { LicenseManagerStore } from './ports/LicenseManagerStore.js';
import { InMemoryLicenseManagerStore } from './adapters/InMemoryLicenseManagerStore.js';
import { appendLicenseHistory } from './composeLicenseCentral.js';

function nowIso(): string {
  return new Date().toISOString();
}

function daysRemaining(expiresAt: string | null, now = Date.now()): number | null {
  if (!expiresAt) return null;
  const exp = Date.parse(expiresAt);
  if (!Number.isFinite(exp)) return null;
  return Math.ceil((exp - now) / 86_400_000);
}

function assertMode(mode: string): asserts mode is LicenseMode {
  if (!(LICENSE_MODES as readonly string[]).includes(mode)) {
    throw invalid(`mode must be one of: ${LICENSE_MODES.join(', ')}`);
  }
}

function assertStatus(status: string): asserts status is LicenseStatus {
  if (!(LICENSE_STATUSES as readonly string[]).includes(status)) {
    throw invalid(`status must be one of: ${LICENSE_STATUSES.join(', ')}`);
  }
}

/**
 * Defaults de regras por status.
 * Somente leitura / avisos — não executam bloqueio operacional.
 */
export function defaultRulesForStatus(
  status: LicenseStatus,
  expiresAt: string | null,
  warningDays = DEFAULT_EXPIRY_WARNING_DAYS,
): LicenseControlRules {
  const remaining = daysRemaining(expiresAt);
  const expiredByDate = remaining != null && remaining < 0;
  const effective: LicenseStatus =
    status === 'Bloqueada'
      ? 'Bloqueada'
      : status === 'Expirada' || expiredByDate
        ? 'Expirada'
        : status;

  const base: LicenseControlRules = {
    blockLogin: false,
    blockApi: false,
    blockRep: false,
    blockMobile: false,
    readOnly: false,
    expiryWarning: remaining != null && remaining >= 0 && remaining <= warningDays,
    daysRemaining: remaining,
  };

  if (effective === 'Bloqueada') {
    return {
      ...base,
      blockLogin: true,
      blockApi: true,
      blockRep: true,
      blockMobile: true,
      readOnly: true,
      expiryWarning: true,
    };
  }

  if (effective === 'Expirada') {
    return {
      ...base,
      blockLogin: true,
      blockApi: true,
      blockRep: true,
      blockMobile: true,
      readOnly: true,
      expiryWarning: true,
      daysRemaining: remaining,
    };
  }

  if (effective === 'Trial') {
    return {
      ...base,
      readOnly: false,
      expiryWarning: remaining != null && remaining <= Math.min(warningDays, 7),
    };
  }

  // Ativa
  return base;
}

export function resolveRules(
  status: LicenseStatus,
  expiresAt: string | null,
  overrides: LicenseRuleOverrides = {},
  warningDays = DEFAULT_EXPIRY_WARNING_DAYS,
): LicenseControlRules {
  const defaults = defaultRulesForStatus(status, expiresAt, warningDays);
  return {
    blockLogin: overrides.blockLogin ?? defaults.blockLogin,
    blockApi: overrides.blockApi ?? defaults.blockApi,
    blockRep: overrides.blockRep ?? defaults.blockRep,
    blockMobile: overrides.blockMobile ?? defaults.blockMobile,
    readOnly: overrides.readOnly ?? defaults.readOnly,
    expiryWarning: overrides.expiryWarning ?? defaults.expiryWarning,
    daysRemaining: defaults.daysRemaining,
  };
}

function refreshRow(row: CompanyLicense): CompanyLicense {
  let status = row.status;
  // Expirada imediatamente após 23:59:59 BRT do último dia (sem tolerância).
  const evaluation = evaluateCommercialLicense({
    startsAt: row.startsAt,
    expiresAt: row.expiresAt,
  });
  if (status !== 'Bloqueada' && evaluation.phase === 'expired') {
    status = 'Expirada';
  }
  const validity = buildCommercialLicenseViewState({
    startsAt: row.startsAt,
    expiresAt: row.expiresAt,
    licenseStatus: status,
  });
  return {
    ...row,
    status,
    validity,
    rules: resolveRules(status, row.expiresAt, row.ruleOverrides),
  };
}

export class LicenseManagerService {
  private readonly store: LicenseManagerStore;
  private seeded = false;

  constructor(store?: LicenseManagerStore) {
    this.store = store ?? new InMemoryLicenseManagerStore();
  }

  static createInMemory(): LicenseManagerService {
    return new LicenseManagerService(new InMemoryLicenseManagerStore());
  }

  /**
   * Seed demo — SOMENTE sob solicitação explícita.
   * Não é chamado por list/get. Requer MASTER_LICENSE_DEMO_SEED=true
   * (ou force=true em testes/scripts).
   */
  async ensureSeed(options: { force?: boolean } = {}): Promise<void> {
    const allowed =
      options.force === true ||
      String(process.env.MASTER_LICENSE_DEMO_SEED || '').toLowerCase() === 'true';
    if (!allowed) return;
    if (this.seeded) return;
    const existing = await this.store.list();
    if (existing.length > 0) {
      this.seeded = true;
      return;
    }
    const demos: CreateCompanyLicenseInput[] = [
      {
        tenantId: 'tn_saas_demo',
        empresa: 'Demo SAAS Ativa',
        mode: 'SAAS',
        status: 'Ativa',
        plan: 'PRO',
        durationDays: 90,
      },
      {
        tenantId: 'tn_local_demo',
        empresa: 'Demo LOCAL Trial',
        mode: 'LOCAL',
        status: 'Trial',
        plan: 'LOCAL',
        durationDays: 14,
      },
      {
        tenantId: 'tn_hybrid_demo',
        empresa: 'Demo HYBRID Expirando',
        mode: 'HYBRID',
        status: 'Ativa',
        plan: 'HYBRID',
        durationDays: 10,
      },
      {
        tenantId: 'tn_blocked_demo',
        empresa: 'Demo Bloqueada',
        mode: 'SAAS',
        status: 'Bloqueada',
        plan: 'BASIC',
        durationDays: 30,
      },
    ];
    for (const d of demos) {
      await this.create(d);
    }
    this.seeded = true;
  }

  async list(): Promise<CompanyLicense[]> {
    const rows = await this.store.list();
    const refreshed: CompanyLicense[] = [];
    for (const row of rows) {
      const next = refreshRow(row);
      if (next.status !== row.status || next.rules.daysRemaining !== row.rules.daysRemaining) {
        await this.store.save({ ...next, updatedAt: nowIso() });
      }
      refreshed.push(next);
    }
    return refreshed;
  }

  async get(id: string): Promise<CompanyLicense> {
    const row = await this.store.get(id);
    if (!row) throw notFound('company_license', id);
    return refreshRow(row);
  }

  async getByTenantId(tenantId: string): Promise<CompanyLicense | null> {
    const row = await this.store.getByTenantId(tenantId);
    return row ? refreshRow(row) : null;
  }

  /**
   * Resolve licença do tenant Master.
   * Compat: licenças legadas gravadas com tenant_id = CNPJ (não tn_*).
   * Quando encontra pelo documento, religa tenant_id ao id canônico do tenant.
   */
  async resolveForTenant(tenant: {
    id: string;
    company?: { document?: string | null } | null;
  }): Promise<CompanyLicense | null> {
    const tenantId = String(tenant?.id || '').trim();
    if (!tenantId) return null;
    const document = String(tenant?.company?.document || '').trim();
    const digits = document.replace(/\D/g, '');
    const keys = [...new Set([tenantId, document, digits].filter((k) => Boolean(k)))];

    let found: CompanyLicense | null = null;
    for (const key of keys) {
      const row = await this.store.getByTenantId(key);
      if (row) {
        found = refreshRow(row);
        break;
      }
    }
    if (!found) return null;

    if (found.tenantId !== tenantId) {
      const healed = {
        ...found,
        tenantId,
        updatedAt: nowIso(),
        meta: {
          ...(found.meta && typeof found.meta === 'object' ? found.meta : {}),
          operationalAuthWired: true,
          relinkedFromTenantId: found.tenantId,
        },
      };
      await this.store.save(healed);
      return healed;
    }
    return found;
  }

  async create(input: CreateCompanyLicenseInput): Promise<CompanyLicense> {
    const tenantId = String(input.tenantId || '').trim();
    if (!tenantId) throw invalid('tenantId is required');

    const existing = await this.store.getByTenantId(tenantId);
    if (existing) throw conflict(`license already exists for tenant: ${tenantId}`);

    const mode = input.mode ?? 'SAAS';
    assertMode(mode);
    const status = input.status ?? 'Trial';
    assertStatus(status);

    const now = nowIso();
    // Trial=14; admin sem expiresAt/durationDays=365. Planos pagos devem passar
    // expiresAt = master_subscriptions.expires_at (não usar 365 fixo na jornada).
    const defaultDays = status === 'Trial' ? 14 : 365;
    const durationDays = input.durationDays ?? defaultDays;
    const expiresAt =
      input.expiresAt !== undefined
        ? input.expiresAt
        : new Date(Date.now() + durationDays * 86_400_000).toISOString();

    const ruleOverrides = { ...(input.ruleOverrides || {}) };
    const row: CompanyLicense = {
      id: `lic_${randomUUID().replace(/-/g, '').slice(0, 12)}`,
      tenantId,
      empresa: String(input.empresa || tenantId).trim() || tenantId,
      mode,
      status,
      plan: String(input.plan || 'BASIC').trim() || 'BASIC',
      startsAt: input.startsAt || now,
      expiresAt,
      ruleOverrides,
      rules: resolveRules(status, expiresAt, ruleOverrides),
      blockedAt: status === 'Bloqueada' ? now : null,
      blockedReason: status === 'Bloqueada' ? 'created_blocked' : null,
      createdAt: now,
      updatedAt: now,
      meta: { simulated: true, operationalAuthWired: false },
    };
    return this.store.save(row);
  }

  async update(id: string, input: UpdateCompanyLicenseInput): Promise<CompanyLicense> {
    const current = await this.get(id);
    if (input.mode) assertMode(input.mode);
    const ruleOverrides = {
      ...current.ruleOverrides,
      ...(input.ruleOverrides || {}),
    };
    const expiresAt =
      input.expiresAt !== undefined ? input.expiresAt : current.expiresAt;
    const startsAt =
      input.startsAt !== undefined && String(input.startsAt || '').trim()
        ? String(input.startsAt).trim()
        : current.startsAt;
    const meta: Record<string, unknown> = { ...(current.meta || {}) };
    if (input.maxEmployees !== undefined) {
      meta.maxEmployees =
        input.maxEmployees == null ? null : Math.max(0, Math.floor(Number(input.maxEmployees)));
      meta.maxUsers = meta.maxEmployees;
    }
    if (input.maxDevices !== undefined) {
      meta.maxDevices =
        input.maxDevices == null ? null : Math.max(0, Math.floor(Number(input.maxDevices)));
    }
    if (input.licenseKey !== undefined) {
      meta.licenseKey = input.licenseKey?.trim() || null;
    }
    const next: CompanyLicense = {
      ...current,
      empresa: input.empresa?.trim() || current.empresa,
      mode: input.mode ?? current.mode,
      plan: input.plan?.trim() || current.plan,
      startsAt,
      expiresAt,
      ruleOverrides,
      rules: resolveRules(current.status, expiresAt, ruleOverrides),
      updatedAt: nowIso(),
      meta,
    };
    return this.store.save(next);
  }

  async setRules(id: string, overrides: LicenseRuleOverrides): Promise<CompanyLicense> {
    return this.update(id, { ruleOverrides: overrides });
  }

  async action(
    id: string,
    action: LicenseManagerAction,
    opts?: {
      durationDays?: number;
      /** Preferir master_subscriptions.expires_at em renovações/ativações pagas. */
      expiresAt?: string | null;
      reason?: string;
      actorEmail?: string | null;
    },
  ): Promise<CompanyLicense> {
    const current = await this.get(id);
    const now = nowIso();
    let next: CompanyLicense = { ...current, updatedAt: now };
    let meta: Record<string, unknown> = { ...(current.meta || {}) };

    switch (action) {
      case 'activate':
        next = {
          ...next,
          status: 'Ativa',
          blockedAt: null,
          blockedReason: null,
          expiresAt:
            opts?.expiresAt !== undefined
              ? opts.expiresAt
              : next.expiresAt && daysRemaining(next.expiresAt)! >= 0
                ? next.expiresAt
                : new Date(Date.now() + (opts?.durationDays ?? 365) * 86_400_000).toISOString(),
        };
        meta = { ...meta, blockKind: null };
        break;
      case 'set_trial':
        next = {
          ...next,
          status: 'Trial',
          blockedAt: null,
          blockedReason: null,
          expiresAt:
            opts?.expiresAt !== undefined
              ? opts.expiresAt
              : new Date(
                  Date.now() + (opts?.durationDays ?? 14) * 86_400_000,
                ).toISOString(),
        };
        meta = { ...meta, blockKind: null };
        break;
      case 'block':
        next = {
          ...next,
          status: 'Bloqueada',
          blockedAt: now,
          blockedReason: opts?.reason?.trim() || 'blocked_by_master',
        };
        meta = { ...meta, blockKind: 'blocked' };
        break;
      case 'suspend':
        next = {
          ...next,
          status: 'Bloqueada',
          blockedAt: now,
          blockedReason: opts?.reason?.trim() || 'suspended_by_master',
        };
        meta = { ...meta, blockKind: 'suspended' };
        break;
      case 'unblock':
        if (current.status !== 'Bloqueada') throw conflict('license is not blocked');
        next = {
          ...next,
          status:
            current.expiresAt && (daysRemaining(current.expiresAt) ?? 0) < 0
              ? 'Expirada'
              : 'Ativa',
          blockedAt: null,
          blockedReason: null,
        };
        meta = { ...meta, blockKind: null };
        break;
      case 'reactivate': {
        const expired =
          current.expiresAt != null && (daysRemaining(current.expiresAt) ?? 0) < 0;
        next = {
          ...next,
          status: 'Ativa',
          blockedAt: null,
          blockedReason: null,
          expiresAt:
            opts?.expiresAt !== undefined
              ? opts.expiresAt
              : expired
                ? new Date(Date.now() + (opts?.durationDays ?? 365) * 86_400_000).toISOString()
                : current.expiresAt,
        };
        meta = { ...meta, blockKind: null };
        break;
      }
      case 'expire':
        next = {
          ...next,
          status: 'Expirada',
          expiresAt: now,
        };
        break;
      case 'renew': {
        // Admin: durationDays (default 365). SaaS pago: passar expiresAt da assinatura.
        const expiresAt =
          opts?.expiresAt !== undefined
            ? opts.expiresAt
            : (() => {
                const days = opts?.durationDays ?? 365;
                const base =
                  current.expiresAt && daysRemaining(current.expiresAt)! > 0
                    ? Date.parse(current.expiresAt)
                    : Date.now();
                return new Date(base + days * 86_400_000).toISOString();
              })();
        next = {
          ...next,
          status: current.status === 'Bloqueada' ? 'Bloqueada' : 'Ativa',
          expiresAt,
          blockedAt: current.status === 'Bloqueada' ? current.blockedAt : null,
          blockedReason: current.status === 'Bloqueada' ? current.blockedReason : null,
        };
        break;
      }
      case 'set_mode_saas':
        next = { ...next, mode: 'SAAS' };
        break;
      case 'set_mode_local':
        next = { ...next, mode: 'LOCAL' };
        break;
      case 'set_mode_hybrid':
        next = { ...next, mode: 'HYBRID' };
        break;
      case 'delete': {
        const removed = await this.store.delete(id);
        if (!removed) throw notFound('license', id);
        logger.info({
          module: 'master.licenseManager',
          action: 'LICENSE_DELETED',
          message: 'License deleted',
          meta: {
            license_id: current.id,
            tenant_id: current.tenantId,
            empresa: current.empresa,
            admin: opts?.actorEmail ?? null,
            reason: opts?.reason?.trim() || null,
            timestamp: now,
            result: 'ok',
            persistence: this.store.persistence ?? 'unknown',
          },
        });
        return current;
      }
      default:
        throw invalid(`unknown action: ${String(action)}`);
    }

    meta = appendLicenseHistory(meta, {
      at: now,
      action,
      reason: opts?.reason?.trim() || null,
      actorEmail: opts?.actorEmail ?? null,
    });

    next = {
      ...next,
      meta,
      rules: resolveRules(next.status, next.expiresAt, next.ruleOverrides),
    };
    return this.store.save(next);
  }

  async snapshot() {
    const rows = await this.list();
    const byMode = { SAAS: 0, LOCAL: 0, HYBRID: 0 };
    const byStatus = { Trial: 0, Ativa: 0, Expirada: 0, Bloqueada: 0 };
    let withExpiryWarning = 0;
    for (const r of rows) {
      byMode[r.mode] += 1;
      byStatus[r.status] += 1;
      if (r.rules.expiryWarning) withExpiryWarning += 1;
    }
    return {
      ok: true,
      count: rows.length,
      byMode,
      byStatus,
      withExpiryWarning,
      persistence: (this.store.persistence === 'postgres' ? 'postgres' : 'in_memory') as
        | 'in_memory'
        | 'postgres',
      operationalAuthWired: false as const,
      note: 'License Manager — flags Master only; autenticação operacional intacta',
    };
  }
}
