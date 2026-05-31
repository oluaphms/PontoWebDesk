import type { Response } from 'express';
import type { AuthedRequest } from '../middlewares/authMiddleware.js';
import { requireCompanyId } from '../utils/authContext.js';
import { setUserPasswordForTenant } from '../services/adminSetPasswordService.js';

export async function adminSetPasswordController(req: AuthedRequest, res: Response): Promise<void> {
  const companyId = requireCompanyId(req, res);
  if (!companyId) return;

  const body = req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {};
  const email = String(body.email ?? body.Email ?? '').trim();
  const newPassword = String(body.newPassword ?? body.password ?? '').trim();

  const result = await setUserPasswordForTenant({ companyId, email, newPassword });
  if (!result.ok) {
    res.status(result.status).json({ ok: false, error: result.error });
    return;
  }

  res.json({
    ok: true,
    email: result.email,
    temporaryPassword: result.temporaryPassword,
    expiresAt: result.expiresAt,
    message: 'Senha atualizada. O utilizador já pode fazer login na API.',
  });
}
