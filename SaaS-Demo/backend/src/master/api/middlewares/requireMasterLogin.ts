/**
 * requireMasterLogin() — autenticação JWT Master (MASTER_JWT_SECRET).
 * Valida sessão server-side (revogação). Não usa JWT_SECRET / login das empresas.
 */
import { timingSafeEqual } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import type { MasterAuthContext } from '../../auth/masterAuth.types.js';
import {
  MASTER_AUTH_COOKIE,
  decodeMasterJWT,
  verifyMasterToken,
} from '../../auth/MasterJWT.js';
import { MasterPlatformService } from '../../../services/master/masterPlatformService.js';
import { enrichMasterAuditInput } from '../services/audit.service.js';

export type MasterApiRequest = Request & {
  masterAuth?: MasterAuthContext;
  masterKeyAuth?: boolean;
  masterAccessToken?: string;
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

export function extractMasterToken(req: Request): string {
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
 * Exige login Master:
 * 1) X-Master-Key (bootstrap)
 * 2) Bearer / cookie Master JWT ativo (não revogado)
 */
export function requireMasterLogin() {
  return (req: MasterApiRequest, res: Response, next: NextFunction): void => {
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
        error: 'unauthorized',
        code: 'MASTER_AUTH_REQUIRED',
        message: 'Login Master necessário.',
      });
      return;
    }

    const cryptoOk = verifyMasterToken(token);
    if (!cryptoOk) {
      const decoded = decodeMasterJWT(token);
      const expired = Boolean(decoded?.exp && decoded.exp * 1000 <= Date.now());
      try {
        MasterPlatformService.getAudit().append(
          enrichMasterAuditInput(req, {
            actorUserId: decoded?.sub ?? null,
            actorEmail: decoded?.email ?? null,
            actorRole: decoded?.role ?? null,
            action: expired ? 'LOGIN_SESSION_EXPIRED' : 'MASTER_AUTH_INVALID_ATTEMPT',
            resource: 'auth',
            message: expired ? 'Sessão Master expirada' : 'JWT Master inválido',
            meta: {
              path: req.path,
              sessionId: decoded?.sessionId ?? null,
              reason: expired ? 'access_token_expired' : 'invalid_token',
            },
          }),
        );
      } catch {
        /* audit best-effort */
      }
      res.status(401).json({
        ok: false,
        error: 'unauthorized',
        code: 'MASTER_TOKEN_INVALID',
        message: 'Sessão Master inválida ou expirada.',
      });
      return;
    }

    void (async () => {
      try {
        const auth = MasterPlatformService.getAuth();
        const session = await auth.assertActiveAccess(token);
        if (!session) {
          const storedSession = cryptoOk.sessionId
            ? await auth.getSessionStore().findById(cryptoOk.sessionId)
            : null;
          const expired = Boolean(
            storedSession &&
              Date.parse(storedSession.refreshExpiresAt) <= Date.now(),
          );
          try {
            MasterPlatformService.getAudit().append(
              enrichMasterAuditInput(req, {
                actorUserId: cryptoOk.userId,
                actorEmail: cryptoOk.email,
                actorRole: cryptoOk.role,
                action: expired ? 'LOGIN_SESSION_EXPIRED' : 'MASTER_TOKEN_REVOKED',
                resource: 'auth',
                message: expired
                  ? 'Sessão Master server-side expirada'
                  : 'Tentativa com token Master revogado',
                meta: {
                  sessionId: cryptoOk.sessionId ?? null,
                  jti: cryptoOk.jti ?? null,
                  path: req.path,
                  reason: expired ? 'refresh_session_expired' : 'revoked_or_rotated',
                },
              }),
            );
          } catch {
            /* audit best-effort */
          }
          res.status(401).json({
            ok: false,
            error: 'unauthorized',
            code: 'MASTER_TOKEN_REVOKED',
            message:
              'Sessão Master inválida ou expirada. Faça login novamente (ou atualize a página se o servidor reiniciou).',
          });
          return;
        }
        req.masterAuth = session;
        req.masterAccessToken = token;
        next();
      } catch {
        res.status(401).json({
          ok: false,
          error: 'unauthorized',
          code: 'MASTER_TOKEN_INVALID',
          message: 'Sessão Master inválida ou expirada.',
        });
      }
    })();
  };
}
