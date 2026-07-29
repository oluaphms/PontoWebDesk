import type { Request, Response } from 'express';
import { MasterError, MasterLoginError } from '../../errors.js';
import { MasterApiServices } from '../services/index.js';
import {
  validateMasterLoginBody,
  validateCreateMasterUserBody,
  validateUpdateMasterUserBody,
  validateResetMasterUserPasswordBody,
  validateCreateTenantBody,
  validateUpdateTenantBody,
  validateTenantAction,
  validateIdParam,
} from '../validators/index.js';
import type { MasterApiRequest } from '../middlewares/requireMasterLogin.js';
import { extractMasterToken } from '../middlewares/requireMasterLogin.js';
import type { MasterRole } from '../../auth/masterAuth.types.js';
import type { MasterTenantAction } from '../../tenants/MasterTenantsService.js';
import { permissionsForRole } from '../../auth/MasterPermission.js';
import {
  canExecuteTenantAction,
  canManageMasterRole,
  canManageMasterUser,
  canMutateFounderAccount,
} from '../../auth/MasterAuthorizationPolicy.js';
import { MasterFounderProtectedError } from '../../auth/founderProtection.js';
import {
  clearMasterSessionCookie,
  setMasterRefreshCookie,
  setMasterSessionCookie,
} from '../../auth/masterSessionCookies.js';
import {
  reportMasterContractViolations,
  validateDashboardResponse,
  validateSummaryResponse,
  validateTenantResponse,
  validateTenantsResponse,
} from '../../contract/index.js';
import {
  MASTER_REFRESH_COOKIE,
  verifyMasterToken,
} from '../../auth/MasterJWT.js';
import type { CreateManagedTenantInput, UpdateManagedTenantInput } from '../../tenantManager/tenantManager.types.js';

function sendError(res: Response, error: unknown): void {
  if (error instanceof MasterError) {
    const status =
      error.code === 'MASTER_NOT_FOUND'
        ? 404
        : error.code === 'MASTER_CONFLICT'
          ? 409
          : error.code === 'MASTER_INVALID'
            ? 400
            : error.code === 'MASTER_FORBIDDEN'
              ? 403
              : 500;
    res.status(status).json({
      ok: false,
      error: error.code,
      message: error.message,
      ...('action' in error && typeof (error as { action?: unknown }).action === 'string'
        ? {
            code: (error as { action: string }).action,
            action: (error as { action: string }).action,
            result: 'denied',
          }
        : {}),
    });
    return;
  }
  if (
    error &&
    typeof error === 'object' &&
    'name' in error &&
    (error as { name?: string }).name === 'MasterProvisioningError' &&
    'status' in error &&
    typeof (error as { status?: unknown }).status === 'number'
  ) {
    const provisioningError = error as {
      status: number;
      code?: string;
      message?: string;
    };
    res.status(provisioningError.status).json({
      ok: false,
      error: provisioningError.code || 'provisioning_error',
      message: provisioningError.message || 'Falha no provisionamento Master',
    });
    return;
  }
  res.status(500).json({
    ok: false,
    error: 'master_api_failed',
    message: error instanceof Error ? error.message : String(error),
  });
}

function sendPolicyForbidden(res: Response, message: string): void {
  res.status(403).json({
    ok: false,
    error: 'forbidden',
    code: 'MASTER_FORBIDDEN_POLICY',
    message,
  });
}

function requireHumanMasterActor(req: MasterApiRequest, res: Response): boolean {
  if (req.masterAuth?.viaApiKey || req.masterKeyAuth) {
    sendPolicyForbidden(
      res,
      'Gestão de usuários exige uma sessão humana autenticada no Painel Master.',
    );
    return false;
  }
  return true;
}

function clientIp(req: Request): string | null {
  const xf = String(req.headers['x-forwarded-for'] || '')
    .split(',')[0]
    ?.trim();
  if (xf) return xf;
  return req.socket?.remoteAddress || null;
}

function clientDevice(req: Request): string | null {
  const ua = String(req.headers['user-agent'] || '').trim();
  return ua ? ua.slice(0, 256) : null;
}

function audit(
  req: MasterApiRequest | Request,
  input: Parameters<typeof MasterApiServices.recordAudit>[1],
) {
  return MasterApiServices.recordAudit(req, input);
}

function extractRefreshToken(req: Request): string {
  const body = req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {};
  const fromBody = String(body.refreshToken || '').trim();
  if (fromBody) return fromBody;
  const cookieHeader = String(req.headers.cookie || '');
  const match = cookieHeader.match(
    new RegExp(`(?:^|;\\s*)${MASTER_REFRESH_COOKIE}=([^;]+)`),
  );
  if (match?.[1]) return decodeURIComponent(match[1]);
  return '';
}

function extractBearerOrCookie(req: Request): string {
  return extractMasterToken(req);
}

