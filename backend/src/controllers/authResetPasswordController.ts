import type { Request, Response } from 'express';
import { requestPasswordResetEmail } from '../services/authPasswordResetService.js';
import { logger } from '../logger/logger.js';

export async function authResetPasswordController(req: Request, res: Response): Promise<void> {
  const body = req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {};
  const email = String(body.email ?? '').trim();
  const originHeader = typeof req.headers.origin === 'string' ? req.headers.origin : null;

  try {
    const result = await requestPasswordResetEmail({ email, originHeader });
    if (!result.ok) {
      res.status(result.status).json({
        success: false,
        ok: false,
        error: result.error,
        code: result.code,
        message: result.error,
      });
      return;
    }
    res.status(200).json({ success: true, ok: true, error: null });
  } catch (error) {
    logger.error({
      module: 'auth.resetPassword',
      action: 'AUTH_RESET_PASSWORD_FAILED',
      message: 'Falha ao solicitar recuperação de senha',
      error,
    });
    res.status(500).json({
      success: false,
      ok: false,
      error: 'Erro interno ao solicitar recuperação de senha.',
      code: 'RESET_FAILED',
    });
  }
}
