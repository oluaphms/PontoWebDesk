import type { Request, Response } from 'express';
import { completePasswordRecovery } from '../services/authRecoveryCompleteService.js';

export async function authRecoveryCompleteController(req: Request, res: Response): Promise<void> {
  const body = req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {};
  const accessToken = String(body.access_token ?? body.accessToken ?? '').trim();
  const newPassword = String(body.password ?? body.newPassword ?? '').trim();

  const result = await completePasswordRecovery({ accessToken, newPassword });
  if (!result.ok) {
    res.status(result.status).json({ success: false, error: result.error });
    return;
  }
  res.status(200).json({ success: true, email: result.email });
}
