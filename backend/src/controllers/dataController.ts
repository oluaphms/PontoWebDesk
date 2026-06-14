import type { Response } from 'express';
import { pool } from '../db/index.js';
import type { AuthedRequest } from '../middlewares/authMiddleware.js';
import { authUserId, isAdminOrHr, normalizeRole, requireCompanyId } from '../utils/authContext.js';
import { logAuthDenied } from '../services/authAuditService.js';
import { sendClientSafeError } from '../utils/clientSafeError.js';
import {
  ALLOWED_TABLES,
  USER_SCOPED_TABLES,
  isTableReadable,
  isTableWritable,
  tableHasTenantScope,
} from '../utils/dataTablePolicy.js';
import {
  applyTenantToRowAsync,
  coerceArrayValue,
  DataRowValidationError,
  filterRowToTableSchema,
  getReadableTableColumns,
  getTableColumnTypes,
  isSensitiveColumnName,
  sqlParamRef,
  tableHasColumn,
  tenantScopeSqlForTable,
} from '../utils/dataRowSchema.js';
import { logger } from '../logger/logger.js';
import { executeRepRpcProxy, isRepRpcFunction } from '../services/repRpcProxy.service.js';

const ALLOWED_OPS = new Set([
  'eq',
  'neq',
  'gt',
  'gte',
  'lt',
  'lte',
  'like',
  'ilike',
  'in',
  'is',
  'not_is',
]);

type FilterInput = { column: string; operator: string; value: unknown };

const SELF_SCOPED_USER_ID_TABLES = new Set(['time_records', 'time_balance', 'time_logs']);
const SELF_SCOPED_EMPLOYEE_ID_TABLES = new Set(['bank_hours', 'bank_hours_ledger']);
const DATA_QUERY_LOG_TABLES = new Set(['time_records', 'schedules', 'estruturas', 'estrutura_responsaveis']);
const LEGACY_AUTH_USER_FK_EMPLOYEE_TABLES = new Set([
  'bank_hours_ledger',
  'timesheets_daily',
  'timesheets_daily_snapshots',
  'time_engine_afd_audit',
]);
const PROTECTED_SYSTEM_USER_EMAILS = new Set([
  'admin@pontowebdesk.com',
  'desenvolvedor@smartponto.com',
]);

async function resolveUserScopeColumn(table: string): Promise<string | null> {
  if (table === 'users') {
    if (await tableHasColumn(table, 'id')) return 'id';
    if (await tableHasColumn(table, 'user_id')) return 'user_id';
    return null;
  }
  if (await tableHasColumn(table, 'user_id')) return 'user_id';
  if (await tableHasColumn(table, 'id')) return 'id';
  return null;
}

async function userScopedTenantSql(table: string, paramIndex: number): Promise<string | null> {
  if (await tableHasColumn(table, 'company_id')) {
    return `company_id::text = ${sqlParamRef(paramIndex, 'text')}`;
  }
  if (table === 'login_attempts') {
    return `identifier IN (SELECT email FROM public.users WHERE company_id::text = ${sqlParamRef(paramIndex, 'text')} AND email IS NOT NULL)`;
  }
  if (await tableHasColumn(table, 'user_id')) {
    return `user_id IN (SELECT id FROM public.users WHERE company_id::text = ${sqlParamRef(paramIndex, 'text')})`;
  }
  return null;
}

async function assertUserScopedInsertTenant(
  table: string,
  row: Record<string, unknown>,
  companyId: string,
): Promise<string | null> {
  if (!USER_SCOPED_TABLES.has(table)) return null;

  if (table === 'user_settings' || table === 'user_consents') {
    const userId = String(row.user_id ?? '').trim();
    if (!userId) return 'CROSS_TENANT_USER_REFERENCE';
    const result = await pool.query(
      `select company_id::text as company_id
         from public.users
        where id::text = $1
        limit 1`,
      [userId],
    );
    if (!result.rows[0] || String(result.rows[0].company_id) !== companyId) {
      return 'CROSS_TENANT_USER_REFERENCE';
    }
    return null;
  }

  if (table === 'login_attempts') {
    const identifier = String(row.identifier ?? '').trim();
    if (!identifier) return null;
    const result = await pool.query(
      `select 1
         from public.users
        where company_id::text = $1
          and lower(email) = lower($2)
        limit 1`,
      [companyId, identifier],
    );
    if ((result.rowCount ?? 0) === 0) return 'CROSS_TENANT_USER_REFERENCE';
    return null;
  }

  return null;
}

function safeIdent(name: string): string | null {
  if (!/^[a-z_][a-z0-9_]*$/i.test(name)) return null;
  return name;
}

function isProtectedSystemUserEmail(email: unknown): boolean {
  return PROTECTED_SYSTEM_USER_EMAILS.has(String(email || '').trim().toLowerCase());
}

