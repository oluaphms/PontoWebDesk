import { randomUUID } from 'node:crypto';
import { conflict, invalid, notFound } from '../errors.js';
import {
  assertInstallationPlanCycle,
  installationTypeFromMode,
  type InstallationType,
} from '../commercial/installationType.js';
import { masterSql, toIso, toIsoRequired, type MasterSqlQuery } from '../adapters/postgres/masterSql.js';
import {
  SAAS_PLAN_CYCLES,
  SAAS_SUBSCRIPTION_STATUSES,
  type AssignCompanyPlanInput,
  type CompanyPlanSubscription,
  type CreateSaasPlanInput,
  type SaasPlan,
  type SaasPlanCycle,
  type SaasSubscriptionStatus,
  type UpdateSaasPlanInput,
} from './saasPlans.types.js';
import { calculateSubscriptionExpiresAt } from '../subscriptions/subscriptionPeriodCalculator.js';

type PlanRow = {
  id: string;
  name: string;
  cycle: string;
  price_cents: number | string;
  employee_limit: number | string;
  user_limit: number | string;
  enabled_modules: string[] | null;
  active: boolean;
  created_at: Date | string;
  updated_at: Date | string;
};

type TenantRow = {
  id: string;
  operational_company_id: string | null;
  company_name: string;
  admin_user_id: string | null;
  installation_type?: string | null;
  mode?: string | null;
};

type SubscriptionRow = {
  id: string;
  tenant_id: string;
  company_id: string | null;
  plan_id: string;
  plan_name: string;
  cycle: string;
  starts_at: Date | string;
  expires_at: Date | string;
  status: string;
  amount_cents: number | string;
  created_at: Date | string;
  updated_at: Date | string;
  cancelled_at: Date | string | null;
  company_name: string;
};

function cleanModules(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.map((v) => String(v).trim()).filter(Boolean))].sort();
}

function nonNegativeInt(value: unknown, field: string): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw invalid(`${field} must be >= 0`);
  return Math.floor(n);
}

function assertCycle(value: unknown): SaasPlanCycle {
  const cycle = String(value || '').trim().toUpperCase() as SaasPlanCycle;
  if (!SAAS_PLAN_CYCLES.includes(cycle)) throw invalid('cycle must be MONTHLY or ANNUAL');
  return cycle;
}

function assertStatus(value: unknown): SaasSubscriptionStatus {
  const status = String(value || '').trim().toUpperCase() as SaasSubscriptionStatus;
  if (!SAAS_SUBSCRIPTION_STATUSES.includes(status)) {
    throw invalid(`status must be one of: ${SAAS_SUBSCRIPTION_STATUSES.join(', ')}`);
  }
  return status;
}

function normalizeStartDate(value: string | undefined): string {
  if (!value) return new Date().toISOString();
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw invalid('startsAt is invalid');
  return date.toISOString();
}

function mapPlan(row: PlanRow): SaasPlan {
  return {
    id: row.id,
    name: row.name,
    cycle: row.cycle as SaasPlanCycle,
    priceCents: Number(row.price_cents) || 0,
    employeeLimit: Number(row.employee_limit) || 0,
    userLimit: Number(row.user_limit) || 0,
    enabledModules: row.enabled_modules ?? [],
    active: row.active === true,
    createdAt: toIsoRequired(row.created_at),
    updatedAt: toIsoRequired(row.updated_at),
  };
}

function mapSubscription(row: SubscriptionRow): CompanyPlanSubscription {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    companyId: row.company_id || row.tenant_id,
    companyName: row.company_name,
    planId: row.plan_id,
    planName: row.plan_name,
    cycle: row.cycle as SaasPlanCycle,
    startsAt: toIsoRequired(row.starts_at),
    expiresAt: toIsoRequired(row.expires_at),
    status: row.status as SaasSubscriptionStatus,
    priceCents: Number(row.amount_cents) || 0,
    createdAt: toIsoRequired(row.created_at),
    updatedAt: toIsoRequired(row.updated_at),
    cancelledAt: toIso(row.cancelled_at),
  };
}

/**
 * Alias da fonte única (`calculateSubscriptionExpiresAt`).
 * Soma um ciclo preservando o dia quando possível e limitando ao fim do mês.
 */
