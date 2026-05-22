import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export type JwtPayload = {
  sub: string;
  companyId: string;
  role?: string;
};

export type AuthedRequest = Request & {
  auth?: JwtPayload;
};

export function authMiddleware(req: AuthedRequest, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    res.status(401).json({ ok: false, error: 'missing_token' });
    return;
  }
  try {
    const secret = String(process.env.JWT_SECRET || '');
    const decoded = jwt.verify(token, secret) as JwtPayload;
    req.auth = decoded;
    next();
  } catch {
    res.status(401).json({ ok: false, error: 'invalid_token' });
  }
}

