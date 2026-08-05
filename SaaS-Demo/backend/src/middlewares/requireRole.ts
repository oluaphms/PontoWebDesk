import type { Response, NextFunction } from 'express';
import type { AuthedRequest } from './authMiddleware.js';
import { normalizeRole } from '../utils/authContext.js';
import { hasAdminAccess, isCollaborator } from '../utils/accessProfile.js';
import { logAuthDenied } from '../services/authAuditService.js';

export type RoleCheckMode = 'adminOrHr' | 'adminOnly' | 'anyAuthenticated' | 'collaboratorOrAdmin';

export function requireRole(mode: RoleCheckMode = 'anyAuthenticated') {
  return (req: AuthedRequest, res: Response, next: NextFunction): void => {
    if (!req.auth?.sub) {
      res.status(401).json({ ok: false, success: false, error: 'unauthorized', code: 'AUTH_UNAUTHORIZED' });
      return;
    }
    const role = normalizeRole(req.auth.role);
    let allowed = true;
    if (mode === 'adminOnly') {
      allowed = role === 'admin';
    } else if (mode === 'adminOrHr') {
      allowed = hasAdminAccess(req.auth.role);
    } else if (mode === 'collaboratorOrAdmin') {
      allowed = isCollaborator(req.auth.role) || hasAdminAccess(req.auth.role);
    }
    if (!allowed) {
      void logAuthDenied(req, 403, 'forbidden_role', { mode, role });
      res.status(403).json({
        ok: false,
        success: false,
        error: 'forbidden',
        code: 'AUTH_FORBIDDEN_ROLE',
        message: 'Permissão insuficiente.',
      });
      return;
    }
    next();
  };
}

export const requireAdminOrHr = requireRole('adminOrHr');
export const requireAdminOnly = requireRole('adminOnly');
export const requireCollaboratorOrAdmin = requireRole('collaboratorOrAdmin');

/** Bloqueia colaboradores em prefixos administrativos da API. */
export function requireAdminRHAccess() {
  return requireAdminOrHr;
}

export { hasAdminAccess, isCollaborator, isAdminRH } from '../utils/accessProfile.js';
