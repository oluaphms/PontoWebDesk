import type { Response } from 'express';
import { pool } from '../db/index.js';
import { tableHasColumn } from '../db/schemaColumns.js';
import type { PoolClient } from 'pg';
import type { AuthedRequest } from '../middlewares/authMiddleware.js';
import {
  EMPLOYEE_SELECT_COLUMNS,
  validateEmployeeCreate,
  validateEmployeePatch,
  type NormalizedEmployeeInput,
} from '../utils/employeeValidation.js';
import { authUserId, isAdminOrHr, rejectTenantOverride, requireCompanyId } from '../utils/authContext.js';
import {
  ensureUserForEmployee,
  syncUserFieldsFromEmployeeBody,
} from '../services/employeeUserSync.js';
import { logger } from '../logger/logger.js';

const EMPLOYEE_LINK_COLUMNS = ['schedule_id', 'shift_id'] as const;
type EmployeeLinkColumn = (typeof EMPLOYEE_LINK_COLUMNS)[number];
type LinkColumnMap = Record<EmployeeLinkColumn, boolean>;
const PROTECTED_SYSTEM_USER_EMAILS = new Set([
  'admin@pontowebdesk.com',
  'desenvolvedor@smartponto.com',
]);
const USER_VIEW_COLUMNS = [
  'pis_pasep',
  'phone',
  'admissao',
  'numero_folha',
  'numero_identificador',
  'demissao',
  'invisivel',
  'employee_config',
] as const;
type UserViewColumn = (typeof USER_VIEW_COLUMNS)[number];
type UserViewColumnMap = Record<UserViewColumn, boolean>;

function isEmployeeLinkColumn(key: keyof NormalizedEmployeeInput): key is EmployeeLinkColumn {
  return (EMPLOYEE_LINK_COLUMNS as readonly string[]).includes(key);
}

function isProtectedSystemUserEmail(email: unknown): boolean {
  return PROTECTED_SYSTEM_USER_EMAILS.has(String(email || '').trim().toLowerCase());
}

async function getTableLinkColumns(
  tableName: 'employees' | 'users',
  db: Pick<PoolClient, 'query'> | typeof pool = pool,
): Promise<LinkColumnMap> {
  const entries = await Promise.all(
    EMPLOYEE_LINK_COLUMNS.map(async (column) => [column, await tableHasColumn(tableName, column, db)] as const),
  );
  return Object.fromEntries(entries) as LinkColumnMap;
}

async function getUserViewColumns(
  db: Pick<PoolClient, 'query'> | typeof pool = pool,
): Promise<UserViewColumnMap> {
  const entries = await Promise.all(
    USER_VIEW_COLUMNS.map(async (column) => [column, await tableHasColumn('users', column, db)] as const),
  );
  return Object.fromEntries(entries) as UserViewColumnMap;
}

function userColumnSelect(
  columns: UserViewColumnMap,
  column: UserViewColumn,
  alias = column,
  fallback = 'null',
): string {
  return columns[column] ? `u.${column} as ${alias}` : `${fallback} as ${alias}`;
}

function buildEmployeeReturningColumns(employeeLinks: LinkColumnMap): string {
  const optionalColumns = EMPLOYEE_LINK_COLUMNS.filter((column) => employeeLinks[column]);
  return [EMPLOYEE_SELECT_COLUMNS, ...optionalColumns].join(', ');
}

function buildLinkSelect(column: EmployeeLinkColumn, employeeLinks: LinkColumnMap, userLinks: LinkColumnMap): string {
  if (employeeLinks[column] && userLinks[column]) return `coalesce(e.${column}, u.${column}) as ${column}`;
  if (employeeLinks[column]) return `e.${column} as ${column}`;
  if (userLinks[column]) return `u.${column} as ${column}`;
  return `null as ${column}`;
}

