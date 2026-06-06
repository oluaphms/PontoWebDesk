import type { Request, Response } from 'express';
import { authenticateLogin } from '../services/authLoginService.js';
import { setAuthCookie } from '../security/authCookies.js';
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
    void logAuthEvent(result.user.id, result.user.company_id, 'LOGIN', {
      role: result.user.role,
      accessProfile: resolveAccessProfile(result.user.role),
      email: result.user.email,
    });
    res.json({
      ok: true,
      success: true,
      token: result.token,
      user: result.user,
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
