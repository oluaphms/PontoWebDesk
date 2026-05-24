import type { Request, Response } from 'express';
import { authenticateLogin } from '../services/authLoginService.js';

export async function loginController(req: Request, res: Response): Promise<void> {
  const body = req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {};

  try {
    const result = await authenticateLogin(body);

    if ('status' in result) {
      res.status(result.status).json({ ok: false, error: result.error });
      return;
    }

    res.json({
      ok: true,
      token: result.token,
      user: result.user,
    });
  } catch (e) {
    console.error('[AUTH LOGIN]', e);
    res.status(500).json({ ok: false, error: 'Erro interno no servidor' });
  }
}
