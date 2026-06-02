import type { Response } from 'express';
import { pool } from '../db/index.js';
import type { AuthedRequest } from '../middlewares/authMiddleware.js';
import { authUserId, isAdminOrHr, normalizeRole, requireCompanyId } from '../utils/authContext.js';
import { logAuthDenied } from '../services/authAuditService.js';
import {
  ALLOWED_TABLES,
  USER_SCOPED_TABLES,
  isTableReadable,
  isTableWritable,
  tableHasTenantScope,
} from '../utils/dataTablePolicy.js';
import {
  applyTenantToRowAsync,
  filterRowToTableSchema,
  getReadableTableColumns,
  getTableColumnTypes,
  isSensitiveColumnName,
  sqlParamRef,
  tableHasColumn,
  tenantScopeSqlForTable,
} from '../utils/dataRowSchema.js';
import { logger } from '../logger/logger.js';

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

function safeIdent(name: string): string | null {
  if (!/^[a-z_][a-z0-9_]*$/i.test(name)) return null;
  return name;
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

  if (table === 'users' && companyId && (await tableHasColumn(table, 'company_id'))) {
    parts.push(`company_id::text = ${sqlParamRef(idx, 'text')}`);
    params.push(companyId);
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

async function dataWriteScopeSql(table: string, paramIndex: number): Promise<string | null> {
  if (tableHasTenantScope(table)) return tenantScopeSqlForTable(table, paramIndex);
  if (table === 'users' && (await tableHasColumn(table, 'company_id'))) {
    return `company_id::text = ${sqlParamRef(paramIndex, 'text')}`;
  }
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
    if (table === 'time_records') {
      logger.info({
        module: 'data.controller',
        action: 'TIME_RECORDS_LIST_QUERY',
        message: 'Consulta de time_records executada',
        requestId: requestId(req) ?? undefined,
        userId: req.auth?.userId ?? req.auth?.sub ?? null,
        companyId,
        meta: {
          employeeId: authUserId(req.auth),
          filters,
          sql,
          params: [...params, limit, offset],
          returnedRows: result.rowCount ?? result.rows.length,
        },
      });
    }
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
      .map((k, i) => sqlParamRef(i + 1, colTypes.get(k) ?? 'text'))
      .join(', ');
    values = keys.map((k) => row[k]);
    const returningSql = returningColumns.length ? ` RETURNING ${returningColumns.join(', ')}` : '';
    sql = `INSERT INTO public.${table} (${cols}) VALUES (${placeholders})${returningSql}`;
    const result = await pool.query(sql, values);
    res.json({ ok: true, success: true, data: result.rows[0] ?? null });
  } catch (e) {
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
    res.status(500).json({
      ok: false,
      success: false,
      error: dbError.message,
      code: dbError.code || 'DATA_INSERT_FAILED',
      message: dbError.message,
      detail: dbError.detail,
      stack: dbError.stack,
      details: {
        table,
        reason: 'DATA_INSERT_FAILED',
        sql,
        payloadKeys: sortedKeys(raw),
        sanitizedKeys: sortedKeys(writeRaw),
        scopedKeys: sortedKeys(scoped),
        filteredKeys: keys,
        originalError: dbError,
      },
    });
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
      .map((k, i) => `${k} = ${sqlParamRef(i + 1, colTypes.get(k) ?? 'text')}`)
      .join(', ');
    const values = keys.map((k) => row[k]);

    const tenantIdx = keys.length + 1;
    const tenantScope = await dataWriteScopeSql(table, tenantIdx);
    const idIdx = keys.length + (tenantScope ? 2 : 1);
    const tenantClause = tenantScope ? ` AND ${tenantScope}` : '';
    params = [...values, ...(tenantScope ? [companyId] : []), id];

    const idCast = sqlParamRef(idIdx, 'text');
    const returningSql = returningColumns.length ? ` RETURNING ${returningColumns.join(', ')}` : '';
    sql = `UPDATE public.${table} SET ${sets} WHERE id::text = ${idCast}${tenantClause}${returningSql}`;
    const result = await pool.query(sql, params);
    if (returningSql && !result.rows[0]) {
      res.status(404).json(failureBody('not_found', 'DATA_NOT_FOUND', { table }));
      return;
    }
    res.json({ ok: true, success: true, data: result.rows[0] ?? null });
  } catch (e) {
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
    res.status(500).json({
      ok: false,
      success: false,
      error: dbError.message,
      code: dbError.code || 'DATA_UPDATE_FAILED',
      message: dbError.message,
      detail: dbError.detail,
      stack: dbError.stack,
      details: {
        table,
        id,
        reason: 'DATA_UPDATE_FAILED',
        sql,
        payloadKeys: sortedKeys(raw),
        sanitizedKeys: sortedKeys(writeRaw),
        scopedKeys: sortedKeys(scoped),
        filteredKeys: keys,
        originalError: dbError,
      },
    });
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
    const tenantScope = await dataWriteScopeSql(table, 2);
    const tenantClause = tenantScope ? ` AND ${tenantScope}` : '';
    const params = tenantScope ? [id, companyId] : [id];
    const result = await pool.query(
      `DELETE FROM public.${table} WHERE id::text = ${sqlParamRef(1, 'text')}${tenantClause} RETURNING id`,
      params,
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
    if (table === 'time_records') {
      logger.info({
        module: 'data.controller',
        action: 'TIME_RECORDS_COUNT_QUERY',
        message: 'Contagem de time_records executada',
        requestId: requestId(req) ?? undefined,
        userId: req.auth?.userId ?? req.auth?.sub ?? null,
        companyId,
        meta: {
          employeeId: authUserId(req.auth),
          filters,
          sql,
          params,
          returnedRows: result.rows[0]?.c ?? 0,
        },
      });
    }
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
  'rep_register_punch',
  'rep_ingest_punch',
]);

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

  const role = normalizeRole(req.auth?.role);
  if (fn === 'insert_time_record_for_user' && role !== 'admin' && role !== 'hr') {
    const targetUser = String(args.user_id ?? args.p_user_id ?? '').trim();
    const selfId = String(req.auth?.sub || '').trim();
    if (targetUser && targetUser !== selfId) {
      res.status(403).json({ ok: false, error: 'forbidden', data: null });
      return;
    }
    args.user_id = selfId;
    args.company_id = companyId;
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