export function addPlanCycle(startIso: string, cycle: SaasPlanCycle): string {
  return calculateSubscriptionExpiresAt(startIso, cycle);
}

const CURRENT_STATUSES = ['TRIAL', 'ACTIVE', 'PAST_DUE', 'SUSPENDED'] as const;

export class SaasPlansService {
  constructor(private readonly sql: MasterSqlQuery = masterSql) {}

  async listPlans(options: { includeInactive?: boolean } = {}): Promise<SaasPlan[]> {
    const result = await this.sql<PlanRow>(
      `SELECT * FROM public.master_plans
       ${options.includeInactive ? '' : 'WHERE active = true'}
       ORDER BY active DESC, lower(name), cycle`,
    );
    return result.rows.map(mapPlan);
  }

  async getPlan(id: string): Promise<SaasPlan> {
    const result = await this.sql<PlanRow>(
      `SELECT * FROM public.master_plans WHERE id = $1 LIMIT 1`,
      [String(id || '').trim()],
    );
    if (!result.rows[0]) throw notFound('plan', id);
    return mapPlan(result.rows[0]);
  }

  async createPlan(input: CreateSaasPlanInput): Promise<SaasPlan> {
    const name = String(input.name || '').trim();
    if (!name) throw invalid('name is required');
    const cycle = assertCycle(input.cycle);
    const result = await this.sql<PlanRow>(
      `INSERT INTO public.master_plans (
         id, name, cycle, price_cents, employee_limit, user_limit,
         enabled_modules, active, created_at, updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7::text[],$8,now(),now())
       RETURNING *`,
      [
        `plan_${randomUUID().replace(/-/g, '').slice(0, 20)}`,
        name,
        cycle,
        nonNegativeInt(input.priceCents, 'priceCents'),
        nonNegativeInt(input.employeeLimit, 'employeeLimit'),
        nonNegativeInt(input.userLimit, 'userLimit'),
        cleanModules(input.enabledModules),
        input.active !== false,
      ],
    );
    return mapPlan(result.rows[0]);
  }

  async updatePlan(id: string, input: UpdateSaasPlanInput): Promise<{ before: SaasPlan; after: SaasPlan }> {
    const before = await this.getPlan(id);
    const next: SaasPlan = {
      ...before,
      name: input.name !== undefined ? String(input.name).trim() : before.name,
      cycle: input.cycle !== undefined ? assertCycle(input.cycle) : before.cycle,
      priceCents: input.priceCents !== undefined ? nonNegativeInt(input.priceCents, 'priceCents') : before.priceCents,
      employeeLimit: input.employeeLimit !== undefined ? nonNegativeInt(input.employeeLimit, 'employeeLimit') : before.employeeLimit,
      userLimit: input.userLimit !== undefined ? nonNegativeInt(input.userLimit, 'userLimit') : before.userLimit,
      enabledModules: input.enabledModules !== undefined ? cleanModules(input.enabledModules) : before.enabledModules,
      active: input.active !== undefined ? Boolean(input.active) : before.active,
    };
    if (!next.name) throw invalid('name is required');
    const result = await this.sql<PlanRow>(
      `UPDATE public.master_plans SET
         name=$2, cycle=$3, price_cents=$4, employee_limit=$5,
         user_limit=$6, enabled_modules=$7::text[], active=$8, updated_at=now()
       WHERE id=$1 RETURNING *`,
      [id, next.name, next.cycle, next.priceCents, next.employeeLimit, next.userLimit, next.enabledModules, next.active],
    );
    return { before, after: mapPlan(result.rows[0]) };
  }

  async setPlanActive(id: string, active: boolean): Promise<{ before: SaasPlan; after: SaasPlan }> {
    return this.updatePlan(id, { active });
  }

  private resolveInstallationType(tenant: TenantRow): InstallationType {
    if (tenant.installation_type === 'SAAS_WEB' || tenant.installation_type === 'ON_PREMISE') {
      return tenant.installation_type;
    }
    return installationTypeFromMode(tenant.mode);
  }

