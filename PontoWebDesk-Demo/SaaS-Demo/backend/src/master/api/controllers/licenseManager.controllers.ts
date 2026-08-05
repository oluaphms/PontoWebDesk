/**
 * Controllers do License Manager / Central de Licenciamento.
 * Flags de bloqueio são metadata Master — sem wiring na auth operacional.
 * Mutações projetam estado comercial via LicenseManager wrapping (Commercial Projection).
 */
import type { Request, Response } from 'express';
import { MasterError } from '../../errors.js';
import { MasterPlatformService } from '../../../services/master/masterPlatformService.js';
import type { MasterApiRequest } from '../middlewares/requireMasterLogin.js';
import { MasterApiServices } from '../services/index.js';
import type {
  LicenseManagerAction,
  LicenseMode,
  LicenseRuleOverrides,
  LicenseStatus,
} from '../../licenseManager/types.js';
import { LICENSE_MODES, LICENSE_STATUSES } from '../../licenseManager/types.js';
import { composeLicenseCentral } from '../../licenseManager/composeLicenseCentral.js';
import type { ManagedTenant } from '../../tenantManager/tenantManager.types.js';
import { ensureCompanyLicenseValidity } from '../../license/enrichWithCommercialValidity.js';
import {
  reportMasterContractViolations,
  validateLicenseMutationResponse,
  validateLicensesResponse,
} from '../../contract/index.js';

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
    error: 'master_license_manager_failed',
    message: error instanceof Error ? error.message : String(error),
  });
}

function mgr() {
  return MasterPlatformService.getLicenseManager();
}

function audit(
  req: MasterApiRequest,
  action: string,
  resource: string,
  message: string,
  meta?: Record<string, unknown>,
  extra?: {
    companyId?: string | null;
    companyName?: string | null;
    before?: Record<string, unknown> | null;
    after?: Record<string, unknown> | null;
  },
): void {
  MasterApiServices.recordAudit(req, {
    action,
    resource,
    message,
    companyId: extra?.companyId ?? (typeof meta?.tenantId === 'string' ? meta.tenantId : null),
    companyName: extra?.companyName ?? null,
    before: extra?.before ?? null,
    after: extra?.after ?? null,
    meta,
  });
}

const ACTIONS = new Set<LicenseManagerAction>([
  'activate',
  'block',
  'unblock',
  'suspend',
  'reactivate',
  'expire',
  'renew',
  'delete',
  'set_trial',
  'set_mode_saas',
  'set_mode_local',
  'set_mode_hybrid',
]);

async function buildCentralRows() {
  const companyLicenses = (await mgr().list()).map(ensureCompanyLicenseValidity);
  let tenants: ManagedTenant[] = [];
  try {
    tenants = await MasterApiServices.tenantsService().list();
  } catch {
    tenants = [];
  }
  const tenantsById = new Map(tenants.map((t) => [t.id, t]));

  let invoices: Awaited<
    ReturnType<ReturnType<typeof MasterPlatformService.getBillingEngine>['listInvoices']>
  > = [];
  try {
    invoices = await MasterPlatformService.getBillingEngine().listInvoices();
  } catch {
    invoices = [];
  }

  const auditEntries = await Promise.resolve(MasterApiServices.audit.list(500));
  return composeLicenseCentral({
    licenses: companyLicenses,
    tenantsById,
    invoices,
    audit: auditEntries,
  });
}

/** GET /api/master/licenses — Central de Licenciamento + legado local/cloud. */
export async function getLicensesManager(_req: Request, res: Response): Promise<void> {
  try {
    const [rawLicenses, snapshot, cloudLicenses, localLicenses, central] =
      await Promise.all([
        mgr().list(),
        mgr().snapshot(),
        MasterPlatformService.getDashboard().licenses.list(),
        MasterPlatformService.getLocalLicense().list(),
        buildCentralRows(),
      ]);
    const companyLicenses = rawLicenses.map(ensureCompanyLicenseValidity);
    const payload = {
      ok: true as const,
      companyLicenses,
      licenses: companyLicenses,
      central,
      items: central,
      count: companyLicenses.length,
      snapshot,
      cloudLicenses,
      localLicenses,
      localCount: localLicenses.length,
      persistence: snapshot.persistence,
      operationalAuthWired: false,
      masterOnly: true,
      note:
        'Central de Licenciamento — somente Master altera; SaaS recebe projeção comercial (somente leitura)',
    };
    reportMasterContractViolations(validateLicensesResponse(payload));
    res.json(payload);
  } catch (error) {
    sendError(res, error);
  }
}

