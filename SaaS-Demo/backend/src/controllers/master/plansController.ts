import type { Response } from 'express';
import { MasterError } from '../../master/errors.js';
import { MasterApiServices } from '../../master/api/services/index.js';
import type { MasterApiRequest } from '../../master/api/middlewares/requireMasterLogin.js';
import {
  SaasPlansService,
  type AssignCompanyPlanInput,
  type CreateSaasPlanInput,
  type SaasPlanCycle,
  type SaasSubscriptionStatus,
  type UpdateSaasPlanInput,
} from '../../master/plans/index.js';
import { MasterPlatformService } from '../../services/master/masterPlatformService.js';
import { projectCommercialStateToSaas } from '../../master/commercial/index.js';
import {
  PLAN_DEFAULT_AMOUNT_CENTS,
  type LicensePlan,
  type SubscriptionProps,
  type SubscriptionStatus,
} from '../../master/subscriptions/subscription.types.js';
import { SubscriptionLicenseSyncService } from '../../master/subscriptions/SubscriptionLicenseSyncService.js';
import type { CompanyPlanSubscription } from '../../master/plans/index.js';

const service = new SaasPlansService();

function toProjectionSubscription(sub: CompanyPlanSubscription): SubscriptionProps {
  const planCode = sub.planName.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_') as LicensePlan;
  const status =
    sub.status === 'PAST_DUE'
      ? 'PENDING_PAYMENT'
      : (sub.status as SubscriptionStatus);
  return {
    id: sub.id,
    tenantId: sub.tenantId,
    customerId: `cust_${sub.tenantId}`,
    plan: (['FREE', 'TRIAL', 'STARTER', 'PRO', 'ENTERPRISE', 'LOCAL', 'HYBRID'] as LicensePlan[])
      .includes(planCode)
      ? planCode
      : 'PRO',
    status,
    amountCents: sub.priceCents,
    periodicity: sub.cycle === 'ANNUAL' ? 'yearly' : 'monthly',
    startsAt: sub.startsAt,
    expiresAt: sub.expiresAt,
    nextBilling: null,
    graceUntil: null,
    renewedAt: null,
    suspendedAt: null,
    createdAt: sub.createdAt,
    updatedAt: sub.updatedAt,
    cancelledAt: sub.cancelledAt,
    pausedAt: null,
  };
}

async function projectSubscriptionCommercialState(
  subscription: CompanyPlanSubscription,
  options: { required?: boolean; syncLicense?: boolean } = {},
): Promise<void> {
  const tenant = await MasterPlatformService.getTenantsService().get(subscription.tenantId);
  let license = null;
  try {
    if (options.syncLicense !== false) {
      const sync = new SubscriptionLicenseSyncService({
        licenseManager: MasterPlatformService.getLicenseManager(),
        tenants: MasterPlatformService.getTenantsService(),
        lifecycle: MasterPlatformService.getLifecycle(),
      });
      license = await sync.syncLicenseFromSubscription(tenant.id, {
        subscriptionExpiresAt: subscription.expiresAt,
        plan: subscription.planName,
        reason: 'saas_plan_subscription_sync',
      });
    }
    if (!license) {
      license = await MasterPlatformService.getLicenseManager().getByTenantId(tenant.id);
    }
  } catch {
    license = null;
  }
  await projectCommercialStateToSaas(
    {
      tenant,
      license,
      subscription: toProjectionSubscription(subscription),
      paymentStatus: subscription.status === 'CANCELLED' ? 'cancelled' : null,
    },
    options,
  );
}

function sendError(res: Response, error: unknown): void {
  if (error instanceof MasterError) {
    const status = error.code === 'MASTER_NOT_FOUND' ? 404 : error.code === 'MASTER_CONFLICT' ? 409 : 400;
    res.status(status).json({ ok: false, error: error.code, message: error.message });
    return;
  }
  const pgCode = typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code?: unknown }).code || '')
    : '';
  if (pgCode === '23505') {
    res.status(409).json({ ok: false, error: 'PLAN_DUPLICATE', message: 'Já existe plano com este nome e ciclo.' });
    return;
  }
  if (pgCode === '42P01' || pgCode === '42703') {
    res.status(503).json({ ok: false, error: 'PLAN_SCHEMA_REQUIRED', message: 'Aplique a migration 031.' });
    return;
  }
  res.status(500).json({ ok: false, error: 'MASTER_PLANS_FAILED', message: error instanceof Error ? error.message : String(error) });
}

function bodyRecord(req: MasterApiRequest): Record<string, unknown> {
  return req.body && typeof req.body === 'object' ? req.body as Record<string, unknown> : {};
}

