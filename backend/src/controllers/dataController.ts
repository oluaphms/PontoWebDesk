import type { Response } from 'express';
import { pool } from '../db/index.js';
import type { AuthedRequest } from '../middlewares/authMiddleware.js';
import { normalizeRole, requireCompanyId } from '../utils/authContext.js';
import { logAuthDenied } from '../services/authAuditService.js';
import {
  ALLOWED_TABLES,
  isTableReadable,
  isTableWritable,
  tableHasTenantScope,
} from '../utils/dataTablePolicy.js';
import {
  applyTenantToRowAsync,
  filterRowToTableSchema,
  tableHasColumn,
  tenantScopeSqlForTable,
} from '../utils/dataRowSchema.js';

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
): Promise<{ clause: string; params: unknown[] }> {
  const parts: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (tableHasTenantScope(table) && companyId) {
    const hasCompanyFilter = filters.some(
      (f) => f.column === 'company_id' || f.column === 'tenant_id',
    );
    if (!hasCompanyFilter) {
      const tenantClause = await tenantScopeSqlForTable(table, idx);
      if (tenantClause) {
        parts.push(tenantClause);
        params.push(companyId);
        idx += 1;
      }
    }
  }

  for (const f of filters) {
    const col = safeIdent(f.column);
    const op = ALLOWED_OPS.has(f.operator) ? f.operator : 'eq';
    if (!col) continue;

    if (op === 'in') {
      const arr = Array.isArray(f.value) ? f.value : [f.value];
      parts.push(`${col} = ANY($${idx}::text[])`);
      params.push(arr.map(String));
      idx += 1;
      continue;
    }
    if (op === 'is') {
      parts.push(`${col} IS ${f.value === null ? 'NULL' : `$${idx}`}`);
      if (f.value !== null) params.push(f.value);
      idx += 1;
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

export async function listDataController(req: AuthedRequest, res: Response): Promise<void> {
  const table = safeIdent(String(req.params.table || ''));
  if (!table || !ALLOWED_TABLES.has(table)) {
    res.status(400).json({ ok: false, error: 'table_not_allowed' });
    return;
  }
  if (denyTableAccess(req, res, table, 'read')) return;

  const companyId = requireCompanyId(req, res);
  if (companyId === null) return;

  const filters = parseFilters(typeof req.query.filters === 'string' ? req.query.filters : undefined);
  const rawCols = String(req.query.columns || '*').trim();
  const columns =
    rawCols === '*'
      ? '*'
      : rawCols
          .split(',')
          .map((c) => safeIdent(c.trim()))
          .filter(Boolean)
          .join(', ') || '*';
  const limit = Math.min(2000, Math.max(1, Number(req.query.limit) || 200));
  const offset = Math.max(0, Number(req.query.offset) || 0);
  const requestedOrder = safeIdent(String(req.query.orderColumn || ''));
  let orderCol = requestedOrder;
  if (!orderCol) {
    if (await tableHasColumn(table, 'created_at')) orderCol = 'created_at';
    else if (await tableHasColumn(table, 'id')) orderCol = 'id';
    else orderCol = null;
  }
  const orderAsc = req.query.orderAsc !== 'false';

  const { clause, params } = await buildWhere(table, filters, companyId);
  const order = orderCol ? `ORDER BY ${orderCol} ${orderAsc ? 'ASC' : 'DESC'}` : '';

  try {
    const sql = `SELECT ${columns === '*' ? '*' : columns} FROM public.${table} ${clause} ${order} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    const result = await pool.query(sql, [...params, limit, offset]);
    res.json({ ok: true, data: result.rows });
  } catch (e) {
    const pgMsg = e instanceof Error ? e.message : String(e);
    console.error('[DATA LIST]', table, pgMsg, e);
    res.status(500).json({ ok: false, error: 'query_failed', message: pgMsg });
  }
}

export async function insertDataController(req: AuthedRequest, res: Response): Promise<void> {
  const table = safeIdent(String(req.params.table || ''));
  if (!table || !ALLOWED_TABLES.has(table)) {
    res.status(400).json({ ok: false, error: 'table_not_allowed' });
    return;
  }
  if (denyTableAccess(req, res, table, 'write')) return;

  const companyId = requireCompanyId(req, res);
  if (companyId === null) return;

  const raw = req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {};
  const scoped = await applyTenantToRowAsync(table, raw, companyId);
  const row = await filterRowToTableSchema(table, scoped);
  const keys = Object.keys(row).filter((k) => safeIdent(k));
  if (!keys.length) {
    res.status(400).json({ ok: false, error: 'empty_payload' });
    return;
  }
  const cols = keys.join(', ');
  const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
  const values = keys.map((k) => row[k]);
  try {
    const sql = `INSERT INTO public.${table} (${cols}) VALUES (${placeholders}) RETURNING *`;
    const result = await pool.query(sql, values);
    res.json({ ok: true, data: result.rows[0] });
  } catch (e) {
    const pgMsg = e instanceof Error ? e.message : String(e);
    console.error('[DATA INSERT]', table, pgMsg, e);
    res.status(500).json({ ok: false, error: 'insert_failed', message: pgMsg });
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

  const companyId = requireCompanyId(req, res);
  if (companyId === null) return;

  const raw = req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {};
  const scoped = await applyTenantToRowAsync(table, raw, companyId);
  const row = await filterRowToTableSchema(table, scoped);
  const keys = Object.keys(row).filter((k) => safeIdent(k) && k !== 'id');
  if (!keys.length) {
    res.status(400).json({ ok: false, error: 'empty_payload' });
    return;
  }
  const sets = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
  const values = keys.map((k) => row[k]);

  const tenantIdx = keys.length + 1;
  const idIdx = keys.length + 2;
  const tenantScope =
    tableHasTenantScope(table) ? await tenantScopeSqlForTable(table, tenantIdx) : null;
  const tenantClause = tenantScope ? ` AND ${tenantScope}` : '';
  const params = [...values, ...(tenantScope ? [companyId] : []), id];

  try {
    const sql = `UPDATE public.${table} SET ${sets} WHERE id::text = $${idIdx}${tenantClause} RETURNING *`;
    const result = await pool.query(sql, params);
    if (!result.rows[0]) {
      res.status(404).json({ ok: false, error: 'not_found' });
      return;
    }
    res.json({ ok: true, data: result.rows[0] });
  } catch (e) {
    const pgMsg = e instanceof Error ? e.message : String(e);
    console.error('[DATA UPDATE]', table, pgMsg, e);
    res.status(500).json({ ok: false, error: 'update_failed', message: pgMsg });
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

  const companyId = requireCompanyId(req, res);
  if (companyId === null) return;

  try {
    const tenantScope =
      tableHasTenantScope(table) ? await tenantScopeSqlForTable(table, 2) : null;
    const tenantClause = tenantScope ? ` AND ${tenantScope}` : '';
    const params = tenantScope ? [id, companyId] : [id];
    const result = await pool.query(
      `DELETE FROM public.${table} WHERE id = $1${tenantClause} RETURNING id`,
      params,
    );
    if (!result.rows[0]) {
      res.status(404).json({ ok: false, error: 'not_found' });
      return;
    }
    res.json({ ok: true });
  } catch (e) {
    console.error('[DATA DELETE]', table, e);
    res.status(500).json({ ok: false, error: 'delete_failed' });
  }
}

export async function countDataController(req: AuthedRequest, res: Response): Promise<void> {
  const table = safeIdent(String(req.params.table || ''));
  if (!table || !ALLOWED_TABLES.has(table)) {
    res.status(400).json({ ok: false, error: 'table_not_allowed' });
    return;
  }
  if (denyTableAccess(req, res, table, 'read')) return;

  const companyId = requireCompanyId(req, res);
  if (companyId === null) return;

  const filters = parseFilters(typeof req.query.filters === 'string' ? req.query.filters : undefined);
  const { clause, params } = await buildWhere(table, filters, companyId);
  try {
    const sql = `SELECT count(*)::int AS c FROM public.${table} ${clause}`;
    const result = await pool.query(sql, params);
    res.json({ ok: true, count: result.rows[0]?.c ?? 0 });
  } catch (e) {
    console.error('[DATA COUNT]', table, e);
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
    console.error('[DATA RPC]', fn, e);
    res.status(500).json({ ok: false, data: null, error: 'rpc_failed' });
  }
}
