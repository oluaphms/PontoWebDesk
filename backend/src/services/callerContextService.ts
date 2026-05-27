import { pool } from '../db/index.js';
import type { JwtPayload } from '../middlewares/authMiddleware.js';
import { normalizeRole } from '../utils/authContext.js';

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

  const fromUsers = await pool.query(
    `SELECT company_id::text AS company_id, coalesce(nullif(trim(role), ''), 'employee') AS role
     FROM public.users WHERE id::text = $1 LIMIT 1`,
    [userId],
  );
  const uRow = fromUsers.rows[0];
  if (uRow?.company_id) {
    return {
      userId,
      companyId: String(uRow.company_id),
      role: normalizeRole(String(uRow.role)),
    };
  }

  const fromEmployees = await pool.query(
    `SELECT company_id::text AS company_id, coalesce(nullif(trim(role), ''), 'employee') AS role
     FROM public.employees WHERE id::text = $1 LIMIT 1`,
    [userId],
  );
  const eRow = fromEmployees.rows[0];
  if (eRow?.company_id) {
    return {
      userId,
      companyId: String(eRow.company_id),
      role: normalizeRole(String(eRow.role)),
    };
  }

  const jwtCompany = String(jwt.companyId || '').trim();
  if (!jwtCompany) return null;
  return {
    userId,
    companyId: jwtCompany,
    role: normalizeRole(jwt.role),
  };
}
