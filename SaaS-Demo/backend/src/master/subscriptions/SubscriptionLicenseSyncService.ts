/**
 * Mantém master_licenses.expires_at alinhado a master_subscriptions.expires_at.
 *
 * Política de cancelamento (documentada):
 * - Cancelamento NÃO trunca license.expires_at.
 * - Bloqueio imediato vem da projeção comercial (subscription CANCELLED),
 *   já aplicada em postCancelCompanyPlanController.
 * - O período pago permanece na licença para histórico/auditoria.
 *
 * Inadimplência financeira continua em due_at/block_at (não usa expires_at da licença).
 */
import { invalid, notFound } from '../errors.js';
import { addPlanCycle } from './subscriptionPeriodCalculator.js';
import type { SaasPlanCycle } from '../plans/saasPlans.types.js';
import {
  masterSql,
  type MasterSqlQuery,
} from '../adapters/postgres/masterSql.js';
import type { LicenseManagerService } from '../licenseManager/LicenseManagerService.js';
import type { CompanyLicense } from '../licenseManager/types.js';
import type { MasterTenantsService } from '../tenants/MasterTenantsService.js';
import type { MasterAuditPort } from '../registry/MasterRepositoryRegistry.js';
import { projectCommercialStateToSaas } from '../commercial/index.js';
import type { SubscriptionFinanceEntry } from '../subscriptionFinance/subscriptionFinance.types.js';
import {
  releaseCompanyAfterSubscriptionPayment,
  type ReleaseOnPaymentDeps,
  type ReleaseOnPaymentResult,
} from '../subscriptionNotifications/releaseOnPayment.js';
import {
  isTrialOrFreePlan,
  resolveLicenseExpiry,
} from './subscriptionLicensePeriod.js';
import type { SubscriptionService } from './subscription.service.js';

export type SubscriptionPeriodSnapshot = {
  id: string;
  tenantId: string;
  expiresAt: string;
  cycle: SaasPlanCycle;
  status: string;
  plan: string;
};

export type SubscriptionLicenseSyncDeps = {
  sql?: MasterSqlQuery;
  licenseManager: LicenseManagerService;
  tenants?: MasterTenantsService;
  /** Lifecycle in-memory (jornada / testes). */
  lifecycle?: SubscriptionService;
  audit?: MasterAuditPort;
};

export type OnPaymentConfirmedResult = {
  subscription: SubscriptionPeriodSnapshot | null;
  license: CompanyLicense | null;
  release: ReleaseOnPaymentResult | null;
  periodExtended: boolean;
};

type SubRow = {
  id: string;
  tenant_id: string;
  expires_at: Date | string | null;
  cycle: string | null;
  status: string;
  plan: string | null;
};

function normalizeCycle(raw: string | null | undefined): SaasPlanCycle {
  const c = String(raw || 'MONTHLY').trim().toUpperCase();
  return c === 'ANNUAL' ? 'ANNUAL' : 'MONTHLY';
}

function toIsoRequired(value: Date | string | null | undefined, field: string): string {
  if (value == null) throw invalid(`${field} is required`);
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw invalid(`${field} is invalid`);
    return value.toISOString();
  }
  const s = String(value).trim();
  if (!s || !Number.isFinite(Date.parse(s))) throw invalid(`${field} is invalid`);
  return new Date(s).toISOString();
}

export class SubscriptionLicenseSyncService {
  private readonly sql: MasterSqlQuery;

  constructor(private readonly deps: SubscriptionLicenseSyncDeps) {
    this.sql = deps.sql ?? masterSql;
  }

  /**
   * Carrega período atual da assinatura (postgres ou lifecycle in-memory).
   */
  async loadCurrentSubscription(
    tenantId: string,
  ): Promise<SubscriptionPeriodSnapshot | null> {
    const tid = String(tenantId || '').trim();
    if (!tid) return null;

    if (this.deps.lifecycle) {
      const sub = await this.deps.lifecycle.findCurrentByTenant(tid);
      if (sub?.expiresAt) {
        return {
          id: sub.id,
          tenantId: tid,
          expiresAt: sub.expiresAt,
          cycle: sub.periodicity === 'yearly' ? 'ANNUAL' : 'MONTHLY',
          status: sub.status,
          plan: sub.plan,
        };
      }
    }

    const result = await this.sql<SubRow>(
      `SELECT id, tenant_id, expires_at, cycle, status, plan
         FROM public.master_subscriptions
        WHERE tenant_id = $1
          AND status IN ('TRIAL','ACTIVE','PAST_DUE','SUSPENDED','PENDING_PAYMENT')
        ORDER BY created_at DESC
        LIMIT 1`,
      [tid],
    );
    const row = result.rows[0];
    if (!row?.expires_at) return null;
    return {
      id: row.id,
      tenantId: row.tenant_id,
      expiresAt: toIsoRequired(row.expires_at, 'expires_at'),
      cycle: normalizeCycle(row.cycle),
      status: row.status,
      plan: String(row.plan || ''),
    };
  }

  async loadSubscriptionById(
    subscriptionId: string,
  ): Promise<SubscriptionPeriodSnapshot | null> {
    const id = String(subscriptionId || '').trim();
    if (!id) return null;
    const result = await this.sql<SubRow>(
      `SELECT id, tenant_id, expires_at, cycle, status, plan
         FROM public.master_subscriptions
        WHERE id = $1
        LIMIT 1`,
      [id],
    );
    const row = result.rows[0];
    if (!row?.expires_at) return null;
    return {
      id: row.id,
      tenantId: row.tenant_id,
      expiresAt: toIsoRequired(row.expires_at, 'expires_at'),
      cycle: normalizeCycle(row.cycle),
      status: row.status,
      plan: String(row.plan || ''),
    };
  }