  private assertPlanMatchesInstallation(tenant: TenantRow, plan: SaasPlan): void {
    try {
      assertInstallationPlanCycle(this.resolveInstallationType(tenant), plan.cycle);
    } catch (err) {
      throw invalid(err instanceof Error ? err.message : 'combinação instalação/plano inválida');
    }
  }

  private async resolveTenant(companyId: string): Promise<TenantRow> {
    const id = String(companyId || '').trim();
    if (!id) throw invalid('companyId is required');
    const result = await this.sql<TenantRow>(
      `SELECT id, operational_company_id, company_name, admin_user_id,
              installation_type, mode
         FROM public.master_tenants
        WHERE id = $1 OR operational_company_id = $1
        ORDER BY CASE WHEN operational_company_id = $1 THEN 0 ELSE 1 END
        LIMIT 1`,
      [id],
    );
    if (!result.rows[0]) throw notFound('company', id);
    return result.rows[0];
  }

  private async findCurrent(tenantId: string): Promise<CompanyPlanSubscription | null> {
    const result = await this.sql<SubscriptionRow>(
      `SELECT s.id, s.tenant_id, s.company_id, s.plan_id,
              p.name AS plan_name, s.cycle, s.starts_at, s.expires_at,
              s.status, s.amount_cents, s.created_at, s.updated_at,
              s.cancelled_at, t.company_name
         FROM public.master_subscriptions s
         JOIN public.master_plans p ON p.id = s.plan_id
         JOIN public.master_tenants t ON t.id = s.tenant_id
        WHERE s.tenant_id = $1
          AND s.status = ANY($2::text[])
        ORDER BY s.created_at DESC
        LIMIT 1`,
      [tenantId, [...CURRENT_STATUSES]],
    );
    return result.rows[0] ? mapSubscription(result.rows[0]) : null;
  }

  async getCompanySubscription(companyId: string): Promise<CompanyPlanSubscription | null> {
    const tenant = await this.resolveTenant(companyId);
    return this.findCurrent(tenant.id);
  }

  async listCompanySubscriptions(): Promise<CompanyPlanSubscription[]> {
    const result = await this.sql<SubscriptionRow>(
      `SELECT s.id, s.tenant_id, s.company_id, s.plan_id,
              p.name AS plan_name, s.cycle, s.starts_at, s.expires_at,
              s.status, s.amount_cents, s.created_at, s.updated_at,
              s.cancelled_at, t.company_name
         FROM public.master_subscriptions s
         JOIN public.master_plans p ON p.id = s.plan_id
         JOIN public.master_tenants t ON t.id = s.tenant_id
        ORDER BY s.created_at DESC`,
    );
    return result.rows.map(mapSubscription);
  }