function requireHumanMaster(req: MasterApiRequest, res: Response): boolean {
  if (!req.masterAuth || req.masterKeyAuth || req.masterAuth.viaApiKey) {
    res.status(403).json({
      ok: false,
      error: 'MASTER_HUMAN_ACTOR_REQUIRED',
      message: 'Alterações de planos exigem usuário Master autenticado.',
    });
    return false;
  }
  return true;
}

function priceCents(body: Record<string, unknown>): number {
  if (body.priceCents != null) return Number(body.priceCents);
  return Math.round(Number(body.price ?? 0) * 100);
}

function parseCreatePlan(req: MasterApiRequest): CreateSaasPlanInput {
  const body = bodyRecord(req);
  return {
    name: String(body.name ?? body.nome ?? '').trim(),
    cycle: String(body.cycle ?? body.ciclo ?? '').toUpperCase() as SaasPlanCycle,
    priceCents: priceCents(body),
    employeeLimit: Number(body.employeeLimit ?? body.limiteFuncionarios ?? 0),
    userLimit: Number(body.userLimit ?? body.limiteUsuarios ?? 0),
    enabledModules: Array.isArray(body.enabledModules ?? body.modulosLiberados)
      ? (body.enabledModules ?? body.modulosLiberados) as string[]
      : [],
    active: body.active != null || body.ativo != null
      ? Boolean(body.active ?? body.ativo)
      : true,
  };
}

function parseUpdatePlan(req: MasterApiRequest): UpdateSaasPlanInput {
  const body = bodyRecord(req);
  const out: UpdateSaasPlanInput = {};
  if (body.name != null || body.nome != null) out.name = String(body.name ?? body.nome).trim();
  if (body.cycle != null || body.ciclo != null) out.cycle = String(body.cycle ?? body.ciclo).toUpperCase() as SaasPlanCycle;
  if (body.priceCents != null || body.price != null) out.priceCents = priceCents(body);
  if (body.employeeLimit != null || body.limiteFuncionarios != null) out.employeeLimit = Number(body.employeeLimit ?? body.limiteFuncionarios);
  if (body.userLimit != null || body.limiteUsuarios != null) out.userLimit = Number(body.userLimit ?? body.limiteUsuarios);
  if (body.enabledModules != null || body.modulosLiberados != null) {
    out.enabledModules = Array.isArray(body.enabledModules ?? body.modulosLiberados)
      ? (body.enabledModules ?? body.modulosLiberados) as string[]
      : [];
  }
  if (body.active != null || body.ativo != null) out.active = Boolean(body.active ?? body.ativo);
  return out;
}

function parseAssignment(req: MasterApiRequest): AssignCompanyPlanInput {
  const body = bodyRecord(req);
  return {
    companyId: String(req.params.companyId || body.companyId || '').trim(),
    planId: String(body.planId || '').trim(),
    status: body.status ? String(body.status).toUpperCase() as SaasSubscriptionStatus : undefined,
    startsAt: body.startsAt ? String(body.startsAt) : undefined,
  };
}

/** GET /api/master/plans */
export async function getMasterPlansController(req: MasterApiRequest, res: Response): Promise<void> {
  try {
    const includeInactive = String(req.query.includeInactive || '').toLowerCase() === 'true';
    const plans = await service.listPlans({ includeInactive });
    res.json({ ok: true, plans, count: plans.length });
  } catch {
    // Compatibilidade do modo in-memory/testes: leitura do catálogo histórico.
    // Criação/edição continuam exclusivamente persistentes via migration 031.
    const legacy = MasterPlatformService.getDashboard().plans.list();
    const plans = legacy.map((entry) => ({
      id: `legacy_${entry.plan.toLowerCase()}`,
      name: entry.plan,
      cycle: 'MONTHLY' as const,
      priceCents: PLAN_DEFAULT_AMOUNT_CENTS[entry.plan],
      employeeLimit: 0,
      userLimit: 0,
      enabledModules: entry.features,
      active: true,
      createdAt: '',
      updatedAt: '',
      legacy: true,
    }));
    res.json({ ok: true, plans, count: plans.length, persistence: 'legacy_read_only' });
  }
}

/** POST /api/master/plans */
export async function postMasterPlanController(req: MasterApiRequest, res: Response): Promise<void> {
  try {
    if (!requireHumanMaster(req, res)) return;
    const plan = await service.createPlan(parseCreatePlan(req));
    MasterApiServices.recordAudit(req, {
      action: 'PLAN_CREATED', resource: 'plans', message: `Plano ${plan.name} criado`, after: plan,
      meta: { planId: plan.id, cycle: plan.cycle },
    });
    res.status(201).json({ ok: true, plan });
  } catch (error) { sendError(res, error); }
}

