import type { Request, Response } from 'express';
import { authenticateLogin } from '../services/authLoginService.js';
import { setAuthCookie } from '../security/authCookies.js';
import { generateCsrfToken, setCsrfCookie } from '../security/csrfCookies.js';
import { isProduction } from '../security/env.js';
import { logger } from '../logger/logger.js';
import { logAuthEvent } from '../services/authAuditService.js';
import { resolveAccessProfile } from '../utils/accessProfile.js';

export async function loginController(req: Request, res: Response): Promise<void> {
  const body = req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {};

  try {
    const result = await authenticateLogin(body);

    if ('status' in result) {
      res.status(result.status).json({
        ok: false,
        success: false,
        error: result.error,
        code: result.status === 503 ? 'AUTH_NOT_CONFIGURED' : 'AUTH_LOGIN_FAILED',
        message: result.error,
      });
      return;
    }

    setAuthCookie(res, result.token);
    const csrfToken = generateCsrfToken();
    setCsrfCookie(res, csrfToken);
    void logAuthEvent(result.user.id, result.user.company_id, 'LOGIN', {
      role: result.user.role,
      accessProfile: resolveAccessProfile(result.user.role),
      email: result.user.email,
    });

    const returnTokenInBody =
      !isProduction() || /^(1|true|yes)$/i.test(String(process.env.AUTH_RETURN_TOKEN_IN_BODY || '').trim());

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
