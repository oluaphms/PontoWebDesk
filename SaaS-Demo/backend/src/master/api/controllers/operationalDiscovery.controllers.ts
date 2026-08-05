import type { Response } from 'express';
import type { MasterApiRequest } from '../middlewares/requireMasterLogin.js';
import {
  OperationalCompanyDiscoveryService,
  OperationalDiscoveryError,
} from '../../operationalDiscovery/index.js';
import { MasterApiServices } from '../services/index.js';
import {
  reportMasterContractViolations,
  validateOperationalCompaniesResponse,
} from '../../contract/index.js';

function sendError(res: Response, error: unknown): void {
  if (error instanceof OperationalDiscoveryError) {
    res.status(error.status).json({
      ok: false,
      code: error.code,
      error: error.message,
      message: error.message,
    });
    return;
  }
  const message = error instanceof Error ? error.message : 'Falha na descoberta operacional.';
  res.status(500).json({
    ok: false,
    code: 'OPERATIONAL_DISCOVERY_FAILED',
    error: message,
    message,
  });
}

function audit(
  req: MasterApiRequest,
  input: {
    action: string;
    message: string;
    companyId: string | null;
    before?: Record<string, unknown> | null;
    after?: Record<string, unknown> | null;
    meta?: Record<string, unknown>;
  },
): void {
  MasterApiServices.recordAudit(req, {
    action: input.action,
    resource: 'operational_discovery',
    message: input.message,
    companyId: input.companyId,
    before: input.before ?? null,
    after: input.after ?? null,
    meta: input.meta,
  });
}

/** GET /api/master/operational-companies */
export async function getOperationalCompaniesDirectory(
  req: MasterApiRequest,
  res: Response,
): Promise<void> {
  try {
    const directory = await OperationalCompanyDiscoveryService.listDirectory({
      q: req.query.q ? String(req.query.q) : undefined,
    });
    reportMasterContractViolations(validateOperationalCompaniesResponse(directory));
    res.json(directory);
  } catch (error) {
    sendError(res, error);
  }
}

/** GET /api/master/operational-companies/orphans */
export async function getOperationalCompanyOrphans(
  req: MasterApiRequest,
  res: Response,
): Promise<void> {
  try {
    const orphans = await OperationalCompanyDiscoveryService.listOrphans();
    res.json({ ok: true, orphans, count: orphans.length });
  } catch (error) {
    sendError(res, error);
  }
}

/**
 * POST /api/master/operational-companies/:companyId/initialize-commercial
 * Cria somente domínio comercial; nunca cria nova company.
 */
export async function postInitializeOperationalCommercial(
  req: MasterApiRequest,
  res: Response,
): Promise<void> {
  try {
    const companyId = String(req.params.companyId || '').trim();
    const result = await OperationalCompanyDiscoveryService.initializeCommercial(companyId, {
      userId: req.masterAuth?.userId ?? null,
      email: req.masterAuth?.email ?? null,
    });
    audit(req, {
      action: result.reused
        ? 'OPERATIONAL_COMMERCIAL_REUSED'
        : 'OPERATIONAL_COMMERCIAL_INITIALIZED',
      message: result.message,
      companyId: result.operationalCompanyId,
      before: null,
      after: {
        masterTenantId: result.masterTenantId,
        subscriptionId: result.subscriptionId,
        licenseId: result.licenseId,
        financeEntryId: result.financeEntryId,
        crmInitialized: result.crmInitialized,
        notificationsInitialized: result.notificationsInitialized,
        reused: result.reused,
      },
      meta: {
        source: 'operational_discovery',
        actorUserId: req.masterAuth?.userId ?? null,
      },
    });
    res.status(result.reused ? 200 : 201).json(result);
  } catch (error) {
    sendError(res, error);
  }
}
