/**
 * Controllers do Tenant Deployment Manager (InMemory).
 * Mantém compat com Platform DeploymentManager no GET.
 */
import type { Request, Response } from 'express';
import { MasterError } from '../../errors.js';
import { MasterPlatformService } from '../../../services/master/masterPlatformService.js';
import { DeploymentManager } from '../../../platform/deploymentManager.js';
import type { MasterApiRequest } from '../middlewares/requireMasterLogin.js';
import { MasterApiServices } from '../services/index.js';
import type {
  TenantDeploymentAction,
  TenantDeploymentMode,
} from '../../deploymentManager/types.js';
import { DEPLOYMENT_MODES } from '../../deploymentManager/types.js';

function sendError(res: Response, error: unknown): void {
  if (error instanceof MasterError) {
    const status =
      error.code === 'MASTER_NOT_FOUND'
        ? 404
        : error.code === 'MASTER_CONFLICT'
          ? 409
          : error.code === 'MASTER_INVALID'
            ? 400
            : 500;
    res.status(status).json({ ok: false, error: error.code, message: error.message });
    return;
  }
  res.status(500).json({
    ok: false,
    error: 'master_deployment_manager_failed',
    message: error instanceof Error ? error.message : String(error),
  });
}

function mgr() {
  return MasterPlatformService.getTenantDeployments();
}

function audit(
  req: MasterApiRequest,
  action: string,
  resource: string,
  message: string,
  extra?: {
    companyId?: string | null;
    companyName?: string | null;
    before?: Record<string, unknown> | null;
    after?: Record<string, unknown> | null;
    meta?: Record<string, unknown>;
  },
): void {
  MasterApiServices.recordAudit(req, {
    action,
    resource,
    message,
    companyId: extra?.companyId ?? null,
    companyName: extra?.companyName ?? null,
    before: extra?.before ?? null,
    after: extra?.after ?? null,
    meta: extra?.meta,
  });
}

const ACTIONS = new Set<TenantDeploymentAction>([
  'set_mode_saas',
  'set_mode_local',
  'set_mode_hybrid',
  'mark_healthy',
  'mark_degraded',
  'mark_offline',
  'mark_syncing',
  'simulate_sync',
  'enable_cloud',
  'disable_cloud',
  'enable_rep_agent',
  'disable_rep_agent',
  'enable_realtime',
  'disable_realtime',
  'enable_sync',
  'disable_sync',
]);

/**
 * GET /api/master/deployments
 * Compat: mantém identity do Platform DeploymentManager.
 * Novo: lista de deployments por tenant.
 */
export async function getDeploymentsExpanded(_req: Request, res: Response): Promise<void> {
  try {
    const identity = DeploymentManager.getIdentity();
    const [tenants, snapshot] = await Promise.all([mgr().list(), mgr().snapshot()]);
    res.json({
      ok: true,
      /** Compat — Platform runtime (processo atual). */
      deployment: identity,
      mode: identity.mode,
      environment: identity.environment,
      provider: identity.provider,
      sync: identity.sync,
      license: identity.license,
      /** Novo — Deployment Manager por tenant (InMemory). */
      tenants,
      deployments: tenants,
      count: tenants.length,
      snapshot,
      persistence:
        MasterPlatformService.getPersistence() === 'postgres' ? 'postgres' : 'in_memory',
      platformRuntimeWired: false,
      note: 'TenantDeploymentManager + Platform DeploymentManager (somente leitura do runtime)',
    });
  } catch (error) {
    sendError(res, error);
  }
}

/** POST /api/master/deployments */
export async function postTenantDeployment(req: MasterApiRequest, res: Response): Promise<void> {
  try {
    const tenantId = String(req.body?.tenantId || '').trim();
    if (!tenantId) {
      res.status(400).json({
        ok: false,
        error: 'validation_error',
        message: 'tenantId is required',
      });
      return;
    }
    const mode = req.body?.mode as TenantDeploymentMode | undefined;
    if (mode && !(DEPLOYMENT_MODES as readonly string[]).includes(mode)) {
      res.status(400).json({
        ok: false,
        error: 'validation_error',
        message: `mode must be ${DEPLOYMENT_MODES.join('|')}`,
      });
      return;
    }
    const deployment = await mgr().create({
      tenantId,
      empresa: req.body?.empresa,
      mode,
      version: req.body?.version,
      currentDeployment: req.body?.currentDeployment,
    });
    audit(req, 'DEPLOYMENT_CREATED', 'deployments', deployment.id, {
      companyId: deployment.tenantId,
      companyName: deployment.empresa ?? null,
      before: null,
      after: {
        id: deployment.id,
        tenantId: deployment.tenantId,
        mode: deployment.mode,
        status: deployment.status,
      },
    });
    res.status(201).json({ ok: true, deployment });
  } catch (error) {
    sendError(res, error);
  }
}

/** PATCH /api/master/deployments/:id */
export async function patchTenantDeployment(req: MasterApiRequest, res: Response): Promise<void> {
  try {
    const id = String(req.params.id || '');
    const deployment = await mgr().update(id, {
      empresa: req.body?.empresa,
      mode: req.body?.mode,
      currentDeployment: req.body?.currentDeployment,
      status: req.body?.status,
      version: req.body?.version,
      lastSyncAt: req.body?.lastSyncAt,
      cloud: req.body?.cloud,
      server: req.body?.server,
      license: req.body?.license,
      repAgent: req.body?.repAgent,
      realtime: req.body?.realtime,
      synchronization: req.body?.synchronization,
    });
    audit(req, 'DEPLOYMENT_UPDATED', 'deployments', id);
    res.json({ ok: true, deployment });
  } catch (error) {
    sendError(res, error);
  }
}

/** POST /api/master/deployments/:id/actions/:action */
export async function postTenantDeploymentAction(
  req: MasterApiRequest,
  res: Response,
): Promise<void> {
  try {
    const id = String(req.params.id || '');
    const action = String(req.params.action || '').toLowerCase() as TenantDeploymentAction;
    if (!ACTIONS.has(action)) {
      res.status(400).json({
        ok: false,
        error: 'unknown_action',
        message: `action must be one of: ${[...ACTIONS].join(', ')}`,
      });
      return;
    }
    const deployment = await mgr().action(id, action);
    audit(req, `DEPLOYMENT_${action.toUpperCase()}`, 'deployments', id, {
      companyId: deployment.tenantId,
      companyName: deployment.empresa ?? null,
      after: {
        id: deployment.id,
        tenantId: deployment.tenantId,
        mode: deployment.mode,
        status: deployment.status,
      },
    });
    res.json({ ok: true, deployment });
  } catch (error) {
    sendError(res, error);
  }
}
