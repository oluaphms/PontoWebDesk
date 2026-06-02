import type { Response } from 'express';
import type { AuthedRequest } from '../middlewares/authMiddleware.js';
import { changeOwnPassword } from '../services/authPasswordService.js';
import { authUserId, requireCompanyId } from '../utils/authContext.js';

export async function authChangePasswordController(req: AuthedRequest, res: Response): Promise<void> {
  const companyId = requireCompanyId(req, res);
  if (!companyId) return;

  const body = req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {};
  const result = await changeOwnPassword({
    companyId,
    userId: authUserId(req.auth),
    newPassword: String(body.newPassword ?? body.password ?? ''),
  });

  if (!result.ok) {
    res.status(result.status).json({ ok: false, success: false, error: result.error });
    return;
  }

  res.json({
    ok: true,
    success: true,
    email: result.email,
    message: 'Senha atualizada com sucesso.',
  });
}
