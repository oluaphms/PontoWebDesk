import type { Response, NextFunction } from 'express';
import type { AuthedRequest } from './authMiddleware.js';
import { isGenericDataApiWritesEnabled } from '../utils/dataTablePolicy.js';

/** Bloqueia POST/PATCH/DELETE em /api/data quando DATA_API_WRITES_ENABLED=false (Sprint 4). */
export function dataApiWriteGate(req: AuthedRequest, res: Response, next: NextFunction): void {
  if (isGenericDataApiWritesEnabled()) {
    next();
    return;
  }
  const method = req.method.toUpperCase();
  if (method === 'GET') {
    next();
    return;
  }
  if (method === 'POST' || method === 'PATCH' || method === 'DELETE') {
    res.status(403).json({
      ok: false,
      error: 'data_api_writes_disabled',
      message: 'Escritas na API genérica /data estão desativadas. Use rotas específicas.',
    });
    return;
  }
  next();
}
