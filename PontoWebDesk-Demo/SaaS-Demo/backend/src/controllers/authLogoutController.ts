import type { Response } from 'express';
import type { AuthedRequest } from '../middlewares/authMiddleware.js';
import { authUserId } from '../utils/authContext.js';
import { logAuthEvent } from '../services/authAuditService.js';
import { revokeToken } from '../services/tokenRevocationService.js';
import { clearAuthCookie } from '../security/authCookies.js';
import { clearCsrfCookie } from '../security/csrfCookies.js';
import { resolveAccessProfile } from '../utils/accessProfile.js';

export async function authLogoutController(req: AuthedRequest, res: Response): Promise<void> {
  const userId = authUserId(req.auth);
  const companyId = String(req.auth?.companyId || '').trim();
  const jti = String(req.auth?.jti || '').trim();

  if (jti && userId) {
    const exp = req.auth && 'exp' in req.auth ? new Date((req.auth as { exp?: number }).exp! * 1000) : undefined;
    await revokeToken(jti, userId, exp);
  }

  if (userId) {
    await logAuthEvent(userId, companyId, 'LOGOUT', {
      jti: jti || null,
      accessProfile: resolveAccessProfile(req.auth?.role),
      role: req.auth?.role ?? null,
    });
  }

  clearAuthCookie(res);
  clearCsrfCookie(res);
  res.json({ ok: true });
}
