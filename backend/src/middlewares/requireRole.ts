import type { Response, NextFunction } from 'express';
import type { AuthedRequest } from './authMiddleware.js';
import { isAdminOrHr, normalizeRole } from '../utils/authContext.js';
import { logAuthDenied } from '../services/authAuditService.js';

export type RoleCheckMode = 'adminOrHr' | 'adminOnly' | 'anyAuthenticated';

export function requireRole(mode: RoleCheckMode = 'anyAuthenticated') {
  return (req: AuthedRequest, res: Response, next: NextFunction): void => {
    if (!req.auth?.sub) {
      res.status(401).json({ ok: false, error: 'unauthorized' });
      return;
    }
    const role = normalizeRole(req.auth.role);
    let allowed = true;
    if (mode === 'adminOnly') {
      allowed = role === 'admin';
    } else if (mode === 'adminOrHr') {
      allowed = isAdminOrHr(role);
    }
    if (!allowed) {
      void logAuthDenied(req, 403, 'forbidden_role', { mode, role });
      res.status(403).json({ ok: false, error: 'forbidden', message: 'Permissão insuficiente.' });
      return;
    }
    next();
  };
}

export const requireAdminOrHr = requireRole('adminOrHr');
export const requireAdminOnly = requireRole('adminOnly');
