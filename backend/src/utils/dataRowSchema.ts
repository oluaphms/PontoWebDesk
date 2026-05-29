import { pool } from '../db/index.js';
import { tableHasTenantScope } from './dataTablePolicy.js';

type ColumnMeta = { name: string; dataType: string };

const tableColumnsCache = new Map<string, ColumnMeta[]>();

export async function tableHasColumn(table: string, column: string): Promise<boolean> {
  const cols = await loadTableColumns(table);
  return cols.some((c) => c.name === column);
}

export async function getTableColumnTypes(table: string): Promise<Map<string, string>> {
  const columns = await loadTableColumns(table);
  return new Map(columns.map((c) => [c.name, c.dataType]));
}

/** Sufixo PG para cast explícito — evita "could not determine data type of parameter $N" com NULL. */
function pgCastSuffix(dataType: string): string {
  switch (dataType) {
    case 'jsonb':
      return 'jsonb';
    case 'json':
      return 'json';
    case 'boolean':
      return 'boolean';
    case 'integer':
      return 'integer';
    case 'bigint':
      return 'bigint';
    case 'smallint':
      return 'smallint';
    case 'double precision':
      return 'double precision';
    case 'real':
      return 'real';
    case 'numeric':
      return 'numeric';
    case 'uuid':
      return 'uuid';
    case 'timestamp with time zone':
      return 'timestamptz';
    case 'timestamp without time zone':
      return 'timestamp';
    case 'date':
      return 'date';
    case 'time without time zone':
      return 'time';
    case 'text':
    case 'character varying':
    case 'character':
      return 'text';
    default:
      return 'text';
  }
}

export function sqlParamRef(paramIndex: number, dataType: string): string {
  return `$${paramIndex}::${pgCastSuffix(dataType)}`;
}

/** WHERE tenant: só colunas que existem na tabela (evita erro em rep_devices sem tenant_id). */
export async function tenantScopeSqlForTable(
  table: string,
  paramIndex: number,
): Promise<string | null> {
  const hasCompany = await tableHasColumn(table, 'company_id');
  const hasTenant = await tableHasColumn(table, 'tenant_id');
  const p = sqlParamRef(paramIndex, 'text');
  if (hasCompany && hasTenant) {
    return `(company_id::text = ${p} OR tenant_id::text = ${p})`;
  }
  if (hasCompany) return `company_id::text = ${p}`;
  if (hasTenant) return `tenant_id::text = ${p}`;
  return null;
}

export async function applyTenantToRowAsync(
  table: string,
  row: Record<string, unknown>,
  companyId: string,
): Promise<Record<string, unknown>> {
  if (!tableHasTenantScope(table) || !companyId) return row;
  const next = { ...row };
  if (await tableHasColumn(table, 'company_id')) next.company_id = companyId;
  if (await tableHasColumn(table, 'tenant_id')) next.tenant_id = companyId;
  return next;
}

async function loadTableColumns(table: string): Promise<ColumnMeta[]> {
  const cached = tableColumnsCache.get(table);
  if (cached) return cached;
  const result = await pool.query<{ column_name: string; data_type: string }>(
    `SELECT column_name, data_type
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1`,
    [table],
  );
  const cols = result.rows.map((r) => ({
    name: r.column_name,
    dataType: r.data_type,
  }));
  tableColumnsCache.set(table, cols);
  return cols;
}

function coerceJsonbValue(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value;
  if (typeof value === 'object') return value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    try {
      return JSON.parse(trimmed);
    } catch {
      return { text: trimmed };
    }
  }
  return value;
}

function coerceTextValue(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return JSON.stringify(value);
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (typeof record.text === 'string') return record.text;
    return JSON.stringify(value);
  }
  return String(value);
}

function coerceBooleanValue(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === 'boolean') return value;
  if (value === 'true' || value === 1 || value === '1') return true;
  if (value === 'false' || value === 0 || value === '0') return false;
  return Boolean(value);
}

/** Remove colunas inexistentes e ajusta tipos (ex.: string → jsonb). */
export async function filterRowToTableSchema(
  table: string,
  row: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const columns = await loadTableColumns(table);
  if (!columns.length) {
    console.error('[dataRowSchema] no columns found for table', table);
    return {};
  }

  const byName = new Map(columns.map((c) => [c.name, c.dataType]));
  const out: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(row)) {
    const dataType = byName.get(key);
    if (!dataType) continue;
    if (value === undefined) continue;

    if (dataType === 'jsonb' || dataType === 'json') {
      out[key] = coerceJsonbValue(value);
      continue;
    }
    if (dataType === 'boolean') {
      out[key] = coerceBooleanValue(value);
      continue;
    }
    if (dataType === 'text' || dataType === 'character varying') {
      out[key] = coerceTextValue(value);
      continue;
    }
    if (
      (dataType === 'integer' || dataType === 'bigint' || dataType === 'smallint') &&
      value !== null &&
      value !== ''
    ) {
      const n = Number(value);
      out[key] = Number.isFinite(n) ? n : null;
      continue;
    }
    if ((dataType === 'ARRAY' || dataType.endsWith('[]')) && Array.isArray(value)) {
      out[key] = value;
      continue;
    }
    out[key] = value;
  }

  return out;
}

export function clearTableColumnsCache(): void {
  tableColumnsCache.clear();
}