function setMasterAuthCookies(res: Response, accessToken: string, refreshToken: string): void {
  setMasterSessionCookie(res, accessToken);
  setMasterRefreshCookie(res, refreshToken);
}

/** POST /api/master/auth/login */
export async function postMasterLogin(req: Request, res: Response): Promise<void> {
  try {
    const parsed = validateMasterLoginBody(req.body);
    if (!parsed.ok) {
      audit(req, {
        action: 'MASTER_AUTH_INVALID_ATTEMPT',
        resource: 'auth',
        message: 'Login Master — body inválido',
        meta: { reason: parsed.message, ip: clientIp(req) },
      });
      res.status(400).json({ ok: false, error: 'validation_error', message: parsed.message });
      return;
    }
    const auth = MasterApiServices.auth();
    await auth.ensureBootstrapOwner();
    const session = await auth.login({
      email: String(parsed.value.email),
      password: String(parsed.value.password),
      device: clientDevice(req),
      ip: clientIp(req),
    });
    setMasterAuthCookies(res, session.token, session.refreshToken);
    audit(req, {
      actorUserId: session.userId,
      actorEmail: session.email,
      actorRole: session.role,
      action: 'LOGIN_SUCCESS',
      resource: 'auth',
      message: 'Login Master ok',
      after: {
        userId: session.userId,
        email: session.email,
        role: session.role,
        sessionId: session.sessionId,
      },
      meta: {
        sessionId: session.sessionId,
        jti: session.jti,
        ip: clientIp(req),
        device: clientDevice(req),
      },
    });
    res.json({
      ok: true,
      session,
      tokenType: 'master',
      note: 'Use Authorization: Bearer <token> nas rotas /api/master/*',
    });
  } catch (error) {
    if (error instanceof MasterLoginError) {
      const email =
        req.body && typeof req.body === 'object'
          ? String((req.body as Record<string, unknown>).email || '').trim().toLowerCase()
          : '';
      const action =
        error.reason === 'unknown_account'
          ? 'LOGIN_UNKNOWN_ACCOUNT'
          : error.reason === 'blocked_account'
            ? 'LOGIN_BLOCKED_ACCOUNT'
            : 'LOGIN_INVALID_PASSWORD';
      audit(req, {
        actorEmail: email || null,
        action,
        resource: 'auth',
        message:
          error.reason === 'unknown_account'
            ? 'Login Master — conta inexistente'
            : error.reason === 'blocked_account'
              ? 'Login Master — conta bloqueada'
              : 'Login Master — senha incorreta',
        meta: {
          reason: error.reason,
          ip: clientIp(req),
          device: clientDevice(req),
        },
      });
      res.status(401).json({
        ok: false,
        error: 'invalid_master_credentials',
        code: 'MASTER_LOGIN_FAILED',
        message: 'Credenciais Master inválidas.',
      });
      return;
    }
    sendError(res, error);
  }
}

/** POST /api/master/auth/logout — revoga sessão + limpa cookies Master. */
export async function postMasterLogout(req: MasterApiRequest, res: Response): Promise<void> {
  try {
    const auth = MasterApiServices.auth();
    const access = extractBearerOrCookie(req) || String(req.masterAccessToken || '');
    const refresh = extractRefreshToken(req);
    const before = access ? verifyMasterToken(access) : null;
    const result = await auth.logout({
      token: access || null,
      refreshToken: refresh || null,
      reason: 'logout',
    });
    clearMasterSessionCookie(res);
    audit(req, {
      actorUserId: before?.userId ?? req.masterAuth?.userId ?? null,
      actorEmail: before?.email ?? req.masterAuth?.email ?? null,
      action: 'LOGIN_LOGOUT',
      resource: 'auth',
      message: result.revoked ? 'Logout Master — sessão revogada' : 'Logout Master — cookies limpos',
      meta: {
        sessionId: result.sessionId,
        revoked: result.revoked,
        ip: clientIp(req),
      },
    });
    res.json({
      ok: true,
      tokenType: 'master' as const,
      revoked: result.revoked,
      sessionId: result.sessionId,
      message: 'Sessão Master encerrada.',
    });
  } catch (error) {
    clearMasterSessionCookie(res);
    sendError(res, error);
  }
}

/** POST /api/master/auth/forgot-password — público (rate limited). */
export async function postMasterForgotPassword(req: Request, res: Response): Promise<void> {
  try {
    const email =
      req.body && typeof req.body === 'object'
        ? String((req.body as Record<string, unknown>).email || '').trim()
        : '';
    const auth = MasterApiServices.auth();
    const result = await auth.requestPasswordReset(email);
    audit(req, {
      actorEmail: email.toLowerCase() || null,
      action: 'MASTER_PASSWORD_RESET_REQUESTED',
      resource: 'auth',
      message: 'Solicitação de recuperação de senha Master',
      meta: { challengeId: result.challengeId, ip: clientIp(req) },
    });
    res.json({
      ok: true,
      challengeId: result.challengeId,
      ...(result.debugCode ? { debugCode: result.debugCode } : {}),
      message:
        'Se existir uma conta Master com este e-mail, use o código de verificação para definir uma nova senha.',
    });
  } catch (error) {
    sendError(res, error);
  }
}

