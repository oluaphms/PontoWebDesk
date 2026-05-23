import type { Response } from 'express';
import { pool } from '../db/index.js';
import type { AuthedRequest } from '../middlewares/authMiddleware.js';

const ALLOWED_TABLES = new Set([
  'companies',
  'users',
  'employees',
  'departments',
  'time_records',
  'punches',
  'absences',
  'ausencias',
  'employee_absences',
  'events',
  'work_shifts',
  'schedules',
  'requests',
  'notifications',
  'settings',
  'global_settings',
  'feriados',
  'justificativas',
  'eventos_folha',
  'lancamento_eventos',
  'job_titles',
  'cidades',
  'estados_civis',
  'motivo_demissao',
  'estruturas',
  'estrutura_responsaveis',
  'colaborador_jornada',
  'escala_mensal',
  'cartao_ponto_dia',
  'rep_devices',
  'rep_punch_logs',
  'bank_hours',
  'bank_hours_ledger',
  'time_balance',
  'work_locations',
  'trusted_devices',
  'user_schedules',
  'employee_shift_schedule',
  'projects',
  'project_members',
  'project_tasks',
  'teams',
  'alerts',
  'fraud_alerts',
  'activity_sessions',
  'productivity_logs',
  'time_logs',
  'activity_logs',
  'company_rules',
  'overtime_rules',
  'folha_pagamento_periodos',
  'folha_pagamento_itens',
  'punch_interpretations',
  'time_adjustments_history',
  'tenant_audit_log',
  'audit_logs',
  'punch_risk_analysis',
  'rep_logs',
  'rep_unresolved_punches',
  'timesheets',
  'timesheet_daily_snapshots',
  'employee_invites',
  'devices',
  'clock_event_logs',
]);

const ALLOWED_OPS = new Set(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike', 'in', 'is']);

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

function buildWhere(
  table: string,
  filters: FilterInput[],
  companyId: string,
): { clause: string; params: unknown[] } {
  const parts: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  const tenantTables = new Set([
    'users',
    'employees',
    'departments',
    'time_records',
    'punches',
    'work_shifts',
    'schedules',
    'requests',
    'settings',
    'feriados',
    'justificativas',
    'eventos_folha',
    'lancamento_eventos',
    'job_titles',
    'cidades',
    'estados_civis',
    'motivo_demissao',
    'estruturas',
    'colaborador_jornada',
    'escala_mensal',
    'cartao_ponto_dia',
    'rep_devices',
    'rep_punch_logs',
    'bank_hours',
    'bank_hours_ledger',
    'time_balance',
    'work_locations',
    'trusted_devices',
    'employee_shift_schedule',
    'projects',
    'project_members',
    'project_tasks',
    'teams',
    'alerts',
    'fraud_alerts',
    'activity_sessions',
    'productivity_logs',
    'time_logs',
    'activity_logs',
    'company_rules',
    'overtime_rules',
    'folha_pagamento_periodos',
    'folha_pagamento_itens',
    'punch_interpretations',
    'time_adjustments_history',
    'tenant_audit_log',
    'audit_logs',
    'estrutura_responsaveis',
    'employee_absences',
    'punch_risk_analysis',
    'rep_logs',
    'rep_unresolved_punches',
    'timesheets',
    'employee_invites',
    'clock_event_logs',
  ]);

  if (tenantTables.has(table) && companyId) {
    const hasCompanyFilter = filters.some(
      (f) => f.column === 'company_id' || f.column === 'tenant_id',
    );
    if (!hasCompanyFilter) {
      parts.push(`(company_id = $${idx} OR tenant_id = $${idx})`);
      params.push(companyId);
      idx += 1;
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

export async function listDataController(req: AuthedRequest, res: Response): Promise<void> {
  const table = safeIdent(String(req.params.table || ''));
  if (!table || !ALLOWED_TABLES.has(table)) {
    res.status(400).json({ ok: false, error: 'table_not_allowed' });
    return;
  }

  const companyId = String(req.auth?.companyId || '').trim();
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
  const orderCol = safeIdent(String(req.query.orderColumn || 'created_at'));
  const orderAsc = req.query.orderAsc !== 'false';

  const { clause, params } = buildWhere(table, filters, companyId);
  const order = orderCol ? `ORDER BY ${orderCol} ${orderAsc ? 'ASC' : 'DESC'}` : '';

  try {
    const sql = `SELECT ${columns === '*' ? '*' : columns} FROM public.${table} ${clause} ${order} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    const result = await pool.query(sql, [...params, limit, offset]);
    res.json({ ok: true, data: result.rows });
  } catch (e) {
    console.error('[DATA LIST]', table, e);
    res.status(500).json({ ok: false, error: 'query_failed' });
  }
}

export async function insertDataController(req: AuthedRequest, res: Response): Promise<void> {
  const table = safeIdent(String(req.params.table || ''));
  if (!table || !ALLOWED_TABLES.has(table)) {
    res.status(400).json({ ok: false, error: 'table_not_allowed' });
    return;
  }
  const row = req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {};
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
    console.error('[DATA INSERT]', table, e);
    res.status(500).json({ ok: false, error: 'insert_failed' });
  }
}

export async function updateDataController(req: AuthedRequest, res: Response): Promise<void> {
  const table = safeIdent(String(req.params.table || ''));
  const id = String(req.params.id || '');
  if (!table || !ALLOWED_TABLES.has(table) || !id) {
    res.status(400).json({ ok: false, error: 'invalid_request' });
    return;
  }
  const row = req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {};
  const keys = Object.keys(row).filter((k) => safeIdent(k) && k !== 'id');
  if (!keys.length) {
    res.status(400).json({ ok: false, error: 'empty_payload' });
    return;
  }
  const sets = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
  const values = keys.map((k) => row[k]);
  try {
    const sql = `UPDATE public.${table} SET ${sets} WHERE id = $${keys.length + 1} RETURNING *`;
    const result = await pool.query(sql, [...values, id]);
    res.json({ ok: true, data: result.rows[0] });
  } catch (e) {
    console.error('[DATA UPDATE]', table, e);
    res.status(500).json({ ok: false, error: 'update_failed' });
  }
}

export async function deleteDataController(req: AuthedRequest, res: Response): Promise<void> {
  const table = safeIdent(String(req.params.table || ''));
  const id = String(req.params.id || '');
  if (!table || !ALLOWED_TABLES.has(table) || !id) {
    res.status(400).json({ ok: false, error: 'invalid_request' });
    return;
  }
  try {
    await pool.query(`DELETE FROM public.${table} WHERE id = $1`, [id]);
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
  const companyId = String(req.auth?.companyId || '').trim();
  const filters = parseFilters(typeof req.query.filters === 'string' ? req.query.filters : undefined);
  const { clause, params } = buildWhere(table, filters, companyId);
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
  const args = req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {};
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
