import type { Request, Response } from 'express';
import { authenticateLogin } from '../services/authLoginService.js';
import { clearAuthCookie, setAuthCookie } from '../security/authCookies.js';
import { generateCsrfToken, setCsrfCookie } from '../security/csrfCookies.js';
import { isProduction } from '../security/env.js';
import { logger } from '../logger/logger.js';
import { logAuthEvent } from '../services/authAuditService.js';
import { resolveAccessProfile } from '../utils/accessProfile.js';

export async function loginController(req: Request, res: Response): Promise<void> {
  const body = req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {};
  const rawIdentifier = String(body?.identifier ?? body?.email ?? '').trim().toLowerCase();
  logger.info({
    module: 'auth.login',
    action: 'LOGIN_REQUEST_RECEIVED',
    message: 'Login operacional recebido',
    meta: {
      identifier: rawIdentifier || null,
      ip: req.ip || null,
      userAgent: req.headers['user-agent'] || null,
    },
  });

  try {
    const result = await authenticateLogin(body);

    if ('status' in result) {
      const code =
        'code' in result && result.code
          ? result.code
          : result.status === 503
            ? 'AUTH_NOT_CONFIGURED'
            : result.status === 403
              ? 'COMMERCIAL_BLOCKED_BY_MASTER'
              : 'AUTH_LOGIN_FAILED';
      logger.warn({
        module: 'auth.login',
        action: 'LOGIN_FAILED',
        message: 'Login operacional rejeitado',
        meta: {
          identifier: rawIdentifier || null,
          reason: result.error,
          code,
          status: result.status,
        },
      });
      res.status(result.status).json({
        ok: false,
        success: false,
        error: result.error,
        code,
        message: result.error,
      });
      return;
    }

    // Cross-origin local (Vite :3010 → API :3000): JWT no body só fora de produção.
    // Em production: nunca retornar JWT no body (cookie HttpOnly + CSRF).
    const returnTokenInBody = !isProduction();

    // Evita reaproveitar cookie antigo em localhost cross-port (3010→3000).
    clearAuthCookie(res);
    setAuthCookie(res, result.token);
    const csrfToken = generateCsrfToken();
    setCsrfCookie(res, csrfToken);
    logger.info({
      module: 'auth.login',
      action: 'AUTH_LOGIN_COOKIE_SET',
      message: '[AUTH-FLOW] cookie HttpOnly definido',
      userId: result.user.id,
      companyId: result.user.company_id,
      meta: { cookieSecure: process.env.AUTH_COOKIE_SECURE ?? '(default)', nodeEnv: process.env.NODE_ENV },
    });
    void logAuthEvent(result.user.id, result.user.company_id, 'LOGIN', {
      role: result.user.role,
      accessProfile: resolveAccessProfile(result.user.role),
      email: result.user.email,
    });

    res.json({
      ok: true,
      success: true,
      user: result.user,
      csrfToken,
      ...(returnTokenInBody ? { token: result.token } : {}),
    });
    logger.info({
      module: 'auth.login',
      action: 'AUTH_LOGIN_SUCCESS',
      message: '[AUTH-FLOW] LOGIN SUCCESS',
      userId: result.user.id,
      companyId: result.user.company_id,
    });
  } catch (e) {
    const err = e as Record<string, unknown>;
    logger.error({
      module: 'auth.login',
      action: 'LOGIN_FAILED',
      message: 'Falha interna ao autenticar usuário',
      meta: {
        identifier: rawIdentifier || null,
        reason: 'unexpected_exception',
        sqlState: typeof err?.code === 'string' ? err.code : null,
        errorMessage: e instanceof Error ? e.message : String(e),
        errorStack: e instanceof Error ? e.stack : null,
      },
      error: e,
    });
    logger.error({
      module: 'auth.login',
      action: 'AUTH_LOGIN_FAILED',
      message: 'Falha interna ao autenticar usuário',
      error: e,
    });
    res.status(500).json({
      ok: false,
      success: false,
      error: 'auth_login_failed',
      code: 'AUTH_LOGIN_FAILED',
      message: 'Erro interno no servidor.',
    });
  }
}