/** POST /api/master/auth/reset-password — público (rate limited). */
export async function postMasterResetPassword(req: Request, res: Response): Promise<void> {
  try {
    const body =
      req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {};
    const auth = MasterApiServices.auth();
    await auth.confirmPasswordReset({
      challengeId: String(body.challengeId || ''),
      code: String(body.code || ''),
      newPassword: String(body.newPassword || body.password || ''),
    });
    audit(req, {
      action: 'MASTER_PASSWORD_RESET_COMPLETED',
      resource: 'auth',
      message: 'Senha Master redefinida',
      meta: { ip: clientIp(req) },
    });
    res.json({ ok: true, message: 'Senha Master atualizada. Faça login com a nova senha.' });
  } catch (error) {
    if (error instanceof MasterError && error.code === 'MASTER_INVALID') {
      res.status(400).json({
        ok: false,
        error: 'invalid_reset',
        message: error.message || 'Código expirado ou inválido.',
      });
      return;
    }
    sendError(res, error);
  }
}

/** GET /api/master/auth/me */
export async function getMasterMe(req: MasterApiRequest, res: Response): Promise<void> {
  const masterAuth = req.masterAuth ?? null;
  const permissions = masterAuth ? permissionsForRole(masterAuth.role) : [];
  res.json({
    ok: true,
    tokenType: 'master',
    masterAuth,
    permissions,
  });
}

/** POST /api/master/auth/refresh — rotação de refresh + novo access JWT. */
export async function postMasterRefresh(req: Request, res: Response): Promise<void> {
  try {
    const body = req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {};
    const fromBody = String(body.token || '').trim();
    const accessToken = fromBody || extractBearerOrCookie(req);
    const refreshToken = extractRefreshToken(req);

    if (!accessToken && !refreshToken) {
      audit(req, {
        action: 'MASTER_AUTH_INVALID_ATTEMPT',
        resource: 'auth',
        message: 'Refresh Master sem token',
        meta: { ip: clientIp(req) },
      });
      res.status(401).json({
        ok: false,
        error: 'unauthorized',
        code: 'MASTER_TOKEN_REQUIRED',
        message: 'Token Master necessário para refresh.',
      });
      return;
    }

    const auth = MasterApiServices.auth();
    const session = await auth.refresh({
      token: accessToken || undefined,
      refreshToken: refreshToken || undefined,
      device: clientDevice(req),
      ip: clientIp(req),
    });
    setMasterAuthCookies(res, session.token, session.refreshToken);
    audit(req, {
      actorUserId: session.userId,
      actorEmail: session.email,
      action: 'LOGIN_REFRESH',
      resource: 'auth',
      message: 'Refresh Master ok — token rotacionado',
      meta: {
        sessionId: session.sessionId,
        jti: session.jti,
        ip: clientIp(req),
      },
    });
    res.json({
      ok: true,
      session,
      tokenType: 'master',
    });
  } catch (error) {
    if (error instanceof MasterError && error.code === 'MASTER_INVALID') {
      const msg = error.message || '';
      const reuse = /master_refresh_reuse/.test(msg);
      const revoked = /master_token_revoked/.test(msg);
      const expired = /master_session_expired/.test(msg);
      audit(req, {
        action: expired
          ? 'LOGIN_SESSION_EXPIRED'
          : reuse
            ? 'MASTER_REFRESH_REUSE'
            : revoked
              ? 'MASTER_TOKEN_REVOKED'
              : 'MASTER_AUTH_INVALID_ATTEMPT',
        resource: 'auth',
        message: expired
          ? 'Sessão Master expirada durante refresh'
          : reuse
            ? 'Reuse de refresh token Master'
            : revoked
              ? 'Refresh com sessão revogada'
              : 'Refresh Master inválido',
        meta: { ip: clientIp(req), reason: msg },
      });
      res.status(401).json({
        ok: false,
        error: 'unauthorized',
        code: reuse
          ? 'MASTER_REFRESH_REUSE'
          : revoked
            ? 'MASTER_TOKEN_REVOKED'
            : 'MASTER_TOKEN_INVALID',
        message: reuse
          ? 'Refresh token reutilizado. Sessão revogada.'
          : 'Sessão Master inválida ou expirada.',
      });
      return;
    }
    sendError(res, error);
  }
}

export async function getDashboard(_req: Request, res: Response): Promise<void> {
  try {
    const payload = await MasterApiServices.getDashboard();
    reportMasterContractViolations(validateDashboardResponse(payload));
    res.json(payload);
  } catch (error) {
    sendError(res, error);
  }
}

