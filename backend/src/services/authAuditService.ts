import { pool } from '../db/index.js';
import type { AuthedRequest } from '../middlewares/authMiddleware.js';
import { authUserId } from '../utils/authContext.js';

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
    await pool.query(
      `INSERT INTO public.tenant_audit_log (
        company_id, user_id, action, entity, details, created_at
      ) VALUES (
        $1, $2, $3, 'auth', $4::jsonb, now()
      )`,
      [
        companyId || null,
        userId || null,
        `AUTH_DENIED_${status}`,
        JSON.stringify({
          code,
          path,
          role: req.auth?.role,
          ...detail,
        }),
      ],
    );
  } catch {
    // auditoria não deve bloquear resposta
  }
}

export async function logAuthEvent(
  userId: string,
  companyId: string,
  action: string,
  detail?: Record<string, unknown>,
): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO public.tenant_audit_log (
        company_id, user_id, action, entity, details, created_at
      ) VALUES ($1, $2, $3, 'auth', $4::jsonb, now())`,
      [companyId || null, userId || null, action, JSON.stringify(detail ?? {})],
    );
  } catch {
    // ignora
  }
}
