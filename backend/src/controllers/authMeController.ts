import { observabilityConsole } from '../logger/observabilityConsole.js';
import type { Response } from 'express';
import { pool } from '../db/index.js';
import type { AuthedRequest } from '../middlewares/authMiddleware.js';
import { tableHasColumn } from '../db/schemaColumns.js';

async function usersSelectColumns(): Promise<string> {
  const optional = await Promise.all(
    [
      'cargo',
      'department_id',
      'avatar',
      'preferences',
      'schedule_id',
      'cpf',
      'phone',
      'status',
    ].map(async (column) => [column, await tableHasColumn('users', column)] as const),
  );
  const has = new Map(optional);
  const col = (column: string, fallback = 'null') =>
    has.get(column) ? column : `${fallback} as ${column}`;

  return [
    'id',
    'coalesce(nome, email) as nome',
    'email',
    col('cargo'),
    'role',
    'company_id',
    col('department_id'),
    col('avatar'),
    col('preferences', "'{}'::jsonb"),
    col('schedule_id'),
    col('cpf'),
    col('phone'),
    col('status', "'active'"),
  ].join(', ');
}

export async function authMeController(req: AuthedRequest, res: Response): Promise<void> {
  const userId = String(req.auth?.sub || '').trim();
  if (!userId) {
    res.status(401).json({ ok: false, error: 'missing_token' });
    return;
  }

  try {
    const columns = await usersSelectColumns();
    let result = await pool.query(
      `select ${columns}
       from users where id::text = $1 limit 1`,
      [userId],
    );
    let row = result.rows[0];

    if (!row) {
      result = await pool.query(
        `select id,
                coalesce(nullif(trim(nome), ''), email) as nome,
                email,
                cargo,
                role,
                company_id,
                status
         from employees where id::text = $1 limit 1`,
        [userId],
      );
      row = result.rows[0];
    }

    if (!row) {
      res.status(404).json({
        ok: false,
        success: false,
        error: 'user_not_found',
        code: 'AUTH_USER_NOT_FOUND',
      });
      return;
    }

    const user = {
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
    };
    res.json({
      ok: true,
      success: true,
      user,
      data: user,
    });
  } catch (e) {
    observabilityConsole.error('[AUTH ME]', e);
    res.status(500).json({
      ok: false,
      success: false,
      error: 'auth_me_failed',
      code: 'AUTH_ME_FAILED',
    });
  }
}
