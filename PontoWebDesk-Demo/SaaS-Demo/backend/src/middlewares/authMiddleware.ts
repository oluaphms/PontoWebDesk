import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { isTokenRevoked } from '../services/tokenRevocationService.js';
import { resolveCallerFromDb } from '../services/callerContextService.js';
import {
  isCommercialGateUnavailableError,
  readCompanySessionGate,
} from '../master/commercial/companySessionRevocation.js';
import { updateRequestContext } from '../logger/logger.context.js';
import { clearAuthCookie, getAuthCookie } from '../security/authCookies.js';
import { clearCsrfCookie } from '../security/csrfCookies.js';
import { resolveAuthToken } from '../security/sessionToken.js';
import { logger } from '../logger/logger.js';

export type JwtPayload = {
  sub: string;
  userId?: string;
  companyId: string;
  role?: string;
  jti?: string;
  /** Versão de sessão da empresa no momento do login. */
  companySessionVersion?: number;
};

export type AuthedRequest = Request & {
  auth?: JwtPayload;
};

const COMMERCIAL_BLOCKED_CODE = 'COMMERCIAL_BLOCKED_BY_MASTER';

function authError(res: Response, status: number, error: string, code = error): void {
  res.status(status).json({
    ok: false,
    success: false,
    error,
    code,
    message: error === 'commercial_blocked'
      ? 'Acesso bloqueado pelo Painel Master. Entre em contato com o suporte comercial.'
      : undefined,
  });
}

function clearOperationalSessionCookies(res: Response): void {
  clearAuthCookie(res);
  clearCsrfCookie(res);
}