/** PATCH /api/master/plans/:id */
export async function patchMasterPlanController(req: MasterApiRequest, res: Response): Promise<void> {
  try {
    if (!requireHumanMaster(req, res)) return;
    const result = await service.updatePlan(String(req.params.id || ''), parseUpdatePlan(req));
    MasterApiServices.recordAudit(req, {
      action: 'PLAN_UPDATED', resource: 'plans', message: `Plano ${result.after.name} atualizado`,
      before: result.before, after: result.after, meta: { planId: result.after.id },
    });
    res.json({ ok: true, plan: result.after });
  } catch (error) { sendError(res, error); }
}

/** POST /api/master/plans/:id/actions/activate|deactivate */
export async function postMasterPlanActionController(req: MasterApiRequest, res: Response): Promise<void> {
  try {
    if (!requireHumanMaster(req, res)) return;
    const action = String(req.params.action || '').toLowerCase();
    if (action !== 'activate' && action !== 'deactivate') {
      res.status(400).json({ ok: false, error: 'INVALID_PLAN_ACTION', message: 'Ação deve ser activate ou deactivate.' });
      return;
    }
    const result = await service.setPlanActive(String(req.params.id || ''), action === 'activate');
    MasterApiServices.recordAudit(req, {
      action: 'PLAN_UPDATED', resource: 'plans', message: `Plano ${result.after.name} ${action === 'activate' ? 'ativado' : 'desativado'}`,
      before: result.before, after: result.after, meta: { planId: result.after.id, action },
    });
    res.json({ ok: true, plan: result.after, action });
  } catch (error) { sendError(res, error); }
}

/** GET /api/master/tenants/:companyId/subscription */
export async function getCompanyPlanSubscriptionController(req: MasterApiRequest, res: Response): Promise<void> {
  try {
    const subscription = await service.getCompanySubscription(String(req.params.companyId || ''));
    res.json({ ok: true, subscription });
  } catch (error) { sendError(res, error); }
}

/** POST /api/master/tenants/:companyId/subscription/assign */
export async function postAssignCompanyPlanController(req: MasterApiRequest, res: Response): Promise<void> {
  try {
    if (!requireHumanMaster(req, res)) return;
    const subscription = await service.assignPlan(parseAssignment(req));
    await projectSubscriptionCommercialState(subscription);
    MasterApiServices.recordAudit(req, {
      action: 'PLAN_ASSIGNED', resource: 'subscriptions', message: `Plano ${subscription.planName} atribuído a ${subscription.companyName}`,
      companyId: subscription.companyId, companyName: subscription.companyName, after: subscription,
      meta: { tenantId: subscription.tenantId, planId: subscription.planId, subscriptionId: subscription.id },
    });
    res.status(201).json({ ok: true, subscription });
  } catch (error) { sendError(res, error); }
}

/** POST /api/master/tenants/:companyId/subscription/change */
export async function postChangeCompanyPlanController(req: MasterApiRequest, res: Response): Promise<void> {
  try {
    if (!requireHumanMaster(req, res)) return;
    const result = await service.changePlan(parseAssignment(req));
    await projectSubscriptionCommercialState(result.after);
    MasterApiServices.recordAudit(req, {
      action: 'PLAN_CHANGED', resource: 'subscriptions', message: `Plano de ${result.after.companyName} alterado para ${result.after.planName}`,
      companyId: result.after.companyId, companyName: result.after.companyName,
      before: result.before, after: result.after,
      meta: { tenantId: result.after.tenantId, oldPlanId: result.before.planId, newPlanId: result.after.planId },
    });
    res.json({ ok: true, subscription: result.after });
  } catch (error) { sendError(res, error); }
}

/** POST /api/master/tenants/:companyId/subscription/cancel */
export async function postCancelCompanyPlanController(req: MasterApiRequest, res: Response): Promise<void> {
  try {
    if (!requireHumanMaster(req, res)) return;
    const result = await service.cancelCompanySubscription(String(req.params.companyId || ''));
    try {
      // Cancelamento: bloqueio via projeção (CANCELLED). Não trunca license.expires_at
      // (política: período pago permanece registrado; acesso bloqueado pela projeção).
      await projectSubscriptionCommercialState(result.after, {
        required: true,
        syncLicense: false,
      });
    } catch (error) {
      await service.restoreSubscriptionSnapshot(result.before);
      throw error;
    }
    MasterApiServices.recordAudit(req, {
      action: 'PLAN_CANCELLED', resource: 'subscriptions', message: `Assinatura de ${result.after.companyName} cancelada`,
      companyId: result.after.companyId, companyName: result.after.companyName,
      before: result.before, after: result.after,
      meta: { tenantId: result.after.tenantId, planId: result.after.planId, subscriptionId: result.after.id },
    });
    res.json({ ok: true, subscription: result.after });
  } catch (error) { sendError(res, error); }
}