/** GET /api/master/summary */
export async function getSummary(_req: Request, res: Response): Promise<void> {
  try {
    const payload = await MasterApiServices.getSummary();
    reportMasterContractViolations(validateSummaryResponse(payload));
    res.json(payload);
  } catch (error) {
    sendError(res, error);
  }
}

/** GET /api/master/logs */
export async function getLogs(req: Request, res: Response): Promise<void> {
  try {
    const limit = Number(req.query.limit || 100);
    res.json(await MasterApiServices.getLogs(Number.isFinite(limit) ? limit : 100));
  } catch (error) {
    sendError(res, error);
  }
}

/** GET /api/master/health */
export async function getHealth(_req: Request, res: Response): Promise<void> {
  try {
    res.json(await MasterApiServices.getHealth());
  } catch (error) {
    sendError(res, error);
  }
}

export async function getTenants(req: Request, res: Response): Promise<void> {
  try {
    const payload = await MasterApiServices.getTenants({
      q: req.query.q ? String(req.query.q) : undefined,
      plan: req.query.plan ? String(req.query.plan) : undefined,
      mode: req.query.mode ? String(req.query.mode) : undefined,
      status: req.query.status ? String(req.query.status) : undefined,
    });
    reportMasterContractViolations(validateTenantsResponse(payload));
    res.json(payload);
  } catch (error) {
    sendError(res, error);
  }
}

export async function getTenant(req: Request, res: Response): Promise<void> {
  try {
    const id = String(req.params.id || '').trim();
    const parsed = validateIdParam(id);
    if (!parsed.ok) {
      res.status(400).json({ ok: false, error: 'validation_error', message: parsed.message });
      return;
    }
    const payload = await MasterApiServices.getTenant(id);
    reportMasterContractViolations(
      validateTenantResponse(payload, 'GET /api/master/tenants/:id'),
    );
    res.json(payload);
  } catch (error) {
    sendError(res, error);
  }
}

export async function postTenant(req: MasterApiRequest, res: Response): Promise<void> {
  try {
    const parsed = validateCreateTenantBody(req.body);
    if (!parsed.ok) {
      res.status(400).json({ ok: false, error: 'validation_error', message: parsed.message });
      return;
    }
    const result = await MasterApiServices.createTenant(
      parsed.value as unknown as CreateManagedTenantInput,
      {
        userId: req.masterAuth?.userId ?? null,
        email: req.masterAuth?.email ?? null,
        role: req.masterAuth?.role ?? null,
        ip: clientIp(req),
        userAgent: clientDevice(req),
      },
    );
    audit(req, {
      actorUserId: req.masterAuth?.userId ?? null,
      actorEmail: req.masterAuth?.email ?? null,
      action: 'TENANT_CREATE_REQUEST',
      resource: 'tenants',
      message: `Create ${result.tenant.company.name}`,
      companyId: result.provision?.operationalCompanyId || result.tenant.id,
      companyName: result.tenant.company.name,
      before: null,
      after: {
        id: result.tenant.id,
        status: result.tenant.status,
        plan: result.tenant.plan,
        mode: result.tenant.mode,
        company: result.tenant.company,
        operationalCompanyId: result.provision?.operationalCompanyId ?? null,
        provisioned: result.provision?.provisioned ?? false,
        subscriptionId: result.provision?.subscriptionId ?? null,
        licenseId: result.provision?.licenseId ?? null,
      },
      meta: {
        source: 'master_company_provisioning',
        provisionCorrelationId: result.provision?.provisionCorrelationId ?? null,
        message: result.provision?.message ?? null,
      },
    });
    reportMasterContractViolations(
      validateTenantResponse(result, 'POST /api/master/tenants'),
    );
    res.status(201).json(result);
  } catch (error) {
    sendError(res, error);
  }
}

