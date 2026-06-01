import type { Response } from 'express';
import { pool } from '../db/index.js';
import type { PoolClient } from 'pg';
import type { AuthedRequest } from '../middlewares/authMiddleware.js';
import {
  EMPLOYEE_SELECT_COLUMNS,
  validateEmployeeCreate,
  validateEmployeePatch,
  type NormalizedEmployeeInput,
} from '../utils/employeeValidation.js';
import { rejectTenantOverride, requireCompanyId } from '../utils/authContext.js';
import {
  ensureUserForEmployee,
  syncUserFieldsFromEmployeeBody,
} from '../services/employeeUserSync.js';
import { logger } from '../logger/logger.js';

function mapRow(row: Record<string, unknown>) {
  const pis = row.pis ?? row.pis_pasep;
  const telefone = row.telefone ?? row.phone;
  const dataAdmissao = row.data_admissao ?? row.admissao;
  let employeeConfig = row.employee_config;
  if (typeof employeeConfig === 'string') {
    try {
      employeeConfig = JSON.parse(employeeConfig);
    } catch {
      employeeConfig = {};
    }
  }
  return {
    ...row,
    pis,
    telefone,
    data_admissao: dataAdmissao ? String(dataAdmissao).slice(0, 10) : null,
    salario: row.salario != null ? Number(row.salario) : null,
    carga_horaria: row.carga_horaria != null ? Number(row.carga_horaria) : null,
    employee_config: employeeConfig ?? {},
  };
}

export async function listEmployeesController(req: AuthedRequest, res: Response): Promise<void> {
  if (rejectTenantOverride(req, res)) return;
  const companyId = requireCompanyId(req, res);
  if (!companyId) return;

  try {
    const result = await pool.query(
      `select
         e.id, e.nome, e.email, e.role, e.status, e.company_id, e.created_at,
         e.cpf,
         coalesce(e.pis, u.pis_pasep) as pis,
         coalesce(e.telefone, u.phone) as telefone,
         coalesce(e.data_admissao, u.admissao) as data_admissao,
         e.cargo, e.departamento, e.salario, e.jornada_tipo, e.carga_horaria, e.endereco,
         u.numero_folha, u.numero_identificador, u.demissao, u.invisivel, u.employee_config
       from employees e
       left join users u on u.id::text = e.id::text and u.company_id::text = e.company_id::text
       where e.company_id = $1
       order by e.created_at desc
       limit 1000`,
      [companyId],
    );
    res.json({ ok: true, employees: result.rows.map(mapRow) });
  } catch (e) {
    logger.error({
      module: 'employee.controller',
      action: 'EMPLOYEES_LIST_FAILED',
      message: 'Falha ao listar colaboradores',
      userId: req.auth?.userId ?? req.auth?.sub ?? null,
      companyId,
      error: e,
    });
    res.status(500).json({ ok: false, error: 'employees_list_failed' });
  }
}

export async function createEmployeeController(req: AuthedRequest, res: Response): Promise<void> {
  if (rejectTenantOverride(req, res)) return;
  const companyId = requireCompanyId(req, res);
  if (!companyId) return;

  const validation = validateEmployeeCreate(req.body, companyId);
  if (!validation.ok) {
    res.status(400).json({ ok: false, error: validation.error, field: validation.field });
    return;
  }

  const d = validation.data;
  try {
    const result = await pool.query(
      `insert into employees (
        company_id, nome, email, role, status,
        cpf, pis, telefone, data_admissao, cargo, departamento,
        salario, jornada_tipo, carga_horaria, endereco
      ) values (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15
      )
      returning ${EMPLOYEE_SELECT_COLUMNS}`,
      [
        companyId,
        d.nome,
        d.email,
        d.role,
        d.status,
        d.cpf,
        d.pis,
        d.telefone,
        d.data_admissao,
        d.cargo,
        d.departamento,
        d.salario,
        d.jornada_tipo,
        d.carga_horaria,
        d.endereco,
      ],
    );
    const raw = result.rows[0] as Record<string, unknown>;
    const body =
      req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {};
    await ensureUserForEmployee({
      id: String(raw.id),
      company_id: companyId,
      nome: String(raw.nome),
      email: String(raw.email || d.email),
      role: String(raw.role || d.role),
      status: String(raw.status || d.status),
    });
    await syncUserFieldsFromEmployeeBody(String(raw.id), companyId, body, raw);
    res.status(201).json({ ok: true, employee: mapRow(raw) });
  } catch (e: unknown) {
    const msg = String((e as { code?: string })?.code || '');
    if (msg === '23505') {
      res.status(400).json({ ok: false, error: 'CPF ou e-mail já cadastrado nesta empresa' });
      return;
    }
    logger.error({
      module: 'employee.controller',
      action: 'EMPLOYEE_CREATE_FAILED',
      message: 'Falha ao criar colaborador',
      userId: req.auth?.userId ?? req.auth?.sub ?? null,
      companyId,
      error: e,
    });
    res.status(500).json({ ok: false, error: 'create_failed' });
  }
}

const PATCHABLE: (keyof NormalizedEmployeeInput)[] = [
  'nome',
  'cpf',
  'pis',
  'telefone',
  'email',
  'role',
  'status',
  'data_admissao',
  'cargo',
  'departamento',
  'salario',
  'jornada_tipo',
  'carga_horaria',
  'endereco',
];

const USER_ONLY_PATCH_FIELDS = new Set([
  'numero_folha',
  'numero_identificador',
  'pis_pasep',
  'demissao',
  'invisivel',
  'employee_config',
]);

