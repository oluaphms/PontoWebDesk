import type { Response } from 'express';
import { pool } from '../db/index.js';
import type { AuthedRequest } from '../middlewares/authMiddleware.js';
import {
  EMPLOYEE_SELECT_COLUMNS,
  validateEmployeeCreate,
  validateEmployeePatch,
  type NormalizedEmployeeInput,
} from '../utils/employeeValidation.js';
import { rejectTenantOverride, requireCompanyId } from '../utils/authContext.js';

function mapRow(row: Record<string, unknown>) {
  return {
    ...row,
    data_admissao: row.data_admissao
      ? String(row.data_admissao).slice(0, 10)
      : null,
    salario: row.salario != null ? Number(row.salario) : null,
    carga_horaria: row.carga_horaria != null ? Number(row.carga_horaria) : null,
  };
}

export async function listEmployeesController(req: AuthedRequest, res: Response): Promise<void> {
  if (rejectTenantOverride(req, res)) return;
  const companyId = requireCompanyId(req, res);
  if (!companyId) return;

  try {
    const result = await pool.query(
      `select ${EMPLOYEE_SELECT_COLUMNS} from employees where company_id = $1 order by created_at desc limit 1000`,
      [companyId],
    );
    res.json({ ok: true, employees: result.rows.map(mapRow) });
  } catch (e) {
    console.error('[EMPLOYEES LIST]', e);
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
    res.status(201).json({ ok: true, employee: mapRow(result.rows[0]) });
  } catch (e: unknown) {
    const msg = String((e as { code?: string })?.code || '');
    if (msg === '23505') {
      res.status(400).json({ ok: false, error: 'CPF ou e-mail já cadastrado nesta empresa' });
      return;
    }
    console.error('[EMPLOYEES CREATE]', e);
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

  for (const key of PATCHABLE) {
    if (!(key in partial)) continue;
    fields.push(`${key} = $${idx++}`);
    values.push(partial[key as keyof typeof partial]);
  }

  if (fields.length === 0) {
    res.status(400).json({ ok: false, error: 'no_updates' });
    return;
  }

  try {
    const result = await pool.query(
      `update employees set ${fields.join(', ')}
       where id = $2 and company_id = $1
       returning ${EMPLOYEE_SELECT_COLUMNS}`,
      values,
    );
    if (!result.rows[0]) {
      res.status(404).json({ ok: false, error: 'not_found' });
      return;
    }
    res.json({ ok: true, employee: mapRow(result.rows[0]) });
  } catch (e: unknown) {
    const msg = String((e as { code?: string })?.code || '');
    if (msg === '23505') {
      res.status(400).json({ ok: false, error: 'CPF ou e-mail já cadastrado' });
      return;
    }
    console.error('[EMPLOYEES UPDATE]', e);
    res.status(500).json({ ok: false, error: 'update_failed' });
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
    console.error('[EMPLOYEES DELETE]', e);
    res.status(500).json({ ok: false, error: 'delete_failed' });
  }
}