export async function patchTenant(req: MasterApiRequest, res: Response): Promise<void> {
  try {
    const id = String(req.params.id || '').trim();
    const idParsed = validateIdParam(id);
    if (!idParsed.ok) {
      res.status(400).json({ ok: false, error: 'validation_error', message: idParsed.message });
      return;
    }
    const parsed = validateUpdateTenantBody(req.body);
    if (!parsed.ok) {
      res.status(400).json({ ok: false, error: 'validation_error', message: parsed.message });
      return;
    }
    const beforeTenant = await MasterApiServices.getTenant(id).then((r) => r.tenant);
    const result = await MasterApiServices.updateTenant(
      id,
      parsed.value as unknown as UpdateManagedTenantInput,
    );
    const installationChanged =
      parsed.value.installationType != null &&
      beforeTenant.installationType !== result.tenant.installationType;
    if (installationChanged) {
      audit(req, {
        actorUserId: req.masterAuth?.userId ?? null,
        actorEmail: req.masterAuth?.email ?? null,
        action: 'INSTALLATION_TYPE_CHANGED',
        resource: 'tenants',
        message: `Tipo de instalação alterado para ${result.tenant.installationType}`,
        companyId: result.tenant.id,
        companyName: result.tenant.company.name,
        before: {
          installationType: beforeTenant.installationType,
          mode: beforeTenant.mode,
          plan: beforeTenant.plan,
        },
        after: {
          installationType: result.tenant.installationType,
          mode: result.tenant.mode,
          plan: result.tenant.plan,
        },
      });
    }
    audit(req, {
      actorUserId: req.masterAuth?.userId ?? null,
      actorEmail: req.masterAuth?.email ?? null,
      action: 'TENANT_UPDATE_REQUEST',
      resource: 'tenants',
      message: `Update ${result.tenant.company.name}`,
      companyId: result.tenant.id,
      companyName: result.tenant.company.name,
      before: result.before,
      after: {
        id: result.tenant.id,
        status: result.tenant.status,
        plan: result.tenant.plan,
        mode: result.tenant.mode,
        installationType: result.tenant.installationType,
        company: result.tenant.company,
      },
    });
    const payload = { ok: result.ok, tenant: result.tenant };
    reportMasterContractViolations(
      validateTenantResponse(payload, 'PATCH /api/master/tenants/:id'),
    );
    res.json(payload);
  } catch (error) {
    sendError(res, error);
  }
}

export async function deleteTenant(req: MasterApiRequest, res: Response): Promise<void> {
  try {
    const id = String(req.params.id || '').trim();
    const idParsed = validateIdParam(id);
    if (!idParsed.ok) {
      res.status(400).json({ ok: false, error: 'validation_error', message: idParsed.message });
      return;
    }
    const result = await MasterApiServices.deleteTenant(id, {
      userId: req.masterAuth?.userId ?? null,
      email: req.masterAuth?.email ?? null,
      role: req.masterAuth?.role ?? null,
      ip: clientIp(req),
      userAgent: clientDevice(req),
    });
    audit(req, {
      actorUserId: req.masterAuth?.userId ?? null,
      actorEmail: req.masterAuth?.email ?? null,
      action: 'TENANT_DELETE_REQUEST',
      resource: 'tenants',
      message: `Delete ${result.companyName}`,
      companyId: result.operationalCompanyId || result.tenantId,
      companyName: result.companyName,
      before: result.before,
      after: null,
      meta: {
        source: 'master_company_purge',
        tenantId: result.tenantId,
        operationalCompanyId: result.operationalCompanyId,
      },
    });
    res.json({
      ok: true,
      deleted: true,
      tenantId: result.tenantId,
      operationalCompanyId: result.operationalCompanyId,
      companyName: result.companyName,
    });
  } catch (error) {
    sendError(res, error);
  }
}

export async function postTenantAction(req: MasterApiRequest, res: Response): Promise<void> {
  try {
    const id = String(req.params.id || '').trim();
    const idParsed = validateIdParam(id);
    if (!idParsed.ok) {
      res.status(400).json({ ok: false, error: 'validation_error', message: idParsed.message });
      return;
    }
    const actionParsed = validateTenantAction(req.params.action);
    if (!actionParsed.ok) {
      res.status(400).json({ ok: false, error: 'validation_error', message: actionParsed.message });
      return;
    }
    const action = String(actionParsed.value.action) as MasterTenantAction;
    const actorRole = req.masterAuth?.role;
    if (!actorRole || !canExecuteTenantAction(actorRole, action)) {
      audit(req, {
        actorUserId: req.masterAuth?.userId ?? null,
        actorEmail: req.masterAuth?.email ?? null,
        action: 'TENANT_ACTION_DENIED',
        resource: 'tenants',
        message: `Ação ${action} negada para ${actorRole ?? 'sem perfil'}`,
        companyId: id,
        meta: { tenantId: id, action, actorRole: actorRole ?? null },
      });
      sendPolicyForbidden(res, 'Perfil Master não autorizado para esta ação na empresa.');
      return;
    }
    const body = req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {};
    const reason = String(body.reason || '').trim() || undefined;
    const result = await MasterApiServices.tenantAction(
      id,
      action,
      reason,
    );
    audit(req, {
      actorUserId: req.masterAuth?.userId ?? null,
      actorEmail: req.masterAuth?.email ?? null,
      action: `TENANT_ACTION_${String(actionParsed.value.action).toUpperCase()}`,
      resource: 'tenants',
      message: `${actionParsed.value.action} ${result.tenant.company.name}`,
      companyId: result.tenant.operationalCompanyId || result.tenant.id,
      companyName: result.tenant.company.name,
      before: result.before,
      after: result.after ?? {
        id: result.tenant.id,
        status: result.tenant.status,
        operationalCompanyId: result.tenant.operationalCompanyId ?? null,
        reason: reason || null,
      },
      meta: {
        tenantId: result.tenant.id,
        operationalCompanyId: result.tenant.operationalCompanyId ?? null,
        action,
      },
    });
    const payload = { ok: result.ok, tenant: result.tenant, action: result.action };
    reportMasterContractViolations(
      validateTenantResponse(payload, 'POST /api/master/tenants/:id/actions/:action'),
    );
    res.json(payload);
  } catch (error) {
    const tenantId = String(req.params.id || '').trim();
    const requestedAction = String(req.params.action || '').trim().toLowerCase();
    if (requestedAction === 'block' && tenantId) {
      audit(req, {
        actorUserId: req.masterAuth?.userId ?? null,
        actorEmail: req.masterAuth?.email ?? null,
        action: 'TENANT_ACTION_BLOCK_FAILED',
        resource: 'tenants',
        message: 'Bloqueio administrativo não aplicado',
        companyId: tenantId,
        meta: {
          tenantId,
          reason: 'commercial_projection_failed',
          error: error instanceof Error ? error.message : String(error),
        },
      });
    }
    sendError(res, error);
  }
}

