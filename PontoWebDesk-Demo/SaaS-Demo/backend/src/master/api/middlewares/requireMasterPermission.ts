/**
 * requireMasterPermission() — autorização por permissão Master.
 */
import type { Response, NextFunction } from 'express';
import type { MasterPermission } from '../permissions.js';
import { roleHasAnyPermission } from '../permissions.js';
import type { MasterApiRequest } from './requireMasterLogin.js';

/**
 * Exige que o Master autenticado tenha ao menos uma das permissões.
 * Sem argumentos → qualquer Master autenticado (login já aplicado).
 */
export function requireMasterPermission(...permissions: MasterPermission[]) {
  return (req: MasterApiRequest, res: Response, next: NextFunction): void => {
    if (!req.masterAuth) {
      res.status(401).json({
        ok: false,
        error: 'unauthorized',
        code: 'MASTER_AUTH_REQUIRED',
        message: 'Login Master necessário.',
      });
      return;
    }

    if (permissions.length === 0) {
      next();
      return;
    }

    if (!roleHasAnyPermission(req.masterAuth.role, permissions)) {
      res.status(403).json({
        ok: false,
        error: 'forbidden',
        code: 'MASTER_FORBIDDEN_PERMISSION',
        message: 'Permissão Master insuficiente.',
        required: permissions,
        currentRole: req.masterAuth.role,
      });
      return;
    }

    next();
  };
}