function normCompanyId(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

function jwtSessionVersion(decoded: JwtPayload): number {
  const raw = decoded.companySessionVersion;
  if (raw == null) return 0;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Gate comercial + versão de sessão.
 * Independente de AUTH_REVALIDATE_DB — bloqueio Master deve valer imediatamente.
 */
async function enforceCommercialSessionGate(
  req: AuthedRequest,
  res: Response,
  decoded: JwtPayload,
  companyId: string,
): Promise<boolean> {
  const gate = await readCompanySessionGate(companyId);
  if (!gate) {
    throw new Error('COMMERCIAL_GATE_COMPANY_NOT_FOUND');
  }

  if (gate.commercialBlocked) {
    logger.warn({
      module: 'auth.middleware',
      action: 'AUTH_COMMERCIAL_BLOCKED',
      message: 'Sessão recusada — empresa bloqueada pelo Master',
      userId: decoded.userId ?? decoded.sub ?? null,
      companyId,
      meta: {
        method: req.method,
        path: req.originalUrl,
        reason: gate.commercialBlockReason,
      },
    });
    clearOperationalSessionCookies(res);
    authError(res, 401, 'commercial_blocked', COMMERCIAL_BLOCKED_CODE);
    return false;
  }

  const tokenVersion = jwtSessionVersion(decoded);
  if (tokenVersion < gate.companySessionVersion) {
    logger.warn({
      module: 'auth.middleware',
      action: 'AUTH_TOKEN_REVOKED',
      message: 'Token recusado — versão de sessão da empresa desatualizada (bloqueio comercial)',
      userId: decoded.userId ?? decoded.sub ?? null,
      companyId,
      meta: {
        method: req.method,
        path: req.originalUrl,
        reason: 'company_session_version',
        tokenVersion,
        companySessionVersion: gate.companySessionVersion,
        commercialBlocked: gate.commercialBlocked,
        jwtIat: (decoded as JwtPayload & { iat?: number }).iat ?? null,
      },
    });
    clearOperationalSessionCookies(res);
    authError(res, 401, 'token_revoked', 'AUTH_TOKEN_REVOKED');
    return false;
  }

  return true;
}

function isAuthMeSessionProbe(req: Request): boolean {
  if (req.method !== 'GET') return false;
  const path = String(req.originalUrl || req.path || '').split('?')[0];
  return /\/auth\/me\/?$/.test(path);
}

export async function authMiddleware(req: AuthedRequest, res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization;
  const bearerToken = header?.startsWith('Bearer ') ? header.slice(7) : null;
  const cookieToken = getAuthCookie(req);
  const token = resolveAuthToken(bearerToken, cookieToken);
  if (!token) {
    // Probe de sessão (boot / login): 200 neutro evita ruído no Network do browser.
    // Demais rotas autenticadas continuam 401.
    if (isAuthMeSessionProbe(req)) {
      logger.info({
        module: 'auth.middleware',
        action: 'AUTH_ME_NO_SESSION',
        message: 'GET /auth/me sem credencial — resposta neutra de sessão',
        meta: {
          method: req.method,
          path: req.originalUrl,
          hasAuthorizationHeader: Boolean(header),
          hasAuthCookie: Boolean(cookieToken),
        },
      });
      res.status(200).json({
        ok: false,
        success: false,
        error: 'missing_token',
        code: 'AUTH_MISSING_TOKEN',
        user: null,
      });
      return;
    }
    logger.warn({
      module: 'auth.middleware',
      action: 'AUTH_MISSING_TOKEN',
      message: 'Requisição autenticada sem Bearer token nem cookie de sessão',
      meta: {
        method: req.method,
        path: req.originalUrl,
        hasAuthorizationHeader: Boolean(header),
        hasAuthCookie: Boolean(cookieToken),
      },
    });
    authError(res, 401, 'missing_token', 'AUTH_MISSING_TOKEN');
    return;
  }
  const secret = String(process.env.JWT_SECRET || '').trim();
  if (!secret) {
    authError(res, 503, 'auth_not_configured', 'AUTH_NOT_CONFIGURED');
    return;
  }

  try {
    const decoded = jwt.verify(token, secret, { algorithms: ['HS256'] }) as JwtPayload;

    if (decoded.jti && (await isTokenRevoked(decoded.jti))) {
      logger.warn({
        module: 'auth.middleware',
        action: 'AUTH_TOKEN_REVOKED',
        message: 'Token recusado por revogação (jti)',
        userId: decoded.userId ?? decoded.sub ?? null,
        companyId: decoded.companyId ?? null,
        meta: {
          method: req.method,
          path: req.originalUrl,
          reason: 'jti_revoked',
          jtiPresent: true,
        },
      });
      clearOperationalSessionCookies(res);
      authError(res, 401, 'token_revoked', 'AUTH_TOKEN_REVOKED');
      return;
    }

    const isProduction = String(process.env.NODE_ENV || '').trim().toLowerCase() === 'production';
    let revalidateDb = String(process.env.AUTH_REVALIDATE_DB ?? 'true').trim().toLowerCase() !== 'false';
    if (isProduction && !revalidateDb) {
      logger.warn({
        module: 'auth.middleware',
        action: 'SECURITY',
        message: '[SECURITY] AUTH_REVALIDATE_DB forced ON in production',
      });
      revalidateDb = true;
    }

    let companyIdForGate = String(decoded.companyId || '').trim();

    if (revalidateDb) {
      const caller = await resolveCallerFromDb(decoded);
      if (!caller?.companyId) {
        logger.warn({
          module: 'auth.middleware',
          action: 'AUTH_USER_NOT_FOUND',
          message: '[AUTH-FLOW] USER_NOT_FOUND — resolveCallerFromDb retornou null',
          userId: decoded.userId ?? decoded.sub ?? null,
          companyId: decoded.companyId ?? null,
          meta: { method: req.method, path: req.originalUrl, jwtCompanyId: decoded.companyId ?? null },
        });
        authError(res, 401, 'user_not_found', 'AUTH_USER_NOT_FOUND');
        return;
      }
      const jwtCompanyId = normCompanyId(decoded.companyId);
      const dbCompanyId = normCompanyId(caller.companyId);
      if (dbCompanyId !== jwtCompanyId) {
        logger.warn({
          module: 'auth.middleware',
          action: 'AUTH_TENANT_CHANGED',
          message: '[AUTH-FLOW] TENANT_CHANGED — empresa do JWT diverge do banco',
          userId: caller.userId,
          companyId: caller.companyId,
          meta: {
            tokenCompanyId: decoded.companyId ?? null,
            dbCompanyId: caller.companyId,
            jwtCompanyIdNorm: jwtCompanyId,
            dbCompanyIdNorm: dbCompanyId,
            method: req.method,
            path: req.originalUrl,
          },
        });
        authError(res, 401, 'tenant_changed', 'AUTH_TENANT_CHANGED');
        return;
      }
      companyIdForGate = caller.companyId;
      req.auth = {
        ...decoded,
        sub: caller.userId,
        userId: caller.userId,
        companyId: caller.companyId,
        role: caller.role,
      };
      updateRequestContext({ userId: caller.userId, companyId: caller.companyId, role: caller.role });
    } else {
      req.auth = decoded;
      updateRequestContext({
        userId: decoded.userId ?? decoded.sub ?? null,
        companyId: decoded.companyId ?? null,
        role: decoded.role ?? null,
      });
    }

    if (!(await enforceCommercialSessionGate(req, res, decoded, companyIdForGate))) {
      return;
    }

    next();
  } catch (e) {
    if (
      isCommercialGateUnavailableError(e) ||
      (e instanceof Error && e.message === 'COMMERCIAL_GATE_COMPANY_NOT_FOUND')
    ) {
      logger.error({
        module: 'auth.middleware',
        action: 'AUTH_COMMERCIAL_GATE_UNAVAILABLE',
        message: 'Acesso recusado — não foi possível validar o bloqueio comercial',
        error: e,
        meta: { method: req.method, path: req.originalUrl },
      });
      authError(res, 503, 'commercial_gate_unavailable', 'COMMERCIAL_GATE_UNAVAILABLE');
      return;
    }
    const err = e as { name?: string };
    if (err?.name === 'TokenExpiredError') {
      logger.warn({
        module: 'auth.middleware',
        action: 'AUTH_TOKEN_EXPIRED',
        message: 'Token expirado',
        meta: { method: req.method, path: req.originalUrl },
      });
      authError(res, 401, 'token_expired', 'AUTH_TOKEN_EXPIRED');
      return;
    }
    logger.warn({
      module: 'auth.middleware',
      action: 'AUTH_INVALID_TOKEN',
      message: 'Token inválido',
      error: e,
      meta: { method: req.method, path: req.originalUrl },
    });
    authError(res, 401, 'invalid_token', 'AUTH_INVALID_TOKEN');
  }
}