export async function getLicenses(_req: Request, res: Response): Promise<void> {
  try {
    res.json(await MasterApiServices.getLicenses());
  } catch (error) {
    sendError(res, error);
  }
}

export async function getSubscriptions(_req: Request, res: Response): Promise<void> {
  try {
    res.json(await MasterApiServices.getSubscriptions());
  } catch (error) {
    sendError(res, error);
  }
}

export async function getPayments(_req: Request, res: Response): Promise<void> {
  try {
    res.json(await MasterApiServices.getPayments());
  } catch (error) {
    sendError(res, error);
  }
}

export async function getDeployments(_req: Request, res: Response): Promise<void> {
  try {
    res.json(await MasterApiServices.getDeployments());
  } catch (error) {
    sendError(res, error);
  }
}

export async function getHybrid(_req: Request, res: Response): Promise<void> {
  try {
    res.json(MasterApiServices.getHybrid());
  } catch (error) {
    sendError(res, error);
  }
}

export async function getSystem(_req: Request, res: Response): Promise<void> {
  try {
    res.json(await MasterApiServices.getSystem());
  } catch (error) {
    sendError(res, error);
  }
}

function auditQueryString(req: Request, key: string): string | null {
  const raw = req.query[key];
  const value = Array.isArray(raw) ? raw[0] : raw;
  const str = value == null ? '' : String(value).trim();
  return str ? str : null;
}

export async function getAudit(req: Request, res: Response): Promise<void> {
  try {
    const limitRaw = Number(req.query.limit);
    const offsetRaw = Number(req.query.offset);
    const resultRaw = auditQueryString(req, 'result');
    const orderRaw = auditQueryString(req, 'order');
    res.json(
      await MasterApiServices.queryAudit({
        from: auditQueryString(req, 'from'),
        to: auditQueryString(req, 'to'),
        companyId:
          auditQueryString(req, 'companyId') ?? auditQueryString(req, 'company'),
        actor:
          auditQueryString(req, 'actor') ?? auditQueryString(req, 'user'),
        ip: auditQueryString(req, 'ip'),
        action: auditQueryString(req, 'action'),
        resource: auditQueryString(req, 'resource'),
        result:
          resultRaw === 'success' || resultRaw === 'failure' || resultRaw === 'all'
            ? resultRaw
            : null,
        limit: Number.isFinite(limitRaw) ? limitRaw : 100,
        offset: Number.isFinite(offsetRaw) ? offsetRaw : 0,
        cursor: auditQueryString(req, 'cursor'),
        order: orderRaw === 'asc' ? 'asc' : 'desc',
      }),
    );
  } catch (error) {
    sendError(res, error);
  }
}

export async function getUsers(req: MasterApiRequest, res: Response): Promise<void> {
  try {
    if (!requireHumanMasterActor(req, res)) return;
    res.json(await MasterApiServices.listUsers());
  } catch (error) {
    sendError(res, error);
  }
}

export async function postUser(req: MasterApiRequest, res: Response): Promise<void> {
  try {
    if (!requireHumanMasterActor(req, res)) return;
    const parsed = validateCreateMasterUserBody(req.body);
    if (!parsed.ok) {
      res.status(400).json({ ok: false, error: 'validation_error', message: parsed.message });
      return;
    }
    const targetRole = String(parsed.value.role) as MasterRole;
    const actorRole = req.masterAuth?.role;
    if (!actorRole || !canManageMasterRole(actorRole, targetRole)) {
      audit(req, {
        actorUserId: req.masterAuth?.userId ?? null,
        actorEmail: req.masterAuth?.email ?? null,
        action: 'USER_CREATE_DENIED',
        resource: 'master_users',
        message: `Criação de ${targetRole} negada para ${actorRole ?? 'sem perfil'}`,
        meta: {
          targetEmail: String(parsed.value.email),
          targetRole,
          actorRole: actorRole ?? null,
        },
      });
      sendPolicyForbidden(
        res,
        targetRole === 'MASTER_OWNER'
          ? 'Somente OWNER pode criar ou alterar outro OWNER.'
          : 'Perfil Master não autorizado a gerir usuários.',
      );
      return;
    }
    const result = await MasterApiServices.createUser({
      email: String(parsed.value.email),
      name: String(parsed.value.name),
      password: String(parsed.value.password),
      role: targetRole,
    });
    audit(req, {
      actorUserId: req.masterAuth?.userId ?? null,
      actorEmail: req.masterAuth?.email ?? null,
      action: 'USER_CREATE_REQUEST',
      resource: 'master_users',
      message: `Create user ${result.user.email}`,
      after: {
        id: result.user.id,
        email: result.user.email,
        name: result.user.name,
        role: result.user.role,
        active: result.user.active,
      },
    });
    res.status(201).json(result);
  } catch (error) {
    sendError(res, error);
  }
}