async function buildEmployeeViewSelect(db: Pick<PoolClient, 'query'> | typeof pool = pool): Promise<string> {
  const [employeeLinks, userLinks, userColumns] = await Promise.all([
    getTableLinkColumns('employees', db),
    getTableLinkColumns('users', db),
    getUserViewColumns(db),
  ]);
  const linkColumns = EMPLOYEE_LINK_COLUMNS.map((column) => buildLinkSelect(column, employeeLinks, userLinks));
  const pisSelect = userColumns.pis_pasep ? 'coalesce(e.pis, u.pis_pasep) as pis' : 'e.pis as pis';
  const phoneSelect = userColumns.phone ? 'coalesce(e.telefone, u.phone) as telefone' : 'e.telefone as telefone';
  const admissionSelect = userColumns.admissao
    ? 'coalesce(e.data_admissao, u.admissao) as data_admissao'
    : 'e.data_admissao as data_admissao';

  return `
    e.id, e.nome, e.email, e.role, e.status, e.company_id, e.created_at,
    e.cpf,
    ${pisSelect},
    ${phoneSelect},
    ${admissionSelect},
    e.cargo, e.departamento, e.salario, e.jornada_tipo, e.carga_horaria, e.endereco,
    ${linkColumns.join(',\n    ')},
    ${userColumnSelect(userColumns, 'numero_folha')},
    ${userColumnSelect(userColumns, 'numero_identificador')},
    ${userColumnSelect(userColumns, 'demissao')},
    ${userColumnSelect(userColumns, 'invisivel', 'invisivel', 'false')},
    ${userColumnSelect(userColumns, 'employee_config', 'employee_config', "'{}'::jsonb")}
  `.trim();
}

function toDateYmd(value: unknown): string | null {
  if (value == null || value === '') return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  }
  const raw = String(value).trim();
  if (!raw) return null;
  const ymd = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|[T\s].*)/);
  if (ymd) return `${ymd[1]}-${ymd[2]}-${ymd[3]}`;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

function mapRow(row: Record<string, unknown>) {
  const pis = row.pis ?? row.pis_pasep;
  const telefone = row.telefone ?? row.phone;
  const dataAdmissao = row.data_admissao ?? row.admissao;
  const demissao = row.demissao;
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
    data_admissao: toDateYmd(dataAdmissao),
    admissao: toDateYmd(dataAdmissao),
    demissao: toDateYmd(demissao),
    salario: row.salario != null ? Number(row.salario) : null,
    carga_horaria: row.carga_horaria != null ? Number(row.carga_horaria) : null,
    employee_config: employeeConfig ?? {},
  };
}

type DbErrorDetails = {
  name?: string;
  message: string;
  code?: string;
  detail?: string;
  hint?: string;
  schema?: string;
  table?: string;
  column?: string;
  dataType?: string;
  constraint?: string;
  where?: string;
  severity?: string;
  routine?: string;
  stack?: string;
};

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function describeDbError(error: unknown): DbErrorDetails {
  const record = error && typeof error === 'object' ? (error as Record<string, unknown>) : {};
  return {
    name: error instanceof Error ? error.name : optionalString(record.name),
    message: error instanceof Error ? error.message : String(error),
    code: optionalString(record.code),
    detail: optionalString(record.detail),
    hint: optionalString(record.hint),
    schema: optionalString(record.schema),
    table: optionalString(record.table),
    column: optionalString(record.column),
    dataType: optionalString(record.dataType),
    constraint: optionalString(record.constraint),
    where: optionalString(record.where),
    severity: optionalString(record.severity),
    routine: optionalString(record.routine),
    stack: error instanceof Error ? error.stack : optionalString(record.stack),
  };
}

