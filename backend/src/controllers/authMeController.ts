import type { Response } from 'express';
import { pool } from '../db/index.js';
import type { AuthedRequest } from '../middlewares/authMiddleware.js';
import { tableHasColumn } from '../db/schemaColumns.js';
import { logger } from '../logger/logger.js';
import { isAdminOrHr, normalizeRole } from '../utils/authContext.js';
import { resolveAccessProfile } from '../utils/accessProfile.js';

async function ensureEmployeeMirrorFromUser(row: Record<string, unknown>): Promise<void> {
  const id = String(row.id ?? '').trim();
  const companyId = String(row.company_id ?? '').trim();
  const role = normalizeRole(String(row.role ?? 'employee'));
  if (!id || !companyId || isAdminOrHr(role)) return;

  const nome = String(row.nome ?? row.email ?? 'Colaborador').trim() || 'Colaborador';
  const email = String(row.email ?? '').trim().toLowerCase() || null;
  const status = String(row.status ?? 'active').trim() || 'active';
  await pool.query(
    `insert into public.employees (id, company_id, nome, email, role, status, created_at)
     values ($1, $2, $3, $4, $5, $6, now())
     on conflict (id) do nothing`,
    [id, companyId, nome, email, role, status],
  );
}

async function usersSelectColumns(): Promise<string> {
  const optional = await Promise.all(
    [
      'cargo',
      'department_id',
      'avatar',
      'preferences',
      'schedule_id',
      'shift_id',
      'estrutura_id',
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
    col('shift_id'),
    col('estrutura_id'),
    col('cpf'),
    col('phone'),
    col('status', "'active'"),
  ].join(', ');
}

async function joinedEmployeeProfileQueryParts(): Promise<{ columns: string; joins: string }> {
  const optional = await Promise.all(
    [
      ['users', 'cargo'],
      ['users', 'department_id'],
      ['users', 'avatar'],
      ['users', 'preferences'],
      ['users', 'schedule_id'],
      ['users', 'shift_id'],
      ['users', 'estrutura_id'],
      ['users', 'cpf'],
      ['users', 'phone'],
      ['users', 'status'],
      ['employees', 'cargo'],
      ['employees', 'department_id'],
      ['employees', 'avatar'],
      ['employees', 'preferences'],
      ['employees', 'schedule_id'],
      ['employees', 'shift_id'],
      ['employees', 'cpf'],
      ['employees', 'phone'],
      ['employees', 'telefone'],
      ['employees', 'status'],
      ['employees', 'departamento'],
      ['employees', 'jornada_tipo'],
      ['employees', 'carga_horaria'],
      ['departments', 'name'],
      ['schedules', 'name'],
      ['work_shifts', 'name'],
      ['estruturas', 'descricao'],
      ['estruturas', 'name'],
    ].map(async ([table, column]) => [`${table}.${column}`, await tableHasColumn(table, column)] as const),
  );
  const has = new Map(optional);
  const hasColumn = (table: string, column: string) => has.get(`${table}.${column}`) === true;
  const coalesce = (column: string, fallback = 'null') => {
    const parts: string[] = [];
    if (hasColumn('employees', column)) parts.push(`e.${column}`);
    if (hasColumn('users', column)) parts.push(`u.${column}`);
    return parts.length ? `coalesce(${parts.join(', ')})` : fallback;
  };
  const phoneExpr = [
    hasColumn('employees', 'phone') ? 'e.phone' : null,
    hasColumn('employees', 'telefone') ? 'e.telefone' : null,
    hasColumn('users', 'phone') ? 'u.phone' : null,
  ].filter(Boolean).join(', ');
  const departmentNameExpr = hasColumn('departments', 'name')
    ? 'd.name'
    : hasColumn('employees', 'departamento')
      ? 'e.departamento'
      : 'null';
  const scheduleNameExpr = hasColumn('schedules', 'name') ? 's.name' : 'null';
  const shiftNameExpr = hasColumn('work_shifts', 'name') ? 'ws.name' : 'null';
  const estruturaNameExpr = hasColumn('estruturas', 'descricao')
    ? 'est.descricao'
    : hasColumn('estruturas', 'name')
      ? 'est.name'
      : 'null';
  const departmentIdExpr = coalesce('department_id');
  const scheduleIdExpr = coalesce('schedule_id');
  const shiftIdExpr = coalesce('shift_id');
  const companyIdExpr = 'coalesce(e.company_id, u.company_id)';
  const joinParts = [
    hasColumn('departments', 'name') && departmentIdExpr !== 'null'
      ? `left join departments d on d.id::text = ${departmentIdExpr}::text
        and d.company_id::text = ${companyIdExpr}::text`
      : '',
    hasColumn('schedules', 'name') && scheduleIdExpr !== 'null'
      ? `left join schedules s on s.id::text = ${scheduleIdExpr}::text
        and s.company_id::text = ${companyIdExpr}::text`
      : '',
    hasColumn('work_shifts', 'name') && shiftIdExpr !== 'null'
      ? `left join work_shifts ws on ws.id::text = ${shiftIdExpr}::text
        and ws.company_id::text = ${companyIdExpr}::text`
      : '',
    hasColumn('users', 'estrutura_id') && (hasColumn('estruturas', 'descricao') || hasColumn('estruturas', 'name'))
      ? `left join estruturas est on est.id::text = u.estrutura_id::text
        and est.company_id::text = ${companyIdExpr}::text`
      : '',
  ].filter(Boolean).join('\n       ');

  return {
    columns: [
    'e.id',
    'coalesce(nullif(trim(e.nome), \'\'), nullif(trim(u.nome), \'\'), e.email, u.email) as nome',
    'coalesce(e.email, u.email) as email',
    `${coalesce('cargo')} as cargo`,
    'coalesce(u.role, e.role, \'employee\') as role',
    'coalesce(e.company_id, u.company_id) as company_id',
    `${departmentIdExpr} as department_id`,
    `${departmentNameExpr} as department_name`,
    `${coalesce('avatar')} as avatar`,
    `${coalesce('preferences', "'{}'::jsonb")} as preferences`,
    `${scheduleIdExpr} as schedule_id`,
    `${scheduleNameExpr} as schedule_name`,
    `${shiftIdExpr} as shift_id`,
    `${shiftNameExpr} as shift_name`,
    `${hasColumn('users', 'estrutura_id') ? 'u.estrutura_id' : 'null'} as estrutura_id`,
    `${estruturaNameExpr} as estrutura_name`,
    `${coalesce('cpf')} as cpf`,
    `${phoneExpr ? `coalesce(${phoneExpr})` : 'null'} as phone`,
    `${coalesce('status', "'active'")} as status`,
    `${hasColumn('employees', 'departamento') ? 'e.departamento' : 'null'} as departamento`,
    `${hasColumn('employees', 'jornada_tipo') ? 'e.jornada_tipo' : 'null'} as jornada_tipo`,
    `${hasColumn('employees', 'carga_horaria') ? 'e.carga_horaria' : 'null'} as carga_horaria`,
    ].join(', '),
    joins: joinParts,
  };
}

export async function authMeController(req: AuthedRequest, res: Response): Promise<void> {
  const userId = String(req.auth?.sub || '').trim();
  if (!userId) {
    res.status(401).json({
      ok: false,
      success: false,
      error: 'missing_token',
      code: 'AUTH_MISSING_TOKEN',
      message: 'Token ausente ou inválido.',
    });
    return;
  }

  try {
    const columns = await usersSelectColumns();
    const userResult = await pool.query(
      `select ${columns}
       from users where id::text = $1 limit 1`,
      [userId],
    );
    let row: Record<string, unknown> | undefined = userResult.rows[0];

    if (row) {
      const role = normalizeRole(String(row.role ?? 'employee'));
      if (!isAdminOrHr(role)) {
        await ensureEmployeeMirrorFromUser(row);
        const employeeProfile = await joinedEmployeeProfileQueryParts();
        const enriched = await pool.query(
          `select ${employeeProfile.columns}
           from employees e
           left join users u on u.id::text = e.id::text and u.company_id::text = e.company_id::text
           ${employeeProfile.joins}
           where e.id::text = $1 limit 1`,
          [userId],
        );
        if (enriched.rows[0]) {
          row = { ...enriched.rows[0], ...row, role: normalizeRole(String(row.role ?? 'employee')) };
        }
      }
    } else {
      const employeeProfile = await joinedEmployeeProfileQueryParts();
      const result = await pool.query(
        `select ${employeeProfile.columns}
         from employees e
         left join users u on u.id::text = e.id::text and u.company_id::text = e.company_id::text
         ${employeeProfile.joins}
         where e.id::text = $1 limit 1`,
        [userId],
      );
      row = result.rows[0];
    }

    if (!row) {
      logger.warn({
        module: 'auth.me',
        action: 'AUTH_ME_USER_NOT_FOUND',
        message: 'Usuário autenticado não encontrado em users nem employees',
        userId,
        companyId: req.auth?.companyId ?? null,
      });
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
      role: normalizeRole(String(row.role ?? 'employee')),
      accessProfile: resolveAccessProfile(String(row.role ?? 'employee')),
      company_id: String(row.company_id ?? req.auth?.companyId ?? ''),
      department_id: row.department_id != null ? String(row.department_id) : null,
      department_name: row.department_name != null ? String(row.department_name) : null,
      avatar: row.avatar != null ? String(row.avatar) : null,
      preferences: row.preferences ?? {},
      schedule_id: row.schedule_id != null ? String(row.schedule_id) : null,
      schedule_name: row.schedule_name != null ? String(row.schedule_name) : null,
      shift_id: row.shift_id != null ? String(row.shift_id) : null,
      shift_name: row.shift_name != null ? String(row.shift_name) : null,
      estrutura_id: row.estrutura_id != null ? String(row.estrutura_id) : null,
      estrutura_name: row.estrutura_name != null ? String(row.estrutura_name) : null,
      cpf: row.cpf != null ? String(row.cpf) : null,
      phone: row.phone != null ? String(row.phone) : null,
      status: row.status != null ? String(row.status) : 'active',
      departamento: row.departamento != null ? String(row.departamento) : null,
      jornada_tipo: row.jornada_tipo != null ? String(row.jornada_tipo) : null,
      carga_horaria: row.carga_horaria != null ? Number(row.carga_horaria) : null,
    };
    res.json({
      ok: true,
      success: true,
      user,
      data: user,
    });
  } catch (e) {
    logger.error({
      module: 'auth.me',
      action: 'AUTH_ME_FAILED',
      message: 'Falha ao consultar usuário autenticado',
      userId,
      companyId: req.auth?.companyId ?? null,
      error: e,
      meta: {
        path: '/api/auth/me',
      },
    });
    res.status(500).json({
      ok: false,
      success: false,
      error: 'auth_me_failed',
      code: 'AUTH_ME_FAILED',
      message: 'Falha ao consultar sessão autenticada.',
    });
  }
}
