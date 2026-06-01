import { pool } from '../db/index.js';
import type { JwtPayload } from '../middlewares/authMiddleware.js';
import { normalizeRole } from '../utils/authContext.js';
import { tableHasColumn } from '../db/schemaColumns.js';

export type CallerContext = {
  userId: string;
  companyId: string;
  role: string;
};

/**
 * Revalida papel e empresa no banco (fonte da verdade) — equivalente ao callerContext da API Vercel.
 */
export async function resolveCallerFromDb(jwt: JwtPayload): Promise<CallerContext | null> {
  const userId = String(jwt.sub || jwt.userId || '').trim();
  if (!userId) return null;
  const [usersHasStatus, employeesHasStatus] = await Promise.all([
    tableHasColumn('users', 'status'),
    tableHasColumn('employees', 'status'),
  ]);

  const fromUsers = await pool.query(
    `SELECT company_id::text AS company_id,
            coalesce(nullif(trim(role), ''), 'employee') AS role,
            ${usersHasStatus ? "coalesce(nullif(trim(status), ''), 'active')" : "'active'"} AS status
     FROM public.users WHERE id::text = $1 LIMIT 1`,
    [userId],
  );
  const uRow = fromUsers.rows[0];
  if (uRow?.company_id) {
    if (String(uRow.status || 'active') !== 'active') return null;
    return {
      userId,
      companyId: String(uRow.company_id),
      role: normalizeRole(String(uRow.role)),
    };
  }

  const fromEmployees = await pool.query(
    `SELECT company_id::text AS company_id,
            coalesce(nullif(trim(role), ''), 'employee') AS role,
            ${employeesHasStatus ? "coalesce(nullif(trim(status), ''), 'active')" : "'active'"} AS status
     FROM public.employees WHERE id::text = $1 LIMIT 1`,
    [userId],
  );
  const eRow = fromEmployees.rows[0];
  if (eRow?.company_id) {
    if (String(eRow.status || 'active') !== 'active') return null;
    return {
      userId,
      companyId: String(eRow.company_id),
      role: normalizeRole(String(eRow.role)),
    };
  }

  return null;
}
