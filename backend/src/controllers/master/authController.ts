import type { Request, Response } from 'express';
import { MasterError } from '../../master/errors.js';
import { getMasterAuthService } from '../../services/master/masterPlatformService.js';
import {
  clearMasterSessionCookie,
  setMasterRefreshCookie,
  setMasterSessionCookie,
} from '../../master/auth/masterSessionCookies.js';
import { permissionsForRole } from '../../master/auth/MasterPermission.js';
import {
  MASTER_AUTH_COOKIE,
  MASTER_REFRESH_COOKIE,
} from '../../master/auth/MasterJWT.js';

function extractAccess(req: Request): string {
  const body = req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {};
  const fromBody = String(body.token || '').trim();
  if (fromBody) return fromBody;
  const header = String(req.headers.authorization || '').trim();
  if (/^bearer\s+/i.test(header)) return header.replace(/^bearer\s+/i, '').trim();
  const cookieHeader = String(req.headers.cookie || '');
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${MASTER_AUTH_COOKIE}=([^;]+)`));
  if (match?.[1]) return decodeURIComponent(match[1]);
  return '';
}

function extractRefresh(req: Request): string {
  const body = req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {};
  const fromBody = String(body.refreshToken || '').trim();
  if (fromBody) return fromBody;
  const cookieHeader = String(req.headers.cookie || '');
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${MASTER_REFRESH_COOKIE}=([^;]+)`));
  if (match?.[1]) return decodeURIComponent(match[1]);
  return '';
}

/** POST /api/master/auth/login — login exclusivo do Painel Master (legado/compat). */
export async function masterLoginController(req: Request, res: Response): Promise<void> {
  try {
    const body = req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {};
    const email = String(body.email || '').trim();
    const password = String(body.password || '');
    const auth = getMasterAuthService();
    await auth.ensureBootstrapOwner();
    const session = await auth.login({ email, password });
    setMasterSessionCookie(res, session.token);
    setMasterRefreshCookie(res, session.refreshToken);
    res.json({
      ok: true,
      session,
      tokenType: 'master',
      note: 'Use Authorization: Bearer <token> nas rotas /api/master/*',
    });
  } catch (error) {
    if (error instanceof MasterError && error.code === 'MASTER_INVALID') {
      res.status(401).json({
        ok: false,
        error: 'invalid_master_credentials',
        code: 'MASTER_LOGIN_FAILED',
        message: 'Credenciais Master inválidas.',
      });
      return;
    }
    res.status(500).json({
      ok: false,
      error: 'master_login_failed',
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

/** POST /api/master/auth/logout — revoga sessão Master. */
export async function masterLogoutController(req: Request, res: Response): Promise<void> {
  try {
    const auth = getMasterAuthService();
    const result = await auth.logout({
      token: extractAccess(req) || null,
      refreshToken: extractRefresh(req) || null,
      reason: 'logout',
    });
    clearMasterSessionCookie(res);
    res.json({
      ok: true,
      tokenType: 'master' as const,
      revoked: result.revoked,
      sessionId: result.sessionId,
      message: 'Sessão Master encerrada.',
    });
  } catch (error) {
    clearMasterSessionCookie(res);
    res.status(500).json({
      ok: false,
      error: 'master_logout_failed',
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

/** POST /api/master/auth/refresh */
export async function masterRefreshController(req: Request, res: Response): Promise<void> {
  try {
    const auth = getMasterAuthService();
    const session = await auth.refresh({
      token: extractAccess(req) || undefined,
      refreshToken: extractRefresh(req) || undefined,
    });
    setMasterSessionCookie(res, session.token);
    setMasterRefreshCookie(res, session.refreshToken);
    res.json({ ok: true, session, tokenType: 'master' });
  } catch (error) {
    if (error instanceof MasterError && error.code === 'MASTER_INVALID') {
      res.status(401).json({
        ok: false,
        error: 'unauthorized',
        code: 'MASTER_TOKEN_INVALID',
        message: 'Sessão Master inválida ou expirada.',
      });
      return;
    }
    res.status(500).json({
      ok: false,
      error: 'master_refresh_failed',
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

/** GET /api/master/auth/me */
export async function masterMeController(req: Request, res: Response): Promise<void> {
  const masterAuth = (req as Request & { masterAuth?: unknown }).masterAuth ?? null;
  const role =
    masterAuth && typeof masterAuth === 'object' && 'role' in masterAuth
      ? (masterAuth as { role: Parameters<typeof permissionsForRole>[0] }).role
      : null;
  res.json({
    ok: true,
    tokenType: 'master',
    masterAuth,
    permissions: role ? permissionsForRole(role) : [],
  });
}
