import type { Response, NextFunction } from 'express';
import type { AuthedRequest } from './authMiddleware.js';
import { isGenericDataApiWritesEnabled } from '../utils/dataTablePolicy.js';
import { isPrivilegedRole } from '../utils/authContext.js';

/** Tabelas com escrita operacional permitida mesmo com DATA_API_WRITES_ENABLED=false (admin/hr). */
const OPERATIONAL_WRITE_TABLES = new Set([
  'rep_punch_logs',
  'time_attendance_timeline',
  'time_attendance_incident_reviews',
  'time_records',
]);

function tableFromDataPath(path: string): string | null {
  const match = String(path || '').match(/^\/([^/?]+)/);
  return match?.[1] ?? null;
}

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
  const table = tableFromDataPath(req.path);
  if (
    table &&
    OPERATIONAL_WRITE_TABLES.has(table) &&
    isPrivilegedRole(req.auth?.role) &&
    (method === 'POST' || method === 'PATCH')
  ) {
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