export async function patchUser(req: MasterApiRequest, res: Response): Promise<void> {
  try {
    if (!requireHumanMasterActor(req, res)) return;
    const id = String(req.params.id || '').trim();
    const idParsed = validateIdParam(id);
    if (!idParsed.ok) {
      res.status(400).json({ ok: false, error: 'validation_error', message: idParsed.message });
      return;
    }
    const parsed = validateUpdateMasterUserBody(req.body);
    if (!parsed.ok) {
      res.status(400).json({ ok: false, error: 'validation_error', message: parsed.message });
      return;
    }

    const current = await MasterApiServices.auth().getUser(id);
    const nextRole = (parsed.value.role as MasterRole | undefined) ?? current.role;
    const actorRole = req.masterAuth?.role;
    const actorUserId = req.masterAuth?.userId ?? null;
    const actor = actorUserId
      ? await MasterApiServices.auth().getUser(actorUserId).catch(() => null)
      : null;
    const actorIsFounder = actor?.isFounder === true;

    if (!actorRole || !canManageMasterUser(actorRole, current.role, nextRole)) {
      sendPolicyForbidden(
        res,
        current.role === 'MASTER_OWNER' || nextRole === 'MASTER_OWNER'
          ? 'Somente OWNER pode alterar outro OWNER.'
          : 'Perfil Master não autorizado a alterar este usuário.',
      );
      return;
    }

    const denyFounder = (deniedAction: string, reason: string, message: string) => {
      audit(req, {
        actorUserId,
        actorEmail: req.masterAuth?.email ?? null,
        actorRole: actorRole ?? null,
        action: 'SECURITY_PROTECTED_ACCOUNT',
        resource: 'master_users',
        message: `Tentativa negada sobre Founder (${deniedAction})`,
        companyId: null,
        before: {
          id: current.id,
          role: current.role,
          active: current.active,
          isFounder: current.isFounder,
        },
        after: null,
        meta: {
          denialAction: deniedAction,
          reason,
          result: 'denied',
          targetUserId: current.id,
          patch: parsed.value,
        },
      });
      res.status(403).json({
        ok: false,
        error: 'MASTER_FORBIDDEN',
        code: deniedAction,
        action: deniedAction,
        result: 'denied',
        message,
      });
    };

    // Mutações destrutivas no Founder: sempre 403 (qualquer ator, inclusive outro Founder).
    if (current.isFounder === true) {
      if (parsed.value.active === false) {
        denyFounder(
          'FOUNDER_BLOCK_DENIED',
          'founder_nao_pode_ser_bloqueado',
          'Conta Founder protegida: não pode ser bloqueada ou desativada.',
        );
        return;
      }
      if (parsed.value.role != null && parsed.value.role !== current.role) {
        denyFounder(
          'FOUNDER_ROLE_CHANGE_DENIED',
          'founder_nao_pode_ser_rebaixado',
          'Conta Founder protegida: o perfil não pode ser alterado.',
        );
        return;
      }
    }

    if (
      !canMutateFounderAccount({
        actorIsFounder,
        actorUserId,
        targetIsFounder: current.isFounder === true,
        targetUserId: current.id,
      })
    ) {
      denyFounder(
        'FOUNDER_ROLE_CHANGE_DENIED',
        'owner_comum_nao_pode_alterar_founder',
        'Conta Founder protegida: OWNER comum não pode alterá-la.',
      );
      return;
    }

    try {
      const result = await MasterApiServices.updateUser(
        id,
        {
          name: parsed.value.name as string | undefined,
          role: parsed.value.role as MasterRole | undefined,
          active: parsed.value.active as boolean | undefined,
        },
        { id: actorUserId, isFounder: actorIsFounder },
      );
      audit(req, {
        actorUserId,
        actorEmail: req.masterAuth?.email ?? null,
        action: 'USER_UPDATE_REQUEST',
        resource: 'master_users',
        message: `Atualização de ${result.user.email}`,
        before: {
          id: current.id,
          email: current.email,
          name: current.name,
          role: current.role,
          active: current.active,
          isFounder: current.isFounder,
        },
        after: {
          id: result.user.id,
          email: result.user.email,
          name: result.user.name,
          role: result.user.role,
          active: result.user.active,
          isFounder: result.user.isFounder,
        },
        meta: { userId: id, role: result.user.role, active: result.user.active },
      });
      res.json(result);
    } catch (error) {
      if (error instanceof MasterFounderProtectedError) {
        audit(req, {
          actorUserId,
          actorEmail: req.masterAuth?.email ?? null,
          actorRole: actorRole ?? null,
          action: 'SECURITY_PROTECTED_ACCOUNT',
          resource: 'master_users',
          message: `Tentativa negada sobre Founder (${error.action})`,
          before: {
            id: current.id,
            role: current.role,
            active: current.active,
            isFounder: current.isFounder,
          },
          after: null,
          meta: {
            denialAction: error.action,
            reason: error.reason,
            result: 'denied',
            targetUserId: current.id,
            patch: parsed.value,
          },
        });
      }
      throw error;
    }
  } catch (error) {
    sendError(res, error);
  }
}

