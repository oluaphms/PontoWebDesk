import type { Response } from 'express';
import { pool } from '../db/index.js';
import type { AuthedRequest } from '../middlewares/authMiddleware.js';

export async function authMeController(req: AuthedRequest, res: Response): Promise<void> {
  const userId = String(req.auth?.sub || '').trim();
  if (!userId) {
    res.status(401).json({ ok: false, error: 'missing_token' });
    return;
  }

  try {
    const result = await pool.query(
      `select id, coalesce(nome, email) as nome, email, cargo, role, company_id, department_id, avatar, preferences, schedule_id, cpf, phone, status
       from users where id = $1 limit 1`,
      [userId],
    );
    const row = result.rows[0];
    if (!row) {
      res.status(404).json({ ok: false, error: 'user_not_found' });
      return;
    }

    res.json({
      ok: true,
      user: {
        id: String(row.id),
        nome: String(row.nome ?? row.email ?? ''),
        email: String(row.email ?? ''),
        cargo: row.cargo != null ? String(row.cargo) : null,
        role: String(row.role ?? 'employee'),
        company_id: String(row.company_id ?? req.auth?.companyId ?? ''),
        department_id: row.department_id != null ? String(row.department_id) : null,
        avatar: row.avatar != null ? String(row.avatar) : null,
        preferences: row.preferences ?? {},
        schedule_id: row.schedule_id != null ? String(row.schedule_id) : null,
        cpf: row.cpf != null ? String(row.cpf) : null,
        phone: row.phone != null ? String(row.phone) : null,
        status: row.status != null ? String(row.status) : 'active',
      },
    });
  } catch (e) {
    console.error('[AUTH ME]', e);
    res.status(500).json({ ok: false, error: 'auth_me_failed' });
  }
}