export async function listEmployeesController(req: AuthedRequest, res: Response): Promise<void> {
  if (rejectTenantOverride(req, res)) return;
  const companyId = requireCompanyId(req, res);
  if (!companyId) return;
  if (!isAdminOrHr(req.auth?.role)) {
    res.status(403).json({
      ok: false,
      success: false,
      error: 'forbidden',
      code: 'EMPLOYEES_LIST_FORBIDDEN',
    });
    return;
  }

  try {
    const viewSelect = await buildEmployeeViewSelect(pool);
    const result = await pool.query(
      `select
         ${viewSelect}
       from employees e
       left join users u on u.id::text = e.id::text and u.company_id::text = e.company_id::text
       where e.company_id = $1
         and coalesce(e.status, 'active') = 'active'
         and lower(coalesce(nullif(trim(e.email), ''), nullif(trim(u.email), ''), '')) <> all($2::text[])
       order by e.created_at desc
       limit 1000`,
      [companyId, Array.from(PROTECTED_SYSTEM_USER_EMAILS)],
    );
    const employees = result.rows.map(mapRow);
    res.json({ ok: true, success: true, employees, data: employees });
  } catch (e) {
    logger.error({
      module: 'employee.controller',
      action: 'EMPLOYEES_LIST_FAILED',
      message: 'Falha ao listar colaboradores',
      userId: req.auth?.userId ?? req.auth?.sub ?? null,
      companyId,
      error: e,
    });
    res.status(500).json({
      ok: false,
      success: false,
      error: 'employees_list_failed',
      code: 'EMPLOYEES_LIST_FAILED',
    });
  }
}