  /**
   * Alinha license.expires_at → subscription.expires_at (planos pagos).
   * TRIAL/FREE: não força sync (mantém regra de 14 dias).
   */
  async syncLicenseFromSubscription(
    tenantId: string,
    options: {
      subscriptionExpiresAt?: string | null;
      plan?: string | null;
      reason?: string;
      activateIfExpired?: boolean;
    } = {},
  ): Promise<CompanyLicense | null> {
    const tid = String(tenantId || '').trim();
    if (!tid) throw invalid('tenantId is required');

    const license = await this.deps.licenseManager.getByTenantId(tid);
    if (!license) return null;

    const plan = options.plan ?? license.plan;
    if (isTrialOrFreePlan(plan)) return license;

    let expiresAt = String(options.subscriptionExpiresAt || '').trim();
    if (!expiresAt) {
      const sub = await this.loadCurrentSubscription(tid);
      if (!sub) return license;
      expiresAt = sub.expiresAt;
    }

    const resolved = resolveLicenseExpiry({
      plan,
      subscriptionExpiresAt: expiresAt,
      requireSubscriptionForPaid: true,
    });

    let next = await this.deps.licenseManager.update(license.id, {
      expiresAt: resolved.expiresAt,
    });

    if (options.activateIfExpired !== false) {
      const overdueBlocked =
        next.status === 'Bloqueada' &&
        String(next.blockedReason || '').startsWith('subscription_overdue');
      if (next.status === 'Expirada' || overdueBlocked) {
        next = await this.deps.licenseManager.action(next.id, 'activate', {
          expiresAt: resolved.expiresAt,
          reason: options.reason || 'subscription_license_sync',
        });
      }
    }

    if (this.deps.tenants) {
      try {
        const tenant = await this.deps.tenants.get(tid);
        await projectCommercialStateToSaas({ tenant, license: next });
      } catch {
        // Tenant demo / sem empresa operacional.
      }
    }

    return next;
  }

  /**
   * Estende master_subscriptions.expires_at em +1 ciclo após pagamento confirmado.
   * Base = expires_at atual se ainda futuro; senão = now.
   */
  async extendSubscriptionPeriodOnPayment(
    subscriptionId: string,
    nowIso = new Date().toISOString(),
  ): Promise<{ before: SubscriptionPeriodSnapshot; after: SubscriptionPeriodSnapshot }> {
    const before = await this.loadSubscriptionById(subscriptionId);
    if (!before) throw notFound('subscription', subscriptionId);

    const baseMs = Date.parse(before.expiresAt);
    const nowMs = Date.parse(nowIso);
    const baseIso =
      Number.isFinite(baseMs) && baseMs > nowMs ? before.expiresAt : nowIso;
    const nextExpires = addPlanCycle(baseIso, before.cycle);

    const updated = await this.sql<SubRow>(
      `UPDATE public.master_subscriptions
          SET expires_at = $2::timestamptz,
              next_billing = $2::timestamptz,
              renewed_at = $3::timestamptz,
              status = CASE
                WHEN status IN ('PAST_DUE','SUSPENDED','PENDING_PAYMENT','EXPIRED') THEN 'ACTIVE'
                ELSE status
              END,
              suspended_at = null,
              updated_at = now()
        WHERE id = $1
        RETURNING id, tenant_id, expires_at, cycle, status, plan`,
      [subscriptionId, nextExpires, nowIso],
    );
    const row = updated.rows[0];
    if (!row?.expires_at) throw notFound('subscription', subscriptionId);

    const after: SubscriptionPeriodSnapshot = {
      id: row.id,
      tenantId: row.tenant_id,
      expiresAt: toIsoRequired(row.expires_at, 'expires_at'),
      cycle: normalizeCycle(row.cycle),
      status: row.status,
      plan: String(row.plan || ''),
    };

    if (this.deps.lifecycle) {
      try {
        await this.deps.lifecycle.renew(subscriptionId);
      } catch {
        // Lifecycle memory pode não ter o mesmo id — ok em postgres.
      }
    }

    return { before, after };
  }

  /**
   * Pagamento confirmado: estende período da assinatura, sync licença, libera inadimplência.
   */
  async onPaymentConfirmed(
    entry: SubscriptionFinanceEntry,
    releaseDeps?: Omit<ReleaseOnPaymentDeps, 'tenants'> & {
      tenants?: MasterTenantsService;
    },
  ): Promise<OnPaymentConfirmedResult> {
    let periodExtended = false;
    let subscription: SubscriptionPeriodSnapshot | null = null;

    try {
      const extended = await this.extendSubscriptionPeriodOnPayment(entry.subscriptionId);
      subscription = extended.after;
      periodExtended = true;
    } catch {
      subscription = await this.loadSubscriptionById(entry.subscriptionId);
    }

    const license = subscription
      ? await this.syncLicenseFromSubscription(entry.tenantId, {
          subscriptionExpiresAt: subscription.expiresAt,
          plan: subscription.plan,
          reason: `subscription_payment:${entry.id}`,
          activateIfExpired: true,
        })
      : await this.syncLicenseFromSubscription(entry.tenantId, {
          reason: `subscription_payment:${entry.id}`,
          activateIfExpired: true,
        });

    let release: ReleaseOnPaymentResult | null = null;
    const tenants = releaseDeps?.tenants ?? this.deps.tenants;
    const audit = releaseDeps?.audit ?? this.deps.audit;
    if (tenants && audit) {
      release = await releaseCompanyAfterSubscriptionPayment(entry, {
        tenants,
        audit,
        notifications: releaseDeps?.notifications,
        sql: releaseDeps?.sql ?? this.sql,
      });
    }

    return { subscription, license, release, periodExtended };
  }
}
