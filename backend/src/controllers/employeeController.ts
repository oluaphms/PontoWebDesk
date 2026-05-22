import type { Response } from 'express';
import { pool } from '../db/index.js';
import type { AuthedRequest } from '../middlewares/authMiddleware.js';

export async function listEmployeesController(req: AuthedRequest, res: Response): Promise<void> {
  const companyId = String(req.query.companyId || req.auth?.companyId || '').trim();
  if (!companyId) {
    res.json({ ok: true, employees: [] });
    return;
  }
  try {
    const result = await pool.query(
      'select id, nome, email, role, status, company_id from employees where company_id = $1 order by created_at desc limit 1000',
      [companyId],
    );
    res.json({ ok: true, employees: result.rows });
  } catch {
    res.status(200).json({ ok: true, degraded: true, employees: [] });
  }
}