/** GET /api/master/licenses/:id/history */
export async function getCompanyLicenseHistory(
  req: MasterApiRequest,
  res: Response,
): Promise<void> {
  try {
    const id = String(req.params.id || '').trim();
    const license = await mgr().get(id);
    const central = await buildCentralRows();
    const row = central.find((r) => r.id === id);
    res.json({
      ok: true,
      licenseId: id,
      tenantId: license.tenantId,
      history: row?.history ?? [],
      masterOnly: true,
    });
  } catch (error) {
    sendError(res, error);
  }
}

/** POST /api/master/licenses */
export async function postCompanyLicense(req: MasterApiRequest, res: Response): Promise<void> {
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
    const mode = req.body?.mode as LicenseMode | undefined;
    const status = req.body?.status as LicenseStatus | undefined;
    if (mode && !(LICENSE_MODES as readonly string[]).includes(mode)) {
      res.status(400).json({
        ok: false,
        error: 'validation_error',
        message: `mode must be ${LICENSE_MODES.join('|')}`,
      });
      return;
    }
    if (status && !(LICENSE_STATUSES as readonly string[]).includes(status)) {
      res.status(400).json({
        ok: false,
        error: 'validation_error',
        message: `status must be ${LICENSE_STATUSES.join('|')}`,
      });
      return;
    }
    let license = await mgr().create({
      tenantId,
      empresa: req.body?.empresa,
      mode,
      status,
      plan: req.body?.plan,
      durationDays: req.body?.durationDays,
      startsAt: req.body?.startsAt,
      expiresAt: req.body?.expiresAt,
      ruleOverrides: req.body?.ruleOverrides,
    });
    if (
      req.body?.maxEmployees !== undefined ||
      req.body?.maxDevices !== undefined ||
      req.body?.licenseKey !== undefined
    ) {
      license = await mgr().update(license.id, {
        maxEmployees: req.body?.maxEmployees,
        maxDevices: req.body?.maxDevices,
        licenseKey: req.body?.licenseKey,
      });
    }
    audit(req, 'LICENSE_CREATED', 'licenses', license.id, undefined, {
      companyId: license.tenantId,
      companyName: license.empresa ?? null,
      before: null,
      after: {
        id: license.id,
        tenantId: license.tenantId,
        status: license.status,
        mode: license.mode,
        plan: license.plan,
        startsAt: license.startsAt,
        expiresAt: license.expiresAt,
      },
    });
    const payload = {
      ok: true,
      license: ensureCompanyLicenseValidity(license),
      masterOnly: true,
    };
    reportMasterContractViolations(
      validateLicenseMutationResponse(payload, 'POST /api/master/licenses'),
    );
    res.status(201).json(payload);
  } catch (error) {
    sendError(res, error);
  }
}

/** PATCH /api/master/licenses/:id — somente Master. */
export async function patchCompanyLicense(req: MasterApiRequest, res: Response): Promise<void> {
  try {
    const id = String(req.params.id || '');
    const before = await mgr().get(id);
    const validityChanged =
      (req.body?.startsAt !== undefined &&
        String(req.body.startsAt || '') !== String(before.startsAt || '')) ||
      (req.body?.expiresAt !== undefined &&
        String(req.body.expiresAt ?? '') !== String(before.expiresAt ?? ''));
    const license = await mgr().update(id, {
      empresa: req.body?.empresa,
      mode: req.body?.mode,
      plan: req.body?.plan,
      startsAt: req.body?.startsAt,
      expiresAt: req.body?.expiresAt,
      ruleOverrides: req.body?.ruleOverrides as LicenseRuleOverrides | undefined,
      maxEmployees: req.body?.maxEmployees,
      maxDevices: req.body?.maxDevices,
      licenseKey: req.body?.licenseKey,
    });
    audit(
      req,
      validityChanged ? 'LICENSE_VALIDITY_CHANGED' : 'LICENSE_UPDATED',
      'licenses',
      id,
      {
        maxEmployees: req.body?.maxEmployees,
        maxDevices: req.body?.maxDevices,
        startsAt: before.startsAt,
        expiresAt: before.expiresAt,
      },
      {
        companyId: license.tenantId,
        companyName: license.empresa ?? null,
        before: {
          id: before.id,
          status: before.status,
          mode: before.mode,
          plan: before.plan,
          startsAt: before.startsAt,
          expiresAt: before.expiresAt,
        },
        after: {
          id: license.id,
          status: license.status,
          mode: license.mode,
          plan: license.plan,
          startsAt: license.startsAt,
          expiresAt: license.expiresAt,
        },
      },
    );
    const payload = {
      ok: true,
      license: ensureCompanyLicenseValidity(license),
      masterOnly: true,
    };
    reportMasterContractViolations(
      validateLicenseMutationResponse(payload, 'PATCH /api/master/licenses/:id'),
    );
    res.json(payload);
  } catch (error) {
    sendError(res, error);
  }
}

