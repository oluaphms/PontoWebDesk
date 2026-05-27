import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { isTokenRevoked } from '../services/tokenRevocationService.js';
import { resolveCallerFromDb } from '../services/callerContextService.js';

export type JwtPayload = {
  sub: string;
  userId?: string;
  companyId: string;
  role?: string;
  jti?: string;
};

export type AuthedRequest = Request & {
  auth?: JwtPayload;
};

export async function authMiddleware(req: AuthedRequest, res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    res.status(401).json({ ok: false, error: 'missing_token' });
    return;
  }
  const secret = String(process.env.JWT_SECRET || '').trim();
  if (!secret) {
    res.status(503).json({ ok: false, error: 'auth_not_configured' });
    return;
  }

  try {
    const decoded = jwt.verify(token, secret) as JwtPayload;

    if (decoded.jti && (await isTokenRevoked(decoded.jti))) {
      res.status(401).json({ ok: false, error: 'token_revoked' });
      return;
    }

    const revalidateDb = String(process.env.AUTH_REVALIDATE_DB ?? 'true').trim().toLowerCase() !== 'false';
    if (revalidateDb) {
      const caller = await resolveCallerFromDb(decoded);
      if (!caller?.companyId) {
        res.status(401).json({ ok: false, error: 'user_not_found' });
        return;
      }
      if (caller.companyId !== String(decoded.companyId || '').trim()) {
        res.status(401).json({ ok: false, error: 'tenant_changed' });
        return;
      }
      req.auth = {
        ...decoded,
        sub: caller.userId,
        userId: caller.userId,
        companyId: caller.companyId,
        role: caller.role,
      };
    } else {
      req.auth = decoded;
    }

    next();
  } catch (e) {
    const err = e as { name?: string };
    if (err?.name === 'TokenExpiredError') {
      res.status(401).json({ ok: false, error: 'token_expired' });
      return;
    }
    res.status(401).json({ ok: false, error: 'invalid_token' });
  }
}
