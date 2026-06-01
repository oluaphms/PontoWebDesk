import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { isTokenRevoked } from '../services/tokenRevocationService.js';
import { resolveCallerFromDb } from '../services/callerContextService.js';
import { updateRequestContext } from '../logger/logger.context.js';
import { getAuthCookie } from '../security/authCookies.js';
import { logger } from '../logger/logger.js';

export type JwtPayload = {
  sub: string;
  userId?: string;
  companyId: string;
  role?: string;
  jti?: string;
};

export type AuthedRequest = Request & {
  auth?: JwtPayload;
};

function authError(res: Response, status: number, error: string, code = error): void {
  res.status(status).json({
    ok: false,
    success: false,
    error,
    code,
  });
}

export async function authMiddleware(req: AuthedRequest, res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization;
  const bearerToken = header?.startsWith('Bearer ') ? header.slice(7) : null;
  const cookieToken = getAuthCookie(req);
  const token = bearerToken || cookieToken;
  if (!token) {
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
    const decoded = jwt.verify(token, secret) as JwtPayload;

    if (decoded.jti && (await isTokenRevoked(decoded.jti))) {
      logger.warn({
        module: 'auth.middleware',
        action: 'AUTH_TOKEN_REVOKED',
        message: 'Token recusado por revogação',
        userId: decoded.userId ?? decoded.sub ?? null,
        companyId: decoded.companyId ?? null,
        meta: { method: req.method, path: req.originalUrl },
      });
      authError(res, 401, 'token_revoked', 'AUTH_TOKEN_REVOKED');
      return;
    }

    const revalidateDb = String(process.env.AUTH_REVALIDATE_DB ?? 'true').trim().toLowerCase() !== 'false';
    if (revalidateDb) {
      const caller = await resolveCallerFromDb(decoded);
      if (!caller?.companyId) {
        logger.warn({
          module: 'auth.middleware',
          action: 'AUTH_USER_NOT_FOUND',
          message: 'Token válido, mas usuário não foi localizado no banco',
          userId: decoded.userId ?? decoded.sub ?? null,
          companyId: decoded.companyId ?? null,
          meta: { method: req.method, path: req.originalUrl },
        });
        authError(res, 401, 'user_not_found', 'AUTH_USER_NOT_FOUND');
        return;
      }
      if (caller.companyId !== String(decoded.companyId || '').trim()) {
        logger.warn({
          module: 'auth.middleware',
          action: 'AUTH_TENANT_CHANGED',
          message: 'Empresa do token diverge da empresa atual do usuário',
          userId: caller.userId,
          companyId: caller.companyId,
          meta: { tokenCompanyId: decoded.companyId ?? null, method: req.method, path: req.originalUrl },
        });
        authError(res, 401, 'tenant_changed', 'AUTH_TENANT_CHANGED');
        return;
      }
      req.auth = {
        ...decoded,
        sub: caller.userId,
        userId: caller.userId,
        companyId: caller.companyId,
        role: caller.role,
      };
      updateRequestContext({ userId: caller.userId, companyId: caller.companyId });
    } else {
      req.auth = decoded;
      updateRequestContext({
        userId: decoded.userId ?? decoded.sub ?? null,
        companyId: decoded.companyId ?? null,
      });
    }

    next();
  } catch (e) {
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
