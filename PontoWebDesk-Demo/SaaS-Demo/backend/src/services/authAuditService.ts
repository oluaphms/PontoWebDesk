import { pool } from '../db/index.js';
import { tableHasColumn } from '../db/schemaColumns.js';
import { logger } from '../logger/logger.js';
import type { AuthedRequest } from '../middlewares/authMiddleware.js';
import { authUserId } from '../utils/authContext.js';

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

async function insertAuthAuditLog(params: {
  companyId: string;
  userId: string;
  action: string;
  detail?: Record<string, unknown>;
}): Promise<void> {
  const columns: string[] = [];
  const values: unknown[] = [];
  const placeholders: string[] = [];

  const add = (column: string, value: unknown, cast = '') => {
    columns.push(column);
    values.push(value);
    placeholders.push(`$${values.length}${cast}`);
  };

  if (await tableHasColumn('tenant_audit_log', 'tenant_id')) {
    add('tenant_id', params.companyId || null);
  } else if (await tableHasColumn('tenant_audit_log', 'company_id')) {
    add('company_id', params.companyId || null);
  }

  if (!columns.length) return;

  if (await tableHasColumn('tenant_audit_log', 'user_id')) {
    add('user_id', params.userId && isUuid(params.userId) ? params.userId : null);
  }
  add('action', params.action);
  if (await tableHasColumn('tenant_audit_log', 'entity')) {
    add('entity', 'auth');
  }
  if (await tableHasColumn('tenant_audit_log', 'details')) {
    add('details', JSON.stringify(params.detail ?? {}), '::jsonb');
  }

  await pool.query(
    `INSERT INTO public.tenant_audit_log (${columns.join(', ')})
     VALUES (${placeholders.join(', ')})`,
    values,
  );
}

export async function logAuthDenied(
  req: AuthedRequest,
  status: number,
  code: string,
  detail?: Record<string, unknown>,
): Promise<void> {
  try {
    const userId = authUserId(req.auth);
    const companyId = String(req.auth?.companyId || '').trim();
    const path = `${req.method} ${req.baseUrl || ''}${req.path || ''}`;
    await insertAuthAuditLog({
      companyId,
      userId,
      action: `AUTH_DENIED_${status}`,
      detail: {
        code,
        path,
        role: req.auth?.role,
        ...detail,
      },
    });
  } catch (error) {
    logger.warn({
      module: 'auth.audit',
      action: 'AUTH_AUDIT_LOG_FAILED',
      message: 'Falha ao registrar auditoria de auth',
      userId: authUserId(req.auth) || null,
      companyId: String(req.auth?.companyId || '').trim() || null,
      error,
      meta: { status, code },
    });
  }
}

export async function logAuthEvent(
  userId: string,
  companyId: string,
  action: string,
  detail?: Record<string, unknown>,
): Promise<void> {
  try {
    await insertAuthAuditLog({ companyId, userId, action, detail });
  } catch (error) {
    logger.warn({
      module: 'auth.audit',
      action: 'AUTH_AUDIT_LOG_FAILED',
      message: 'Falha ao registrar evento de auth',
      userId: userId || null,
      companyId: companyId || null,
      error,
      meta: { action },
    });
  }
}