  private async insertSubscription(
    tenant: TenantRow,
    plan: SaasPlan,
    status: SaasSubscriptionStatus,
    startsAt: string,
    cancelId?: string,
  ): Promise<CompanyPlanSubscription> {
    const expiresAt = addPlanCycle(startsAt, plan.cycle);
    const id = `sub_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
    const companyId = tenant.operational_company_id || tenant.id;
    const customerId = tenant.admin_user_id || `cust_${tenant.id}`;
    const periodicity = plan.cycle === 'ANNUAL' ? 'yearly' : 'monthly';
    const planCode = plan.name.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').slice(0, 40) || plan.id;

    const result = await this.sql<SubscriptionRow>(
      `WITH cancelled AS (
         UPDATE public.master_subscriptions
            SET status='CANCELLED', cancelled_at=now(), updated_at=now()
          WHERE id = $1 AND $1::text IS NOT NULL
          RETURNING id
       ), inserted AS (
         INSERT INTO public.master_subscriptions (
           id, tenant_id, customer_id, company_id, plan_id, plan, status,
           cycle, periodicity, amount_cents, starts_at, expires_at,
           next_billing, grace_until, renewed_at, suspended_at,
           cancelled_at, paused_at, created_at, updated_at, meta
         ) VALUES (
           $2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13,
           null,null,null,null,null,now(),now(),$14::jsonb
         ) RETURNING *
       )
       SELECT i.id, i.tenant_id, i.company_id, i.plan_id,
              $15::text AS plan_name, i.cycle, i.starts_at, i.expires_at,
              i.status, i.amount_cents, i.created_at, i.updated_at,
              i.cancelled_at, $16::text AS company_name
         FROM inserted i`,
      [
        cancelId ?? null,
        id,
        tenant.id,
        customerId,
        companyId,
        plan.id,
        planCode,
        status,
        plan.cycle,
        periodicity,
        plan.priceCents,
        startsAt,
        expiresAt,
        JSON.stringify({ source: 'fase_6_3', modules: plan.enabledModules }),
        plan.name,
        tenant.company_name,
      ],
    );
    return mapSubscription(result.rows[0]);
  }

  async assignPlan(input: AssignCompanyPlanInput): Promise<CompanyPlanSubscription> {
    const tenant = await this.resolveTenant(input.companyId);
    const existing = await this.findCurrent(tenant.id);
    if (existing) throw conflict(`company already has current subscription: ${existing.id}`);
    const plan = await this.getPlan(input.planId);
    if (!plan.active) throw conflict('cannot assign an inactive plan');
    this.assertPlanMatchesInstallation(tenant, plan);
    const status = assertStatus(input.status ?? 'ACTIVE');
    if (status === 'CANCELLED' || status === 'EXPIRED') {
      throw invalid('new subscription status must be TRIAL, ACTIVE, PAST_DUE or SUSPENDED');
    }
    const startsAt = normalizeStartDate(input.startsAt);
    return this.insertSubscription(tenant, plan, status, startsAt);
  }

  async changePlan(input: AssignCompanyPlanInput): Promise<{ before: CompanyPlanSubscription; after: CompanyPlanSubscription }> {
    const tenant = await this.resolveTenant(input.companyId);
    const before = await this.findCurrent(tenant.id);
    if (!before) throw notFound('company subscription', input.companyId);
    if (before.planId === input.planId) throw conflict('company already uses this plan');
    const plan = await this.getPlan(input.planId);
    if (!plan.active) throw conflict('cannot assign an inactive plan');
    this.assertPlanMatchesInstallation(tenant, plan);
    const startsAt = normalizeStartDate(input.startsAt);
    const status = assertStatus(input.status ?? 'ACTIVE');
    const after = await this.insertSubscription(tenant, plan, status, startsAt, before.id);
    return { before, after };
  }

  async cancelCompanySubscription(companyId: string): Promise<{ before: CompanyPlanSubscription; after: CompanyPlanSubscription }> {
    const tenant = await this.resolveTenant(companyId);
    const before = await this.findCurrent(tenant.id);
    if (!before) throw notFound('company subscription', companyId);
    const result = await this.sql<SubscriptionRow>(
      `UPDATE public.master_subscriptions s
          SET status='CANCELLED', cancelled_at=now(), updated_at=now()
         FROM public.master_plans p, public.master_tenants t
        WHERE s.id=$1 AND p.id=s.plan_id AND t.id=s.tenant_id
        RETURNING s.id, s.tenant_id, s.company_id, s.plan_id,
                  p.name AS plan_name, s.cycle, s.starts_at, s.expires_at,
                  s.status, s.amount_cents, s.created_at, s.updated_at,
                  s.cancelled_at, t.company_name`,
      [before.id],
    );
    return { before, after: mapSubscription(result.rows[0]) };
  }

  /** Restaura o estado anterior quando a projeção comercial do cancelamento falha. */
  async restoreSubscriptionSnapshot(
    snapshot: CompanyPlanSubscription,
  ): Promise<CompanyPlanSubscription> {
    const result = await this.sql<SubscriptionRow>(
      `UPDATE public.master_subscriptions s
          SET status=$2, cancelled_at=$3, updated_at=now()
         FROM public.master_plans p, public.master_tenants t
        WHERE s.id=$1 AND p.id=s.plan_id AND t.id=s.tenant_id
        RETURNING s.id, s.tenant_id, s.company_id, s.plan_id,
                  p.name AS plan_name, s.cycle, s.starts_at, s.expires_at,
                  s.status, s.amount_cents, s.created_at, s.updated_at,
                  s.cancelled_at, t.company_name`,
      [snapshot.id, snapshot.status, snapshot.cancelledAt],
    );
    if (!result.rows[0]) throw notFound('subscription', snapshot.id);
    return mapSubscription(result.rows[0]);
  }
}