/** POST /api/master/licenses/:id/rules */
export async function postCompanyLicenseRules(
  req: MasterApiRequest,
  res: Response,
): Promise<void> {
  try {
    const id = String(req.params.id || '');
    const overrides: LicenseRuleOverrides = {};
    for (const key of [
      'blockLogin',
      'blockApi',
      'blockRep',
      'blockMobile',
      'readOnly',
      'expiryWarning',
    ] as const) {
      if (typeof req.body?.[key] === 'boolean') {
        overrides[key] = req.body[key];
      }
    }
    const license = await mgr().setRules(id, overrides);
    audit(req, 'LICENSE_RULES_SET', 'licenses', id, undefined, {
      companyId: license.tenantId,
      companyName: license.empresa ?? null,
      after: { id: license.id, rules: license.rules, ruleOverrides: license.ruleOverrides },
    });
    const payload = {
      ok: true,
      license: ensureCompanyLicenseValidity(license),
      masterOnly: true,
    };
    reportMasterContractViolations(
      validateLicenseMutationResponse(payload, 'POST /api/master/licenses/:id/rules'),
    );
    res.json(payload);
  } catch (error) {
    sendError(res, error);
  }
}

/** POST /api/master/licenses/:id/actions/:action */
export async function postCompanyLicenseAction(
  req: MasterApiRequest,
  res: Response,
): Promise<void> {
  try {
    const id = String(req.params.id || '');
    const action = String(req.params.action || '').toLowerCase() as LicenseManagerAction;
    if (!ACTIONS.has(action)) {
      res.status(400).json({
        ok: false,
        error: 'unknown_action',
        message: `action must be one of: ${[...ACTIONS].join(', ')}`,
      });
      return;
    }
    const defaultReason =
      action === 'block'
        ? 'blocked_by_master'
        : action === 'suspend'
          ? 'suspended_by_master'
          : action === 'delete'
            ? 'exclusao_master'
            : undefined;
    const before = await mgr().get(id);
    const license = await mgr().action(id, action, {
      durationDays: req.body?.durationDays,
      expiresAt: req.body?.expiresAt,
      reason: req.body?.reason ?? defaultReason,
      actorEmail: req.masterAuth?.email ?? null,
    });
    audit(
      req,
      `LICENSE_${action.toUpperCase()}`,
      'licenses',
      id,
      {
        reason: req.body?.reason ?? defaultReason ?? null,
      },
      {
        companyId: license.tenantId,
        companyName: license.empresa ?? null,
        before: {
          id: before.id,
          status: before.status,
          blockedAt: before.blockedAt,
          blockedReason: before.blockedReason,
        },
        after: {
          id: license.id,
          status: license.status,
          blockedAt: license.blockedAt,
          blockedReason: license.blockedReason,
        },
      },
    );
    if (action === 'delete') {
      res.json({
        ok: true,
        deleted: true,
        license: ensureCompanyLicenseValidity(license),
        masterOnly: true,
      });
      return;
    }
    const payload = {
      ok: true,
      license: ensureCompanyLicenseValidity(license),
      masterOnly: true,
    };
    reportMasterContractViolations(
      validateLicenseMutationResponse(
        payload,
        'POST /api/master/licenses/:id/actions/:action',
      ),
    );
    res.json(payload);
  } catch (error) {
    sendError(res, error);
  }
}

/** DELETE /api/master/licenses/:id — exclusão física (mesmo fluxo de actions/delete). */
export async function deleteCompanyLicense(
  req: MasterApiRequest,
  res: Response,
): Promise<void> {
  req.params.action = 'delete';
  return postCompanyLicenseAction(req, res);
}