export async function getEmployeeController(req: AuthedRequest, res: Response): Promise<void> {
  if (rejectTenantOverride(req, res)) return;
  const companyId = requireCompanyId(req, res);
  if (!companyId) return;

  const id = String(req.params.id || '').trim();
  if (!id) {
    res.status(400).json({
      ok: false,
      success: false,
      error: 'missing_fields',
      code: 'EMPLOYEE_ID_REQUIRED',
    });
    return;
  }

  const selfAccess = authUserId(req.auth) === id;
  if (!isAdminOrHr(req.auth?.role) && !selfAccess) {
    res.status(403).json({
      ok: false,
      success: false,
      error: 'forbidden',
      code: 'EMPLOYEE_FORBIDDEN',
    });
    return;
  }

  try {
    const row = await fetchEmployeeViewById(pool, id, companyId);
    if (!row) {
      res.status(404).json({
        ok: false,
        success: false,
        error: 'not_found',
        code: 'EMPLOYEE_NOT_FOUND',
      });
      return;
    }
    const employee = mapRow(row);
    res.json({ ok: true, success: true, employee, data: employee });
  } catch (e) {
    logger.error({
      module: 'employee.controller',
      action: 'EMPLOYEE_GET_FAILED',
      message: 'Falha ao buscar colaborador por id',
      userId: req.auth?.userId ?? req.auth?.sub ?? null,
      companyId,
      error: e,
      meta: { employeeId: id },
    });
    res.status(500).json({
      ok: false,
      success: false,
      error: 'employee_get_failed',
      code: 'EMPLOYEE_GET_FAILED',
    });
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
    const employeeLinks = await getTableLinkColumns('employees', pool);
    const insertColumns = [
      'company_id',
      'nome',
      'email',
      'role',
      'status',
      'cpf',
      'pis',
      'telefone',
      'data_admissao',
      'cargo',
      'departamento',
      'salario',
      'jornada_tipo',
      'carga_horaria',
      'endereco',
    ];
    const insertValues: unknown[] = [
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
    ];

    for (const column of EMPLOYEE_LINK_COLUMNS) {
      if (!employeeLinks[column]) continue;
      insertColumns.push(column);
      insertValues.push(d[column]);
    }

    const placeholders = insertColumns.map((_, index) => `$${index + 1}`).join(',');
    const result = await pool.query(
      `insert into employees (${insertColumns.join(', ')})
       values (${placeholders})
       returning ${buildEmployeeReturningColumns(employeeLinks)}`,
      insertValues,
    );
    const raw = result.rows[0] as Record<string, unknown>;
    const body =
      req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {};
    try {
      await ensureUserForEmployee({
        id: String(raw.id),
        company_id: companyId,
        nome: String(raw.nome),
        email: String(raw.email || d.email),
        role: String(raw.role || d.role),
        status: String(raw.status || d.status),
        schedule_id: raw.schedule_id ?? d.schedule_id,
        shift_id: raw.shift_id ?? d.shift_id,
      });
      const userSync = await syncUserFieldsFromEmployeeBody(String(raw.id), companyId, body, raw);
      if (userSync.attempted && userSync.updatedRows === 0) {
        logger.warn({
          module: 'employee.controller',
          action: 'EMPLOYEE_CREATE_USER_SYNC_SKIPPED',
          message: 'Colaborador criado sem sincronizar users; nenhum registro correspondente foi encontrado',
          userId: req.auth?.userId ?? req.auth?.sub ?? null,
          companyId,
          meta: { employeeId: String(raw.id) },
        });
      }
    } catch (userSyncError) {
      logger.warn({
        module: 'employee.controller',
        action: 'EMPLOYEE_CREATE_USER_SYNC_FAILED',
        message: 'Colaborador criado, mas sincronização auxiliar com users falhou',
        userId: req.auth?.userId ?? req.auth?.sub ?? null,
        companyId,
        error: userSyncError,
        meta: { employeeId: String(raw.id) },
      });
    }
    const refreshed = await fetchEmployeeViewById(pool, String(raw.id), companyId);
    const employee = mapRow(refreshed ?? raw);
    res.status(201).json({ ok: true, success: true, employee, data: employee });
  } catch (e: unknown) {
    const msg = String((e as { code?: string })?.code || '');
    if (msg === '23505') {
      res.status(400).json({
        ok: false,
        success: false,
        error: 'CPF ou e-mail já cadastrado nesta empresa',
        code: 'EMPLOYEE_DUPLICATE',
      });
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
    res.status(500).json({
      ok: false,
      success: false,
      error: 'create_failed',
      code: 'EMPLOYEE_CREATE_FAILED',
    });
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
  'schedule_id',
  'shift_id',
];

const USER_SYNC_PATCH_FIELDS = new Set([
  'numero_folha',
  'numero_identificador',
  'pis_pasep',
  'demissao',
  'invisivel',
  'employee_config',
  'schedule_id',
  'shift_id',
]);

async function fetchEmployeeViewById(
  db: Pick<PoolClient, 'query'> | typeof pool,
  id: string,
  companyId: string,
): Promise<Record<string, unknown> | null> {
  const viewSelect = await buildEmployeeViewSelect(db);
  const refreshed = await db.query(
    `select
       ${viewSelect}
     from employees e
     left join users u on u.id::text = e.id::text and u.company_id::text = e.company_id::text
     where e.id::text = $1 and e.company_id::text = $2
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
    res.status(400).json({
      ok: false,
      success: false,
      error: 'missing_fields',
      code: 'EMPLOYEE_ID_REQUIRED',
      message: 'ID do colaborador é obrigatório.',
    });
    return;
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    res.status(400).json({
      ok: false,
      success: false,
      error: 'invalid_id',
      code: 'EMPLOYEE_INVALID_ID',
      message: 'ID do colaborador inválido.',
      details: { employeeId: id },
    });
    return;
  }

  const body =
    req.body && typeof req.body === 'object' && !Array.isArray(req.body)
      ? (req.body as Record<string, unknown>)
      : {};
  const validation = validateEmployeePatch(body);
  if (!validation.ok) {
    res.status(400).json({
      ok: false,
      success: false,
      error: validation.error,
      code: 'EMPLOYEE_VALIDATION_FAILED',
      message: validation.error,
      field: validation.field,
    });
    return;
  }

  let client: PoolClient | null = null;
  let updateSql = '';
  let fields: string[] = [];
  const values: unknown[] = [companyId, id];
  let employeeLinks: LinkColumnMap = { schedule_id: false, shift_id: false };
  try {
    const partial = validation.partial ?? {};
    let idx = 3;
    const hasUserSyncField = Object.keys(body).some((key) => USER_SYNC_PATCH_FIELDS.has(key));
    employeeLinks = await getTableLinkColumns('employees', pool);

    fields = [];
    for (const key of PATCHABLE) {
      if (!(key in partial)) continue;
      if (isEmployeeLinkColumn(key) && !employeeLinks[key]) continue;
      fields.push(`${key} = $${idx++}`);
      values.push(partial[key as keyof typeof partial]);
    }

    if (fields.length === 0 && !hasUserSyncField) {
      res.status(400).json({
        ok: false,
        success: false,
        error: 'no_updates',
        code: 'EMPLOYEE_NO_UPDATES',
        message: 'Nenhum campo válido para atualizar.',
      });
      return;
    }

    client = await pool.connect();
    await client.query('begin');
    const existing = await client.query(
      `select ${buildEmployeeReturningColumns(employeeLinks)}
       from employees
       where id::text = $1 and company_id::text = $2
       limit 1`,
      [id, companyId],
    );
    if (!existing.rows[0]) {
      await client.query('rollback');
      res.status(404).json({
        ok: false,
        success: false,
        error: 'not_found',
        code: 'EMPLOYEE_NOT_FOUND',
      });
      return;
    }
    let employeeRow = existing.rows[0] as Record<string, unknown>;
    if (fields.length > 0) {
      updateSql = `update employees set ${fields.join(', ')}
         where id::text = $2 and company_id::text = $1
         returning ${buildEmployeeReturningColumns(employeeLinks)}`;
      const updated = await client.query(
        updateSql,
        values,
      );
      employeeRow = (updated.rows[0] as Record<string, unknown> | undefined) ?? employeeRow;
    }
    try {
      // Em bancos migrados do Supabase, public.users.id ainda pode ter FK para auth.users.
      // Em edição, não crie users automaticamente: sincronize apenas se a linha já existir.
      const userSync = await syncUserFieldsFromEmployeeBody(id, companyId, body, employeeRow, client);
      if (userSync.attempted && userSync.updatedRows === 0) {
        logger.warn({
          module: 'employee.controller',
          action: 'EMPLOYEE_USER_SYNC_SKIPPED',
          message: 'Colaborador atualizado sem sincronizar users; nenhum registro correspondente foi encontrado',
          userId: req.auth?.userId ?? req.auth?.sub ?? null,
          companyId,
          meta: { employeeId: id },
        });
      }
    } catch (userSyncError) {
      logger.error({
        module: 'employee.controller',
        action: 'EMPLOYEE_USER_SYNC_FAILED',
        message: 'UPDATE FAILURE: sincronização auxiliar com users falhou',
        userId: req.auth?.userId ?? req.auth?.sub ?? null,
        companyId,
        error: userSyncError,
        meta: {
          endpoint: req.originalUrl,
          method: req.method,
          employeeId: id,
          payload: body,
          payloadKeys: Object.keys(body).sort(),
          patchFields: fields,
          sql: updateSql || null,
          originalError: describeDbError(userSyncError),
        },
      });
      throw userSyncError;
    }
    await client.query('commit');
    let refreshed: Record<string, unknown> | null = null;
    try {
      refreshed = await fetchEmployeeViewById(pool, id, companyId);
    } catch (refreshError) {
      logger.warn({
        module: 'employee.controller',
        action: 'EMPLOYEE_UPDATE_REFRESH_FAILED',
        message: 'Colaborador atualizado, mas a releitura falhou; usando retorno do UPDATE',
        userId: req.auth?.userId ?? req.auth?.sub ?? null,
        companyId,
        error: refreshError,
        meta: { employeeId: id },
      });
    }
    const employee = mapRow(refreshed ?? employeeRow);
    res.json({ ok: true, success: true, employee, data: employee });
  } catch (e: unknown) {
    if (client) {
      try {
        await client.query('rollback');
      } catch {
        // noop
      }
    }
    const dbCode = String((e as { code?: string })?.code || '');
    if (dbCode === '23505') {
      res.status(409).json({
        ok: false,
        success: false,
        error: 'CPF ou e-mail já cadastrado',
        code: 'EMPLOYEE_DUPLICATE',
        message: 'CPF ou e-mail já cadastrado.',
      });
      return;
    }
    if (dbCode === '23503' || dbCode === '23514' || dbCode === '23502' || dbCode === '22P02') {
      const dbError = describeDbError(e);
      const constraintMessage =
        dbCode === '23503' || dbCode === '23514'
          ? 'Vínculo inválido de escala, horário ou empresa.'
          : dbCode === '23502'
            ? 'Campo obrigatório ausente para atualizar colaborador.'
            : 'Valor inválido para o tipo esperado no banco.';
      logger.warn({
        module: 'employee.controller',
        action: 'EMPLOYEE_UPDATE_REJECTED_BY_DB',
        message: constraintMessage,
        userId: req.auth?.userId ?? req.auth?.sub ?? null,
        companyId,
        error: e,
        meta: {
          employeeId: id,
          dbCode,
          sql: updateSql || null,
          payloadKeys: Object.keys(body).sort(),
          patchFields: fields,
          originalError: dbError,
        },
      });
      res.status(400).json({
        ok: false,
        success: false,
        error: dbError.message || constraintMessage,
        code: dbError.code || 'EMPLOYEE_UPDATE_REJECTED',
        message: dbError.message || constraintMessage,
        detail: dbError.detail,
        stack: dbError.stack,
        details: {
          employeeId: id,
          dbCode,
          payloadKeys: Object.keys(body).sort(),
          patchFields: fields,
          sql: updateSql || null,
          originalError: dbError,
        },
      });
      return;
    }
    const dbError = describeDbError(e);
    const message = dbError.message;
    const code = 'EMPLOYEE_UPDATE_FAILED';
    logger.error({
      module: 'employee.controller',
      action: 'EMPLOYEE_UPDATE_FAILED',
      message: 'UPDATE FAILURE',
      userId: req.auth?.userId ?? req.auth?.sub ?? null,
      companyId,
      error: e,
      meta: {
        endpoint: req.originalUrl,
        method: req.method,
        employeeId: id,
        code,
        dbCode: dbCode || null,
        sql: updateSql || null,
        payload: body,
        payloadKeys: Object.keys(body).sort(),
        patchFields: fields,
        originalError: dbError,
      },
    });
    res.status(500).json({
      ok: false,
      success: false,
      error: message,
      code: dbError.code || code,
      message,
      detail: dbError.detail,
      stack: dbError.stack,
      details: {
        employeeId: id,
        reason: code,
        dbCode: dbCode || undefined,
        sql: updateSql || null,
        payloadKeys: Object.keys(body).sort(),
        patchFields: fields,
        originalError: dbError,
      },
    });
  } finally {
    client?.release();
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

  let client: PoolClient | null = null;
  try {
    client = await pool.connect();
    await client.query('begin');
    const target = await client.query(
      `select
         e.id::text as id,
         coalesce(nullif(trim(e.email), ''), nullif(trim(u.email), '')) as email
       from employees e
       left join users u on u.id::text = e.id::text and u.company_id::text = e.company_id::text
       where e.id::text = $1 and e.company_id::text = $2
       limit 1`,
      [id, companyId],
    );
    if (!target.rows[0]) {
      await client.query('rollback');
      res.status(404).json({ ok: false, error: 'not_found' });
      return;
    }
    if (isProtectedSystemUserEmail(target.rows[0].email)) {
      await client.query('rollback');
      res.status(403).json({
        ok: false,
        success: false,
        error: 'protected_system_user',
        code: 'EMPLOYEE_PROTECTED_SYSTEM_USER',
        message: 'Conta administrativa protegida não pode ser excluída pela tela de colaboradores.',
      });
      return;
    }

    const hasEmployeeStatus = await tableHasColumn('employees', 'status', client);
    const result = hasEmployeeStatus
      ? await client.query(
          `update employees
             set status = 'inactive'
           where id::text = $1 and company_id::text = $2
           returning id`,
          [id, companyId],
        )
      : await client.query('delete from employees where id::text = $1 and company_id::text = $2 returning id', [
          id,
          companyId,
        ]);

    if (await tableHasColumn('users', 'status', client)) {
      await client.query(
        `update users
           set status = 'inactive'
         where id::text = $1 and company_id::text = $2`,
        [id, companyId],
      );
    }

    await client.query('commit');
    res.json({ ok: true });
  } catch (e) {
    if (client) {
      try {
        await client.query('rollback');
      } catch {
        // noop
      }
    }
    logger.error({
      module: 'employee.controller',
      action: 'EMPLOYEE_DELETE_FAILED',
      message: 'Falha ao remover colaborador',
      userId: req.auth?.userId ?? req.auth?.sub ?? null,
      companyId,
      error: e,
    });
    res.status(500).json({ ok: false, error: 'delete_failed' });
  } finally {
    client?.release();
  }
}