async function fetchEmployeeViewById(
  db: Pick<PoolClient, 'query'> | typeof pool,
  id: string,
  companyId: string,
): Promise<Record<string, unknown> | null> {
  const refreshed = await db.query(
    `select
       e.id, e.nome, e.email, e.role, e.status, e.company_id, e.created_at,
       e.cpf,
       coalesce(e.pis, u.pis_pasep) as pis,
       coalesce(e.telefone, u.phone) as telefone,
       coalesce(e.data_admissao, u.admissao) as data_admissao,
       e.cargo, e.departamento, e.salario, e.jornada_tipo, e.carga_horaria, e.endereco,
       u.numero_folha, u.numero_identificador, u.demissao, u.invisivel, u.employee_config
     from employees e
     left join users u on u.id::text = e.id::text and u.company_id::text = e.company_id::text
     where e.id = $1 and e.company_id = $2
     limit 1`,
    [id, companyId],
  );
  return (refreshed.rows[0] as Record<string, unknown> | undefined) ?? null;
}

export async function updateEmployeeController(req: AuthedRequest, res: Response): Promise<void> {
  if (rejectTenantOverride(req, res)) return;
  const companyId = requireCompanyId(req, res);
  if (!companyId) return;

  const id = String(req.params.id || '').trim();
  if (!id) {
    res.status(400).json({ ok: false, error: 'missing_fields' });
    return;
  }

  const validation = validateEmployeePatch(req.body);
  if (!validation.ok) {
    res.status(400).json({ ok: false, error: validation.error, field: validation.field });
    return;
  }

  const partial = validation.partial ?? {};
  const fields: string[] = [];
  const values: unknown[] = [companyId, id];
  let idx = 3;
  const body =
    req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {};
  const hasUserOnlyField = Object.keys(body).some((key) => USER_ONLY_PATCH_FIELDS.has(key));

  for (const key of PATCHABLE) {
    if (!(key in partial)) continue;
    fields.push(`${key} = $${idx++}`);
    values.push(partial[key as keyof typeof partial]);
  }

  if (fields.length === 0 && !hasUserOnlyField) {
    res.status(400).json({ ok: false, error: 'no_updates' });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('begin');
    const existing = await client.query(
      `select ${EMPLOYEE_SELECT_COLUMNS}
       from employees
       where id = $1 and company_id = $2
       limit 1`,
      [id, companyId],
    );
    if (!existing.rows[0]) {
      await client.query('rollback');
      res.status(404).json({ ok: false, error: 'not_found' });
      return;
    }
    let employeeRow = existing.rows[0] as Record<string, unknown>;
    if (fields.length > 0) {
      const updated = await client.query(
        `update employees set ${fields.join(', ')}
         where id = $2 and company_id = $1
         returning ${EMPLOYEE_SELECT_COLUMNS}`,
        values,
      );
      employeeRow = (updated.rows[0] as Record<string, unknown> | undefined) ?? employeeRow;
    }
    await ensureUserForEmployee(
      {
        id,
        company_id: companyId,
        nome: String(employeeRow.nome || ''),
        email: employeeRow.email != null ? String(employeeRow.email) : null,
        role: String(employeeRow.role || 'employee'),
        status: String(employeeRow.status || 'active'),
      },
      client,
    );
    const userSync = await syncUserFieldsFromEmployeeBody(id, companyId, body, employeeRow, client);
    if (userSync.attempted && userSync.updatedRows === 0) {
      throw new Error('users_sync_no_rows_updated');
    }
    await client.query('commit');
    const refreshed = await fetchEmployeeViewById(pool, id, companyId);
    res.json({ ok: true, employee: mapRow(refreshed ?? employeeRow) });
  } catch (e: unknown) {
    try {
      await client.query('rollback');
    } catch {
      // noop
    }
    const msg = String((e as { code?: string })?.code || '');
    if (msg === '23505') {
      res.status(400).json({ ok: false, error: 'CPF ou e-mail já cadastrado' });
      return;
    }
    logger.error({
      module: 'employee.controller',
      action: 'EMPLOYEE_UPDATE_FAILED',
      message: 'Falha ao atualizar colaborador',
      userId: req.auth?.userId ?? req.auth?.sub ?? null,
      companyId,
      error: e,
    });
    res.status(500).json({ ok: false, error: 'update_failed' });
  } finally {
    client.release();
  }
}

export async function deleteEmployeeController(req: AuthedRequest, res: Response): Promise<void> {
  if (rejectTenantOverride(req, res)) return;
  const companyId = requireCompanyId(req, res);
  if (!companyId) return;

  const id = String(req.params.id || '').trim();
  if (!id) {
    res.status(400).json({ ok: false, error: 'missing_fields' });
    return;
  }

  try {
    const result = await pool.query('delete from employees where id = $1 and company_id = $2 returning id', [
      id,
      companyId,
    ]);
    if (!result.rows[0]) {
      res.status(404).json({ ok: false, error: 'not_found' });
      return;
    }
    res.json({ ok: true });
  } catch (e) {
    logger.error({
      module: 'employee.controller',
      action: 'EMPLOYEE_DELETE_FAILED',
      message: 'Falha ao remover colaborador',
      userId: req.auth?.userId ?? req.auth?.sub ?? null,
      companyId,
      error: e,
    });
    res.status(500).json({ ok: false, error: 'delete_failed' });
  }
}
