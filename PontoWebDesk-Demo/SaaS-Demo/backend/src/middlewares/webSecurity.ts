import type { Request, Response, NextFunction } from 'express';
import { buildCorsAllowList, isOriginAllowed } from '../corsConfig.js';
import { getAuthCookie } from '../security/authCookies.js';
import { CSRF_HEADER_NAME, getCsrfCookie } from '../security/csrfCookies.js';
import { MASTER_AUTH_COOKIE, MASTER_REFRESH_COOKIE } from '../master/auth/MasterJWT.js';
import { logger } from '../logger/logger.js';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Rotas isentas de CSRF/Origin (auth de dispositivo, login, health). */
const CSRF_SKIP_PREFIXES = [
  '/api/rep/',
  '/api/auth/login',
  '/api/auth/reset-password',
  '/api/auth/recovery',
  '/api/master/auth/login',
  '/api/health',
  '/health',
];

function hasBearerAuth(req: Request): boolean {
  const h = String(req.headers.authorization || '');
  return h.toLowerCase().startsWith('bearer ');
}

function shouldSkipWebSecurity(req: Request): boolean {
  const path = req.originalUrl.split('?')[0] || req.path;
  return CSRF_SKIP_PREFIXES.some((prefix) => path.startsWith(prefix));
}

function resolveTrustedOrigin(req: Request, allowList: string[]): boolean {
  const origin = String(req.headers.origin || '').trim();
  if (origin) {
    return isOriginAllowed(origin, allowList);
  }

  const referer = String(req.headers.referer || req.headers.referrer || '').trim();
  if (referer) {
    try {
      const refOrigin = new URL(referer).origin;
      return isOriginAllowed(refOrigin, allowList);
    } catch {
      return false;
    }
  }

  // Sem Origin/Referer: curl, agente REP, mobile — permitido.
  return true;
}

function csrfValid(req: Request): boolean {
  const cookieToken = getCsrfCookie(req);
  const headerToken = String(req.headers[CSRF_HEADER_NAME] || '').trim();
  if (!cookieToken || !headerToken) return false;
  return cookieToken === headerToken;
}

function hasMasterSessionCookie(req: Request): boolean {
  const raw = String(req.headers.cookie || '');
  if (!raw) return false;
  return raw.includes(`${MASTER_AUTH_COOKIE}=`) || raw.includes(`${MASTER_REFRESH_COOKIE}=`);
}

/**
 * Proteção CSRF + validação Origin/Referer para mutações com sessão por cookie.
 * Bearer (REP/dispositivos) não exige CSRF.
 */
export function webSecurityMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (!MUTATING.has(req.method.toUpperCase())) {
    next();
    return;
  }
  if (shouldSkipWebSecurity(req)) {
    next();
    return;
  }
  if (hasBearerAuth(req)) {
    next();
    return;
  }

  const hasOperationalSessionCookie = Boolean(getAuthCookie(req));
  const hasMasterCookie = hasMasterSessionCookie(req);
  if (!hasOperationalSessionCookie && !hasMasterCookie) {
    next();
    return;
  }

  const allowList = buildCorsAllowList();
  if (!resolveTrustedOrigin(req, allowList)) {
    logger.warn({
      module: 'security.web',
      action: 'FORBIDDEN_ORIGIN',
      message: 'Origin/Referer não confiável em mutação autenticada por cookie',
      meta: {
        method: req.method,
        path: req.originalUrl,
        origin: req.headers.origin || null,
        referer: req.headers.referer || null,
      },
    });
    res.status(403).json({
      ok: false,
      success: false,
      error: 'forbidden_origin',
      code: 'FORBIDDEN_ORIGIN',
      message: 'Origem não permitida.',
    });
    return;
  }

  if (!csrfValid(req)) {
    logger.warn({
      module: 'security.web',
      action: 'CSRF_INVALID',
      message: 'Token CSRF ausente ou inválido',
      meta: { method: req.method, path: req.originalUrl },
    });
    res.status(403).json({
      ok: false,
      success: false,
      error: 'csrf_invalid',
      code: 'CSRF_INVALID',
      message: 'Requisição bloqueada (CSRF).',
    });
    return;
  }

  next();
}