export async function postUserResetPassword(
  req: MasterApiRequest,
  res: Response,
): Promise<void> {
  try {
    if (!requireHumanMasterActor(req, res)) return;
    const id = String(req.params.id || '').trim();
    const idParsed = validateIdParam(id);
    if (!idParsed.ok) {
      res.status(400).json({ ok: false, error: 'validation_error', message: idParsed.message });
      return;
    }
    const parsed = validateResetMasterUserPasswordBody(req.body);
    if (!parsed.ok) {
      res.status(400).json({ ok: false, error: 'validation_error', message: parsed.message });
      return;
    }

    const current = await MasterApiServices.auth().getUser(id);
    const actorRole = req.masterAuth?.role;
    const actorUserId = req.masterAuth?.userId ?? null;
    const actor = actorUserId
      ? await MasterApiServices.auth().getUser(actorUserId).catch(() => null)
      : null;
    const actorIsFounder = actor?.isFounder === true;

    if (!actorRole || !canManageMasterUser(actorRole, current.role)) {
      sendPolicyForbidden(
        res,
        current.role === 'MASTER_OWNER'
          ? 'Somente OWNER pode redefinir a senha de outro OWNER.'
          : 'Perfil Master não autorizado a redefinir esta senha.',
      );
      return;
    }

    if (
      current.isFounder &&
      !canMutateFounderAccount({
        actorIsFounder,
        actorUserId,
        targetIsFounder: true,
        targetUserId: current.id,
      })
    ) {
      audit(req, {
        actorUserId,
        actorEmail: req.masterAuth?.email ?? null,
        actorRole: actorRole ?? null,
        action: 'SECURITY_PROTECTED_ACCOUNT',
        resource: 'master_users',
        message: 'Tentativa negada sobre Founder (FOUNDER_ROLE_CHANGE_DENIED)',
        before: { id: current.id, isFounder: true },
        after: null,
        meta: {
          denialAction: 'FOUNDER_ROLE_CHANGE_DENIED',
          reason: 'owner_comum_nao_pode_redefinir_senha_founder',
          result: 'denied',
          targetUserId: current.id,
        },
      });
      res.status(403).json({
        ok: false,
        error: 'MASTER_FORBIDDEN',
        code: 'FOUNDER_ROLE_CHANGE_DENIED',
        action: 'FOUNDER_ROLE_CHANGE_DENIED',
        result: 'denied',
        message: 'Conta Founder protegida: somente outro Founder pode alterar dados permitidos.',
      });
      return;
    }

    try {
      const result = await MasterApiServices.resetUserPassword(
        id,
        String(parsed.value.newPassword),
        { id: actorUserId, isFounder: actorIsFounder },
      );
      audit(req, {
        actorUserId,
        actorEmail: req.masterAuth?.email ?? null,
        action: 'USER_PASSWORD_RESET_REQUEST',
        resource: 'master_users',
        message: `Redefinição de senha de ${result.user.email}`,
        before: { id: current.id, email: current.email, passwordChanged: false },
        after: { id: result.user.id, email: result.user.email, passwordChanged: true },
        meta: { userId: id },
      });
      res.json(result);
    } catch (error) {
      if (error instanceof MasterFounderProtectedError) {
        audit(req, {
          actorUserId,
          actorEmail: req.masterAuth?.email ?? null,
          actorRole: actorRole ?? null,
          action: 'SECURITY_PROTECTED_ACCOUNT',
          resource: 'master_users',
          message: `Tentativa negada sobre Founder (${error.action})`,
          before: { id: current.id, isFounder: current.isFounder },
          after: null,
          meta: {
            denialAction: error.action,
            reason: error.reason,
            result: 'denied',
            targetUserId: current.id,
          },
        });
      }
      throw error;
    }
  } catch (error) {
    sendError(res, error);
  }
}