function parseFilters(raw: string | undefined): FilterInput[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as FilterInput[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function buildWhere(
  table: string,
  filters: FilterInput[],
  companyId: string,
  userId: string,
  role: string | undefined,
): Promise<{ clause: string; params: unknown[] }> {
  const parts: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (tableHasTenantScope(table) && companyId) {
    const tenantClause = await tenantScopeSqlForTable(table, idx);
    if (tenantClause) {
      parts.push(tenantClause);
      params.push(companyId);
      idx += 1;
    }
  }

  if (table === 'companies' && companyId) {
    parts.push(`id::text = ${sqlParamRef(idx, 'text')}`);
    params.push(companyId);
    idx += 1;
  }

  if (table === 'users' && companyId && (await tableHasColumn(table, 'company_id'))) {
    parts.push(`company_id::text = ${sqlParamRef(idx, 'text')}`);
    params.push(companyId);
    idx += 1;
  }

  if (table === 'employees' && !isAdminOrHr(role) && userId) {
    if (await tableHasColumn(table, 'email')) {
      parts.push(
        `(id::text = ${sqlParamRef(idx, 'text')} OR email = (select email from public.users where id::text = ${sqlParamRef(idx, 'text')} limit 1))`,
      );
    } else {
      parts.push(`id::text = ${sqlParamRef(idx, 'text')}`);
    }
    params.push(userId);
    idx += 1;
  }

  if (!isAdminOrHr(role) && userId) {
    const selfScopeColumn =
      SELF_SCOPED_USER_ID_TABLES.has(table) && (await tableHasColumn(table, 'user_id'))
        ? 'user_id'
        : SELF_SCOPED_EMPLOYEE_ID_TABLES.has(table) && (await tableHasColumn(table, 'employee_id'))
          ? 'employee_id'
          : null;
    if (selfScopeColumn) {
      parts.push(`${selfScopeColumn}::text = ${sqlParamRef(idx, 'text')}`);
      params.push(userId);
      idx += 1;
    }
  }

  if (USER_SCOPED_TABLES.has(table) && companyId) {
    const tenantClause = await userScopedTenantSql(table, idx);
    if (tenantClause) {
      parts.push(tenantClause);
      params.push(companyId);
      idx += 1;
    }
  }

  if (USER_SCOPED_TABLES.has(table) && !isAdminOrHr(role)) {
    const userScopeColumn = await resolveUserScopeColumn(table);
    if (!userScopeColumn || !userId) {
      throw new Error('user_scope_unavailable');
    }
    parts.push(`${userScopeColumn}::text = ${sqlParamRef(idx, 'text')}`);
    params.push(userId);
    idx += 1;
  }

  for (const f of filters) {
    const col = safeIdent(f.column);
    const op = ALLOWED_OPS.has(f.operator) ? f.operator : 'eq';
    if (!col || isSensitiveColumnName(col)) continue;

    if (op === 'in') {
      const arr = Array.isArray(f.value) ? f.value : [f.value];
      parts.push(`${col} = ANY($${idx}::text[])`);
      params.push(arr.map(String));
      idx += 1;
      continue;
    }
    if (op === 'is') {
      if (f.value === null) {
        parts.push(`${col} IS NULL`);
      } else {
        parts.push(`${col} IS ${sqlParamRef(idx, typeof f.value === 'boolean' ? 'boolean' : 'text')}`);
        params.push(f.value);
        idx += 1;
      }
      continue;
    }
    if (op === 'not_is') {
      parts.push(`${col} IS NOT NULL`);
      continue;
    }
    const sqlOp =
      op === 'eq'
        ? '='
        : op === 'neq'
          ? '<>'
          : op === 'gt'
            ? '>'
            : op === 'gte'
              ? '>='
              : op === 'lt'
                ? '<'
                : op === 'lte'
                  ? '<='
                  : op === 'like'
                    ? 'LIKE'
                    : 'ILIKE';
    parts.push(`${col} ${sqlOp} $${idx}`);
    params.push(f.value);
    idx += 1;
  }

  return { clause: parts.length ? `WHERE ${parts.join(' AND ')}` : '', params };
}

function denyTableAccess(
  req: AuthedRequest,
  res: Response,
  table: string,
  op: 'read' | 'write',
): boolean {
  const role = normalizeRole(req.auth?.role);
  const allowed = op === 'read' ? isTableReadable(table, role) : isTableWritable(table, role);
  if (!allowed) {
    void logAuthDenied(req, 403, op === 'read' ? 'table_read_forbidden' : 'table_write_forbidden', {
      table,
    });
    res.status(403).json({ ok: false, error: 'forbidden', message: 'Sem permissão para esta tabela.' });
    return true;
  }
  return false;
}

export async function authenticatedGlobalSettingsController(req: AuthedRequest, res: Response): Promise<void> {
  const companyId = requireCompanyId(req, res);
  if (!companyId) return;
  try {
    const readable = (await getReadableTableColumns('global_settings')).filter((c) => safeIdent(c));
    const returningSql = readable.length ? readable.join(', ') : '*';
    const hasCompany = await tableHasColumn('global_settings', 'company_id');
    const sql = hasCompany
      ? `select ${returningSql} from public.global_settings where company_id::text = $1 limit 1`
      : `select ${returningSql} from public.global_settings limit 1`;
    const result = await pool.query(sql, hasCompany ? [companyId] : []);
    res.json({ ok: true, success: true, data: result.rows });
  } catch (e) {
    logger.warn({
      module: 'data.controller',
      action: 'GLOBAL_SETTINGS_FAILED',
      message: 'Falha ao ler global_settings autenticada',
      userId: req.auth?.userId ?? req.auth?.sub ?? null,
      companyId,
      error: e,
    });
    res.json({ ok: true, success: true, data: [] });
  }
}

async function ensureLegacyAuthUserMirrorForEmployeeId(table: string, row: Record<string, unknown>): Promise<void> {
  if (!LEGACY_AUTH_USER_FK_EMPLOYEE_TABLES.has(table)) return;
  const employeeId = String(row.employee_id ?? '').trim();
  if (!employeeId) return;

  const columns = await pool.query<{ column_name: string }>(
    `select column_name
       from information_schema.columns
      where table_schema = 'auth'
        and table_name = 'users'`,
  );
  const names = new Set(columns.rows.map((r) => r.column_name));
  if (!names.has('id')) return;

  const insertColumns = ['id'];
  const selectValues = ['src.id'];
  const updateSets: string[] = [];
  const addColumn = (column: string, expression: string, updateExpression = `excluded.${column}`): void => {
    if (!names.has(column)) return;
    insertColumns.push(column);
    selectValues.push(expression);
    if (column !== 'id') updateSets.push(`${column} = ${updateExpression}`);
  };

  addColumn('email', "coalesce(nullif(src.email, ''), concat(src.id::text, '@legacy.pontowebdesk.local'))");
  addColumn('aud', "'authenticated'");
  addColumn('role', "'authenticated'");
  addColumn('encrypted_password', "coalesce(src.password_hash, '')");
  addColumn('email_confirmed_at', 'now()');
  addColumn('raw_app_meta_data', `'{"provider":"email","providers":["email"]}'::jsonb`);
  addColumn(
    'raw_user_meta_data',
    `jsonb_build_object(
       'nome', src.nome,
       'email', src.email,
       'role', src.role,
       'company_id', src.company_id::text,
       'source', 'vps-public-users-mirror'
     )`,
  );
  addColumn('created_at', 'now()', 'auth.users.created_at');
  addColumn('updated_at', 'now()', 'now()');

  const updateSql = updateSets.length ? `do update set ${updateSets.join(', ')}` : 'do nothing';
  await pool.query(
    `insert into auth.users (${insertColumns.join(', ')})
     select ${selectValues.join(', ')}
     from (
       select id, company_id, nome, email, role, password_hash
         from public.users
        where id::text = $1
       union all
       select e.id, e.company_id, e.nome, e.email, coalesce(e.role, 'employee') as role, null::text as password_hash
         from public.employees e
        where e.id::text = $1
          and not exists (select 1 from public.users u where u.id::text = $1)
       limit 1
     ) src
     on conflict (id) ${updateSql}`,
    [employeeId],
  );
}

async function dataWriteScopeSql(table: string, paramIndex: number): Promise<string | null> {
  if (tableHasTenantScope(table)) return tenantScopeSqlForTable(table, paramIndex);
  if (table === 'companies') return `id::text = ${sqlParamRef(paramIndex, 'text')}`;
  if (table === 'users' && (await tableHasColumn(table, 'company_id'))) {
    return `company_id::text = ${sqlParamRef(paramIndex, 'text')}`;
  }
  if (USER_SCOPED_TABLES.has(table)) return userScopedTenantSql(table, paramIndex);
  return null;
}

function sanitizeGenericWritePayload(
  table: string,
  raw: Record<string, unknown>,
  companyId: string,
  role: string | undefined,
): Record<string, unknown> {
  const next = { ...raw };
  delete next.tenant_id;
  delete next.tenantId;
  if (table === 'users') {
    next.company_id = companyId;
    delete next.companyId;
    if (normalizeRole(role) !== 'admin') {
      delete next.role;
    }
  }
  return next;
}

function failureBody(error: string, code: string, details?: Record<string, unknown>) {
  return {
    ok: false,
    success: false,
    error,
    code,
    ...(details ? { details } : {}),
  };
}

function requestId(req: AuthedRequest): string | null {
  const header = req.headers['x-correlation-id'] ?? req.headers['x-request-id'];
  return Array.isArray(header) ? String(header[0] ?? '') || null : header ? String(header) : null;
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

function sortedKeys(row: Record<string, unknown> | null | undefined): string[] {
  return Object.keys(row ?? {}).sort();
}

function writeColumnType(table: string, column: string, colTypes: Map<string, string>): string {
  if (table === 'schedules' && column === 'days') return 'integer[]';
  return colTypes.get(column) ?? 'text';
}

function sqlValueForColumn(value: unknown, dataType: string): unknown {
  if (value === null || value === undefined) return null;
  if (dataType === 'json' || dataType === 'jsonb') return JSON.stringify(value);
  return value;
}

function prepareSchedulesPayload(row: Record<string, unknown>): Record<string, unknown> {
  if (!('days' in row)) return row;
  return {
    ...row,
    days: coerceArrayValue('days', 'integer[]', row.days),
  };
}

function normalizeStructureCode(value: unknown): string {
  return String(value ?? '').trim();
}

function nextNumericStructureCode(existingCodes: Set<string>, preferredWidth: number): string {
  let max = 0;
  for (const code of existingCodes) {
    if (/^\d+$/.test(code)) max = Math.max(max, Number(code));
  }
  const width = Math.max(3, preferredWidth);
  let next = max + 1;
  for (;;) {
    const candidate = String(next).padStart(width, '0');
    if (!existingCodes.has(candidate)) return candidate;
    next += 1;
  }
}

async function resolveStructureCode(input: {
  companyId: string;
  requestedCode: unknown;
  excludeId?: string;
}): Promise<string> {
  const requested = normalizeStructureCode(input.requestedCode);
  const params: unknown[] = [input.companyId];
  let excludeClause = '';
  if (input.excludeId) {
    params.push(input.excludeId);
    excludeClause = ` AND id::text <> ${sqlParamRef(2, 'text')}`;
  }
  const sql = `SELECT codigo FROM public.estruturas WHERE company_id::text = ${sqlParamRef(1, 'text')}${excludeClause}`;
  const result = await pool.query(sql, params);
  const existingCodes = new Set(result.rows.map((row) => normalizeStructureCode(row.codigo)).filter(Boolean));

  if (!requested) return nextNumericStructureCode(existingCodes, 3);
  if (!existingCodes.has(requested)) return requested;
  if (/^\d+$/.test(requested)) return nextNumericStructureCode(existingCodes, requested.length);

  let suffix = 2;
  for (;;) {
    const candidate = `${requested}-${suffix}`;
    if (!existingCodes.has(candidate)) return candidate;
    suffix += 1;
  }
}

async function prepareEstruturasPayload(
  row: Record<string, unknown>,
  companyId: string,
  excludeId?: string,
): Promise<Record<string, unknown>> {
  if (!('codigo' in row)) return row;
  return {
    ...row,
    codigo: await resolveStructureCode({
      companyId,
      requestedCode: row.codigo,
      excludeId,
    }),
  };
}

function logDataQuery(
  req: AuthedRequest,
  action: string,
  message: string,
  table: string,
  companyId: string,
  sql: string,
  params: unknown[],
  returnedRows: number,
  extraMeta?: Record<string, unknown>,
): void {
  if (!DATA_QUERY_LOG_TABLES.has(table)) return;
  logger.info({
    module: 'data.controller',
    action,
    message,
    requestId: requestId(req) ?? undefined,
    userId: req.auth?.userId ?? req.auth?.sub ?? null,
    companyId,
    meta: {
      employeeId: authUserId(req.auth),
      table,
      sql,
      params,
      returnedRows,
      ...extraMeta,
    },
  });
}

export async function listDataController(req: AuthedRequest, res: Response): Promise<void> {
  const table = safeIdent(String(req.params.table || ''));
  if (!table || !ALLOWED_TABLES.has(table)) {
    if (table === 'employees') {
      res.status(400).json({
        ok: false,
        error: 'table_not_allowed',
        recommended_endpoint: '/api/employees',
      });
      return;
    }
    res.status(400).json({ ok: false, error: 'table_not_allowed' });
    return;
  }
  if (denyTableAccess(req, res, table, 'read')) return;

  const companyId = requireCompanyId(req, res);
  if (companyId === null) return;

  const filters = parseFilters(typeof req.query.filters === 'string' ? req.query.filters : undefined);
  const rawCols = String(req.query.columns || '*').trim();
  const readableColumns = await getReadableTableColumns(table);
  const readableSet = new Set(readableColumns);
  if (!readableColumns.length) {
    res.status(400).json({ ok: false, error: 'columns_not_allowed' });
    return;
  }
  const selectedColumns =
    rawCols === '*'
      ? readableColumns
      : rawCols
          .split(',')
          .map((c) => safeIdent(c.trim()))
          .filter((c): c is string => c !== null && readableSet.has(c) && !isSensitiveColumnName(c));
  if (rawCols !== '*' && !selectedColumns.length) {
    res.status(400).json({ ok: false, error: 'columns_not_allowed' });
    return;
  }
  const columns = selectedColumns.join(', ');
  const limit = Math.min(2000, Math.max(1, Number(req.query.limit) || 200));
  const offset = Math.max(0, Number(req.query.offset) || 0);
  const requestedOrder = safeIdent(String(req.query.orderColumn || ''));
  let orderCol = requestedOrder && !isSensitiveColumnName(requestedOrder) ? requestedOrder : null;
  if (!orderCol) {
    if (await tableHasColumn(table, 'created_at')) orderCol = 'created_at';
    else if (await tableHasColumn(table, 'id')) orderCol = 'id';
    else orderCol = null;
  }
  const orderAsc = req.query.orderAsc !== 'false';

  try {
    const { clause, params } = await buildWhere(
      table,
      filters,
      companyId,
      authUserId(req.auth),
      req.auth?.role,
    );
    const order = orderCol ? `ORDER BY ${orderCol} ${orderAsc ? 'ASC' : 'DESC'}` : '';
    const sql = `SELECT ${columns} FROM public.${table} ${clause} ${order} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    const result = await pool.query(sql, [...params, limit, offset]);
    logDataQuery(
      req,
      table === 'time_records' ? 'TIME_RECORDS_LIST_QUERY' : 'DATA_LIST_QUERY',
      `Consulta de ${table} executada`,
      table,
      companyId,
      sql,
      [...params, limit, offset],
      result.rowCount ?? result.rows.length,
      { filters },
    );
    res.json({ ok: true, success: true, data: result.rows });
  } catch (e) {
    const pgMsg = e instanceof Error ? e.message : String(e);
    if (pgMsg === 'user_scope_unavailable') {
      res.status(403).json(failureBody('forbidden', 'DATA_USER_SCOPE_FORBIDDEN'));
      return;
    }
    logger.error({
      module: 'data.controller',
      action: 'DATA_LIST_FAILED',
      message: 'Falha ao listar dados',
      userId: req.auth?.userId ?? req.auth?.sub ?? null,
      companyId,
      error: e,
      meta: { table, pgMsg },
    });
    res.status(500).json(failureBody('query_failed', 'DATA_QUERY_FAILED', { table }));
  }
}

export async function insertDataController(req: AuthedRequest, res: Response): Promise<void> {
  const table = safeIdent(String(req.params.table || ''));
  if (!table || !ALLOWED_TABLES.has(table)) {
    if (table === 'employees') {
      res.status(400).json({
        ok: false,
        error: 'table_not_allowed',
        recommended_endpoint: '/api/employees',
      });
      return;
    }
    res.status(400).json({ ok: false, error: 'table_not_allowed' });
    return;
  }
  if (denyTableAccess(req, res, table, 'write')) return;

  const companyId = requireCompanyId(req, res);
  if (companyId === null) return;
  if (table === 'companies') {
    res.status(403).json({
      ok: false,
      success: false,
      error: 'forbidden',
      code: 'COMPANY_GENERIC_INSERT_FORBIDDEN',
      message: 'Criação de empresas deve usar o fluxo de onboarding multi-tenant.',
    });
    return;
  }

  const raw = req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {};
  let writeRaw: Record<string, unknown> = {};
  let scoped: Record<string, unknown> = {};
  let row: Record<string, unknown> = {};
  let keys: string[] = [];
  let values: unknown[] = [];
  let sql = '';
  try {
    writeRaw = sanitizeGenericWritePayload(table, raw, companyId, req.auth?.role);
    scoped = await applyTenantToRowAsync(table, writeRaw, companyId);
    row = await filterRowToTableSchema(table, scoped);
    if (table === 'schedules') {
      row = prepareSchedulesPayload(row);
    }
    if (table === 'estruturas') {
      row = await prepareEstruturasPayload(row, companyId);
    }
    const crossTenantCode = await assertUserScopedInsertTenant(table, row, companyId);
    if (crossTenantCode) {
      res.status(403).json({
        ok: false,
        success: false,
        error: 'forbidden',
        code: crossTenantCode,
        message: 'Referência de usuário fora do tenant autenticado.',
      });
      return;
    }
    await ensureLegacyAuthUserMirrorForEmployeeId(table, row);
    keys = Object.keys(row).filter((k) => safeIdent(k));
    if (!keys.length) {
      res.status(400).json({
        ok: false,
        success: false,
        error: 'empty_payload',
        code: 'DATA_EMPTY_INSERT_PAYLOAD',
        message: 'Nenhum campo gravável permaneceu após validar o payload contra o schema da tabela.',
        details: {
          table,
          payloadKeys: sortedKeys(raw),
          sanitizedKeys: sortedKeys(writeRaw),
          scopedKeys: sortedKeys(scoped),
          filteredKeys: sortedKeys(row),
        },
      });
      return;
    }
    const colTypes = await getTableColumnTypes(table);
    const returningColumns = (await getReadableTableColumns(table)).filter((c) => safeIdent(c));
    const cols = keys.join(', ');
    const placeholders = keys
      .map((k, i) => sqlParamRef(i + 1, writeColumnType(table, k, colTypes)))
      .join(', ');
    values = keys.map((k) => sqlValueForColumn(row[k], writeColumnType(table, k, colTypes)));
    const returningSql = returningColumns.length ? ` RETURNING ${returningColumns.join(', ')}` : '';
    sql = `INSERT INTO public.${table} (${cols}) VALUES (${placeholders})${returningSql}`;
    const result = await pool.query(sql, values);
    logDataQuery(
      req,
      table === 'schedules' ? 'SCHEDULES_INSERT_QUERY' : 'DATA_INSERT_QUERY',
      `Insert de ${table} executado`,
      table,
      companyId,
      sql,
      values,
      result.rowCount ?? result.rows.length,
      { payloadKeys: sortedKeys(raw), filteredKeys: keys },
    );
    res.json({ ok: true, success: true, data: result.rows[0] ?? null });
  } catch (e) {
    if (e instanceof DataRowValidationError) {
      res.status(400).json({
        ok: false,
        success: false,
        error: e.message,
        code: e.code,
        message: e.message,
        details: {
          table,
          ...e.details,
        },
      });
      return;
    }
    const dbError = describeDbError(e);
    logger.error({
      module: 'data.controller',
      action: 'DATA_INSERT_FAILED',
      message: 'INSERT FAILURE',
      userId: req.auth?.userId ?? req.auth?.sub ?? null,
      companyId,
      error: e,
      meta: {
        endpoint: req.originalUrl,
        method: req.method,
        table,
        sql: sql || null,
        paramsCount: values.length,
        payload: raw,
        payloadKeys: sortedKeys(raw),
        sanitizedPayload: writeRaw,
        scopedPayload: scoped,
        filteredPayload: row,
        filteredKeys: keys,
        dbError,
      },
    });
    const isConflict = dbError.code === '23505';
    sendClientSafeError(
      res,
      isConflict ? 409 : 500,
      isConflict ? 'DATA_UNIQUE_CONFLICT' : 'DATA_INSERT_FAILED',
      dbError.message,
      {
        detail: dbError.detail,
        details: {
          table,
          reason: 'DATA_INSERT_FAILED',
          payloadKeys: sortedKeys(raw),
        },
      },
    );
  }
}

export async function updateDataController(req: AuthedRequest, res: Response): Promise<void> {
  const table = safeIdent(String(req.params.table || ''));
  const id = String(req.params.id || '');
  if (!table || !ALLOWED_TABLES.has(table) || !id) {
    res.status(400).json({ ok: false, error: 'invalid_request' });
    return;
  }
  if (denyTableAccess(req, res, table, 'write')) return;

  if (USER_SCOPED_TABLES.has(table) && !isAdminOrHr(req.auth?.role)) {
    res.status(403).json({ ok: false, error: 'forbidden' });
    return;
  }

  const companyId = requireCompanyId(req, res);
  if (companyId === null) return;

  const raw = req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {};
  let writeRaw: Record<string, unknown> = {};
  let scoped: Record<string, unknown> = {};
  let row: Record<string, unknown> = {};
  let keys: string[] = [];
  let params: unknown[] = [];
  let sql = '';
  try {
    writeRaw = sanitizeGenericWritePayload(table, raw, companyId, req.auth?.role);
    scoped = await applyTenantToRowAsync(table, writeRaw, companyId);
    row = await filterRowToTableSchema(table, scoped);
    if (table === 'schedules') {
      row = prepareSchedulesPayload(row);
    }
    if (table === 'estruturas') {
      row = await prepareEstruturasPayload(row, companyId, id);
    }
    keys = Object.keys(row).filter((k) => safeIdent(k) && k !== 'id');
    if (!keys.length) {
      res.status(400).json({
        ok: false,
        success: false,
        error: 'empty_payload',
        code: 'DATA_EMPTY_UPDATE_PAYLOAD',
        message: 'Nenhum campo gravável permaneceu após validar o payload contra o schema da tabela.',
        details: {
          table,
          id,
          payloadKeys: sortedKeys(raw),
          sanitizedKeys: sortedKeys(writeRaw),
          scopedKeys: sortedKeys(scoped),
          filteredKeys: sortedKeys(row),
        },
      });
      return;
    }
    const colTypes = await getTableColumnTypes(table);
    const returningColumns = (await getReadableTableColumns(table)).filter((c) => safeIdent(c));
    const sets = keys
      .map((k, i) => `${k} = ${sqlParamRef(i + 1, writeColumnType(table, k, colTypes))}`)
      .join(', ');
    const values = keys.map((k) => sqlValueForColumn(row[k], writeColumnType(table, k, colTypes)));

    const tenantIdx = keys.length + 1;
    const tenantScope = await dataWriteScopeSql(table, tenantIdx);
    const idIdx = keys.length + (tenantScope ? 2 : 1);
    const tenantClause = tenantScope ? ` AND ${tenantScope}` : '';
    params = [...values, ...(tenantScope ? [companyId] : []), id];

    const idCast = sqlParamRef(idIdx, 'text');
    const returningSql = returningColumns.length ? ` RETURNING ${returningColumns.join(', ')}` : '';
    sql = `UPDATE public.${table} SET ${sets} WHERE id::text = ${idCast}${tenantClause}${returningSql}`;
    const result = await pool.query(sql, params);
    logDataQuery(
      req,
      table === 'schedules' ? 'SCHEDULES_UPDATE_QUERY' : 'DATA_UPDATE_QUERY',
      `Update de ${table} executado`,
      table,
      companyId,
      sql,
      params,
      result.rowCount ?? result.rows.length,
      { id, payloadKeys: sortedKeys(raw), filteredKeys: keys },
    );
    if (returningSql && !result.rows[0]) {
      res.status(404).json(failureBody('not_found', 'DATA_NOT_FOUND', { table }));
      return;
    }
    res.json({ ok: true, success: true, data: result.rows[0] ?? null });
  } catch (e) {
    if (e instanceof DataRowValidationError) {
      res.status(400).json({
        ok: false,
        success: false,
        error: e.message,
        code: e.code,
        message: e.message,
        details: {
          table,
          id,
          ...e.details,
        },
      });
      return;
    }
    const dbError = describeDbError(e);
    logger.error({
      module: 'data.controller',
      action: 'DATA_UPDATE_FAILED',
      message: 'UPDATE FAILURE',
      userId: req.auth?.userId ?? req.auth?.sub ?? null,
      companyId,
      error: e,
      meta: {
        endpoint: req.originalUrl,
        method: req.method,
        table,
        id,
        sql: sql || null,
        paramsCount: params.length,
        payload: raw,
        payloadKeys: sortedKeys(raw),
        sanitizedPayload: writeRaw,
        scopedPayload: scoped,
        filteredPayload: row,
        filteredKeys: keys,
        dbError,
      },
    });
    const isConflict = dbError.code === '23505';
    sendClientSafeError(
      res,
      isConflict ? 409 : 500,
      isConflict ? 'DATA_UNIQUE_CONFLICT' : 'DATA_UPDATE_FAILED',
      dbError.message,
      {
        detail: dbError.detail,
        details: {
          table,
          id,
          reason: 'DATA_UPDATE_FAILED',
          payloadKeys: sortedKeys(raw),
        },
      },
    );
  }
}

export async function deleteDataController(req: AuthedRequest, res: Response): Promise<void> {
  const table = safeIdent(String(req.params.table || ''));
  const id = String(req.params.id || '');
  if (!table || !ALLOWED_TABLES.has(table) || !id) {
    res.status(400).json({ ok: false, error: 'invalid_request' });
    return;
  }
  if (denyTableAccess(req, res, table, 'write')) return;

  if (USER_SCOPED_TABLES.has(table) && !isAdminOrHr(req.auth?.role)) {
    res.status(403).json({ ok: false, error: 'forbidden' });
    return;
  }

  const companyId = requireCompanyId(req, res);
  if (companyId === null) return;

  try {
    if (table === 'users') {
      const target = await pool.query(
        `select email from public.users where id::text = $1 and company_id::text = $2 limit 1`,
        [id, companyId],
      );
      if (isProtectedSystemUserEmail(target.rows[0]?.email)) {
        res.status(403).json({
          ok: false,
          success: false,
          error: 'protected_system_user',
          code: 'DATA_PROTECTED_SYSTEM_USER',
          message: 'Conta administrativa protegida não pode ser excluída.',
        });
        return;
      }
    }

    const tenantScope = await dataWriteScopeSql(table, 2);
    const tenantClause = tenantScope ? ` AND ${tenantScope}` : '';
    const params = tenantScope ? [id, companyId] : [id];
    const sql = `DELETE FROM public.${table} WHERE id::text = ${sqlParamRef(1, 'text')}${tenantClause} RETURNING id`;
    const result = await pool.query(sql, params);
    logDataQuery(
      req,
      'DATA_DELETE_QUERY',
      `Delete de ${table} executado`,
      table,
      companyId,
      sql,
      params,
      result.rowCount ?? result.rows.length,
      { id },
    );
    if (!result.rows[0]) {
      res.status(404).json(failureBody('not_found', 'DATA_NOT_FOUND', { table }));
      return;
    }
    res.json({ ok: true, success: true });
  } catch (e) {
    logger.error({
      module: 'data.controller',
      action: 'DATA_DELETE_FAILED',
      message: 'Falha ao excluir dados',
      userId: req.auth?.userId ?? req.auth?.sub ?? null,
      companyId,
      error: e,
      meta: { table, id },
    });
    res.status(500).json({ ok: false, error: 'delete_failed' });
  }
}

export async function countDataController(req: AuthedRequest, res: Response): Promise<void> {
  const table = safeIdent(String(req.params.table || ''));
  if (!table || !ALLOWED_TABLES.has(table)) {
    if (table === 'employees') {
      res.status(400).json({
        ok: false,
        error: 'table_not_allowed',
        recommended_endpoint: '/api/employees',
      });
      return;
    }
    res.status(400).json({ ok: false, error: 'table_not_allowed' });
    return;
  }
  if (denyTableAccess(req, res, table, 'read')) return;

  const companyId = requireCompanyId(req, res);
  if (companyId === null) return;

  const filters = parseFilters(typeof req.query.filters === 'string' ? req.query.filters : undefined);
  try {
    const { clause, params } = await buildWhere(
      table,
      filters,
      companyId,
      authUserId(req.auth),
      req.auth?.role,
    );
    const sql = `SELECT count(*)::int AS c FROM public.${table} ${clause}`;
    const result = await pool.query(sql, params);
    logDataQuery(
      req,
      table === 'time_records' ? 'TIME_RECORDS_COUNT_QUERY' : 'DATA_COUNT_QUERY',
      `Contagem de ${table} executada`,
      table,
      companyId,
      sql,
      params,
      Number(result.rows[0]?.c ?? 0),
      { filters },
    );
    res.json({ ok: true, count: result.rows[0]?.c ?? 0 });
  } catch (e) {
    if (e instanceof Error && e.message === 'user_scope_unavailable') {
      res.status(403).json({ ok: false, error: 'forbidden' });
      return;
    }
    logger.error({
      module: 'data.controller',
      action: 'DATA_COUNT_FAILED',
      message: 'Falha ao contar dados',
      userId: req.auth?.userId ?? req.auth?.sub ?? null,
      companyId,
      error: e,
      meta: { table },
    });
    res.status(500).json({ ok: false, error: 'count_failed' });
  }
}

const ALLOWED_RPC = new Set([
  'get_my_company_id',
  'insert_time_record_for_user',
  'insert_time_record_for_user_v2',
  'timesheet_is_closed_for_stamp',
  'rep_promote_pending_rep_punch_logs',
  'rep_ingest_punch',
  'rep_match_user_id_for_rep_punch_row',
  'rep_ignore_punch_logs',
]);

const INSERT_TIME_RECORD_RPC = new Set(['insert_time_record_for_user', 'insert_time_record_for_user_v2']);
const FUTURE_PUNCH_TOLERANCE_MS = 5 * 60 * 1000;

class RpcHttpError extends Error {
  status: number;
  code: string;
  details?: Record<string, unknown>;

  constructor(status: number, code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'RpcHttpError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function requiredRpcString(args: Record<string, unknown>, keys: string[], label: string): string {
  for (const key of keys) {
    const value = String(args[key] ?? '').trim();
    if (value) return value;
  }
  throw new RpcHttpError(400, 'RPC_MISSING_ARG', `${label} é obrigatório.`, { label, keys });
}

async function dbClockEpochMs(): Promise<number> {
  const result = await pool.query('select extract(epoch from clock_timestamp()) * 1000 as epoch_ms');
  const value = Number(result.rows[0]?.epoch_ms);
  return Number.isFinite(value) ? value : Date.now();
}

function monthYearFromIsoInSaoPaulo(iso: string): { year: number; month: number } | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(date);
  const year = Number(parts.find((part) => part.type === 'year')?.value);
  const month = Number(parts.find((part) => part.type === 'month')?.value);
  return year && month >= 1 && month <= 12 ? { year, month } : null;
}

async function assertTimesheetOpenForManualPunch(input: {
  companyId: string;
  userId: string;
  timestamp: string;
}): Promise<void> {
  const period = monthYearFromIsoInSaoPaulo(input.timestamp);
  if (!period) return;
  const table = await pool.query("select to_regclass('public.timesheet_closures') as table_name");
  if (!table.rows[0]?.table_name) return;
  const closed = await pool.query(
    `select 1
       from public.timesheet_closures
      where company_id::text = $1
        and employee_id::text = $2
        and month = $3
        and year = $4
      limit 1`,
    [input.companyId, input.userId, period.month, period.year],
  );
  if ((closed.rowCount ?? 0) > 0) {
    throw new RpcHttpError(403, 'PERIODO_FECHADO', 'PERIODO_FECHADO', {
      month: period.month,
      year: period.year,
      userId: input.userId,
    });
  }
}

async function executeTimesheetClosedForStampRpc(
  args: Record<string, unknown>,
  companyId: string,
): Promise<boolean> {
  const employeeId = requiredRpcString(args, ['p_employee_id', 'employee_id'], 'p_employee_id');
  const refTs = requiredRpcString(args, ['p_ref_ts', 'ref_ts', 'timestamp'], 'p_ref_ts');
  const period = monthYearFromIsoInSaoPaulo(refTs);
  if (!period) return false;

  const table = await pool.query("select to_regclass('public.timesheet_closures') as table_name");
  if (!table.rows[0]?.table_name) return false;

  const result = await pool.query(
    `select 1
       from public.timesheet_closures
      where company_id::text = $1
        and employee_id::text = $2
        and month = $3
        and year = $4
      limit 1`,
    [companyId, employeeId, period.month, period.year],
  );
  return (result.rowCount ?? 0) > 0;
}

async function buildInsertTimeRecordRpcParams(
  req: AuthedRequest,
  args: Record<string, unknown>,
  companyId: string,
): Promise<unknown[]> {
  const role = normalizeRole(req.auth?.role);
  const selfId = String(req.auth?.sub || req.auth?.userId || '').trim();
  const requestedUserId = requiredRpcString(args, ['p_user_id', 'user_id'], 'p_user_id');
  if (!isAdminOrHr(role) && requestedUserId !== selfId) {
    throw new RpcHttpError(403, 'RPC_FORBIDDEN_USER', 'Sem permissão para registrar ponto para outro usuário.');
  }
  const userId = isAdminOrHr(role) ? requestedUserId : selfId;
  const timestamp = requiredRpcString(args, ['p_timestamp', 'timestamp', 'created_at'], 'p_timestamp');
  const type = requiredRpcString(args, ['p_type', 'type'], 'p_type');
  const source = String(args.p_source ?? args.source ?? 'manual').trim() || 'manual';
  const metadata = args.p_metadata ?? args.metadata ?? {};
  const allowOutOfOrder = Boolean(args.p_allow_out_of_order ?? args.allow_out_of_order ?? args.allowOutOfOrder ?? false);

  const requestMs = new Date(timestamp).getTime();
  if (!Number.isFinite(requestMs)) {
    throw new RpcHttpError(400, 'RPC_INVALID_TIMESTAMP', 'Timestamp inválido para batida manual.', {
      requestTime: timestamp,
    });
  }
  const serverTimeMs = await dbClockEpochMs();
  const differenceSeconds = Math.round((requestMs - serverTimeMs) / 1000);
  logger.info({
    module: 'data.controller',
    action: 'MANUAL_PUNCH_TIME_DIAG',
    message: 'Diagnóstico temporal da batida manual',
    userId: req.auth?.userId ?? req.auth?.sub ?? null,
    companyId,
    meta: {
      serverTime: new Date(serverTimeMs).toISOString(),
      requestTime: timestamp,
      timezone: 'America/Sao_Paulo',
      differenceSeconds,
    },
  });
  if (requestMs - serverTimeMs > FUTURE_PUNCH_TOLERANCE_MS) {
    throw new RpcHttpError(
      400,
      'PUNCH_FUTURE_NOT_ALLOWED',
      `Batida recusada: horário futuro além do permitido (${differenceSeconds}s). Ajuste o relógio do dispositivo ou o horário informado.`,
      {
        serverTime: new Date(serverTimeMs).toISOString(),
        requestTime: timestamp,
        timezone: 'America/Sao_Paulo',
        differenceSeconds,
      },
    );
  }
  await assertTimesheetOpenForManualPunch({ companyId, userId, timestamp });

  return [userId, companyId, timestamp, type, source, JSON.stringify(metadata), allowOutOfOrder];
}

async function executeInsertTimeRecordRpc(
  req: AuthedRequest,
  fn: string,
  args: Record<string, unknown>,
  companyId: string,
): Promise<unknown> {
  const params = await buildInsertTimeRecordRpcParams(req, args, companyId);
  const actorId = String(req.auth?.sub || req.auth?.userId || '').trim();
  const actorRole = normalizeRole(req.auth?.role);
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query(`select set_config('request.jwt.claim.sub', $1, true)`, [actorId]);
    await client.query(`select set_config('request.jwt.claim.company_id', $1, true)`, [companyId]);
    await client.query(`select set_config('request.jwt.claim.role', $1, true)`, [actorRole]);
    await client.query(`select set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify({
        sub: actorId,
        user_id: actorId,
        company_id: companyId,
        role: actorRole,
      }),
    ]);
    const sql =
      `SELECT public.${fn}(` +
      '$1::uuid, $2::uuid, $3::timestamptz, $4::text, $5::text, $6::jsonb, $7::boolean' +
      ') AS result';
    const result = await client.query(sql, params);
    await client.query('commit');
    return result.rows[0]?.result ?? null;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

export async function rpcDataController(req: AuthedRequest, res: Response): Promise<void> {
  const fn = safeIdent(String(req.params.fn || ''));
  if (!fn || !ALLOWED_RPC.has(fn)) {
    res.status(400).json({ ok: false, error: 'rpc_not_allowed' });
    return;
  }

  const companyId = requireCompanyId(req, res);
  if (companyId === null) return;

  const args =
    req.body && typeof req.body === 'object' ? { ...(req.body as Record<string, unknown>) } : {};

  if (fn === 'get_my_company_id') {
    res.json({ ok: true, data: companyId, error: null });
    return;
  }

  if (fn === 'timesheet_is_closed_for_stamp') {
    try {
      const data = await executeTimesheetClosedForStampRpc(args, companyId);
      res.json({ ok: true, data, error: null });
    } catch (e) {
      if (e instanceof RpcHttpError) {
        res.status(e.status).json({
          ok: false,
          data: null,
          error: e.message,
          code: e.code,
          details: e.details,
        });
        return;
      }
      logger.error({
        module: 'data.controller',
        action: 'DATA_RPC_FAILED',
        message: 'Falha em RPC de fechamento de espelho',
        userId: req.auth?.userId ?? req.auth?.sub ?? null,
        companyId,
        error: e,
        meta: { fn },
      });
      res.status(500).json({ ok: false, data: null, error: 'rpc_failed' });
    }
    return;
  }

  if (isRepRpcFunction(fn)) {
    try {
      const data = await executeRepRpcProxy(fn, args, companyId);
      res.json({ ok: true, data, error: null });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'rpc_failed';
      logger.error({
        module: 'data.controller',
        action: 'REP_RPC_FAILED',
        message: 'Falha em RPC REP',
        userId: req.auth?.userId ?? req.auth?.sub ?? null,
        companyId,
        error: e,
        meta: { fn, args },
      });
      res.status(msg === 'company_id mismatch' ? 403 : 500).json({
        ok: false,
        data: null,
        error: msg,
        code: msg === 'company_id mismatch' ? 'FORBIDDEN' : 'REP_RPC_FAILED',
      });
    }
    return;
  }

  if (INSERT_TIME_RECORD_RPC.has(fn)) {
    try {
      const data = await executeInsertTimeRecordRpc(req, fn, args, companyId);
      res.json({ ok: true, data, error: null });
    } catch (e) {
      if (e instanceof RpcHttpError) {
        res.status(e.status).json({
          ok: false,
          data: null,
          error: e.message,
          code: e.code,
          details: e.details,
        });
        return;
      }
      logger.error({
        module: 'data.controller',
        action: 'DATA_RPC_FAILED',
        message: 'Falha em RPC de batida manual',
        userId: req.auth?.userId ?? req.auth?.sub ?? null,
        companyId,
        error: e,
        meta: { fn },
      });
      res.status(500).json({ ok: false, data: null, error: e instanceof Error ? e.message : 'rpc_failed' });
    }
    return;
  }

  const params = Object.values(args);
  const placeholders = params.map((_, i) => `$${i + 1}`).join(', ');
  try {
    const sql =
      params.length > 0
        ? `SELECT public.${fn}(${placeholders}) AS result`
        : `SELECT public.${fn}() AS result`;
    const result = await pool.query(sql, params);
    const data = result.rows[0]?.result ?? null;
    res.json({ ok: true, data, error: null });
  } catch (e) {
    logger.error({
      module: 'data.controller',
      action: 'DATA_RPC_FAILED',
      message: 'Falha em RPC de dados',
      userId: req.auth?.userId ?? req.auth?.sub ?? null,
      companyId,
      error: e,
      meta: { fn },
    });
    res.status(500).json({ ok: false, data: null, error: 'rpc_failed' });
  }
}
