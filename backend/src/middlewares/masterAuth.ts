/**
 * Middlewares de autenticação do Painel Master (legado / compat).
 *
 * Preferir na API nova:
 *   requireMasterLogin / requireMasterPermission (backend/src/master/api)
 *
 * - requireMasterAuth() — exige sessão Master (token próprio)
 * - requireMasterRole(...roles) — exige MasterRole específica
 *
 * Não altera authMiddleware / JWT_SECRET / login das empresas.
 */
import { timingSafeEqual } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import type { MasterAuthContext, MasterRole } from '../master/auth/masterAuth.types.js';
import { MASTER_ROLES } from '../master/auth/masterAuth.types.js';
import {
  MASTER_AUTH_COOKIE,
  verifyMasterToken,
} from '../master/auth/MasterJWT.js';

export {
  requireMasterLogin,
  requireMasterPermission,
} from '../master/api/middlewares/index.js';

export type MasterRequest = Request & {
  masterAuth?: MasterAuthContext;
  masterKeyAuth?: boolean;
};

function secureEqual(a: string, b: string): boolean {
  const aa = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  if (aa.length !== bb.length) return false;
  return timingSafeEqual(aa, bb);
}

function readMasterApiKey(): string {
  return String(process.env.MASTER_API_KEY || '').trim();
}

function isMasterApiKeyEnabled(): boolean {
  const explicit = String(process.env.MASTER_API_KEY_ENABLED || '').trim().toLowerCase();
  if (explicit === '1' || explicit === 'true' || explicit === 'yes') {
    return true;
  }
  // Default deny (RC): exige flag explícita em qualquer ambiente.
  return false;
}

export function hasValidMasterApiKey(req: { headers: Record<string, unknown> }): boolean {
  if (!isMasterApiKeyEnabled()) return false;
  const expected = readMasterApiKey();
  if (!expected) return false;
  const raw = req.headers['x-master-key'] ?? req.headers['X-Master-Key'];
  const provided = String(Array.isArray(raw) ? raw[0] : raw || '').trim();
  if (!provided) return false;
  return secureEqual(provided, expected);
}

function extractMasterToken(req: Request): string {
  const header = String(req.headers.authorization || '').trim();
  if (/^bearer\s+/i.test(header)) {
    return header.replace(/^bearer\s+/i, '').trim();
  }
  const cookieHeader = String(req.headers.cookie || '');
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${MASTER_AUTH_COOKIE}=([^;]+)`));
  if (match?.[1]) return decodeURIComponent(match[1]);
  return '';
}

/**
 * Exige autenticação Master:
 * 1) X-Master-Key (bootstrap) → contexto sintético MASTER_OWNER
 * 2) Bearer / cookie pwd_master_session (MASTER_JWT_SECRET)
 *
 * Nunca valida JWT_SECRET das empresas.
 */
export function requireMasterAuth() {
  return (req: MasterRequest, res: Response, next: NextFunction): void => {
    if (hasValidMasterApiKey(req)) {
      req.masterKeyAuth = true;
      req.masterAuth = {
        userId: 'master-api-key',
        email: 'api-key@master.local',
        name: 'Master API Key',
        role: 'MASTER_AUDITOR',
        viaApiKey: true,
      };
      if (req.method.toUpperCase() !== 'GET') {
        res.status(403).json({
          ok: false,
          success: false,
          error: 'forbidden',
          code: 'MASTER_API_KEY_READ_ONLY',
          message: 'MASTER_API_KEY permite somente rotas de leitura.',
        });
        return;
      }
      next();
      return;
    }

    const token = extractMasterToken(req);
    if (!token) {
      res.status(401).json({
        ok: false,
        success: false,
        error: 'unauthorized',
        code: 'MASTER_AUTH_REQUIRED',
        message: 'Login Master necessário.',
      });
      return;
    }

    const session = verifyMasterToken(token);
    if (!session) {
      res.status(401).json({
        ok: false,
        success: false,
        error: 'unauthorized',
        code: 'MASTER_TOKEN_INVALID',
        message: 'Sessão Master inválida ou expirada.',
      });
      return;
    }

    req.masterAuth = session;
    next();
  };
}

/**
 * Exige uma das MasterRole informadas.
 * Sem argumentos → qualquer MasterRole autenticada.
 */
export function requireMasterRole(...roles: MasterRole[]) {
  const allowed = roles.length > 0 ? roles : [...MASTER_ROLES];
  return (req: MasterRequest, res: Response, next: NextFunction): void => {
    if (!req.masterAuth) {
      res.status(401).json({
        ok: false,
        success: false,
        error: 'unauthorized',
        code: 'MASTER_AUTH_REQUIRED',
        message: 'Login Master necessário.',
      });
      return;
    }
    if (!allowed.includes(req.masterAuth.role)) {
      res.status(403).json({
        ok: false,
        success: false,
        error: 'forbidden',
        code: 'MASTER_FORBIDDEN_ROLE',
        message: 'Permissão Master insuficiente.',
        required: allowed,
        current: req.masterAuth.role,
      });
      return;
    }
    next();
  };
}
