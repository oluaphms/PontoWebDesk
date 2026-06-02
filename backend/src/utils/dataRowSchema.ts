import { observabilityConsole } from '../logger/observabilityConsole.js';
import { pool } from '../db/index.js';
import { tableHasTenantScope } from './dataTablePolicy.js';
import { encryptSecret } from '../security/encrypt.js';

type ColumnMeta = {
  name: string;
  dataType: string;
  isGenerated: boolean;
  isIdentity: boolean;
};

export class DataRowValidationError extends Error {
  code: string;
  details: Record<string, unknown>;

  constructor(message: string, code: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'DataRowValidationError';
    this.code = code;
    this.details = details;
  }
}

const TABLE_COLUMNS_CACHE_TTL_MS = Math.max(1000, Number(process.env.TABLE_COLUMNS_CACHE_TTL_MS) || 60_000);
const tableColumnsCache = new Map<string, { columns: ColumnMeta[]; loadedAt: number }>();

const SENSITIVE_COLUMN_EXACT = new Set([
  'password',
  'password_hash',
  'senha',
  'pin',
  'pin_hash',
  'api_key',
  'apikey',
  'secret',
  'service_key',
  'service_role_key',
  'client_secret',
  'access_token',
  'refresh_token',
  'auth_token',
  'token',
  'jwt',
  'session_key',
  'private_key',
  'credential',
  'credentials',
]);

const SENSITIVE_COLUMN_FRAGMENT = /(^|_)(password|senha|secret|token|api_key|apikey|jwt|session_key|service_key|service_role_key|private_key|credential|credentials|pin_hash)(_|$)/i;

export function isSensitiveColumnName(column: string): boolean {
  const normalized = String(column || '').trim().toLowerCase();
  if (!normalized) return true;
  return SENSITIVE_COLUMN_EXACT.has(normalized) || SENSITIVE_COLUMN_FRAGMENT.test(normalized);
}

export async function tableHasColumn(table: string, column: string): Promise<boolean> {
  const cols = await loadTableColumns(table);
  return cols.some((c) => c.name === column);
}

async function tableHasWritableColumn(table: string, column: string): Promise<boolean> {
  const cols = await loadTableColumns(table);
  return cols.some((c) => c.name === column && !c.isGenerated && !c.isIdentity);
}

function encryptedColumnTriplet(column: string): {
  encrypted: string;
  iv: string;
  tag: string;
} {
  return {
    encrypted: `${column}_encrypted`,
    iv: `${column}_iv`,
    tag: `${column}_tag`,
  };
}

async function tableHasEncryptedTriplet(table: string, column: string): Promise<boolean> {
  const triplet = encryptedColumnTriplet(column);
  const cols: ColumnMeta[] = await loadTableColumns(table);
  const names = new Set(cols.filter((c: ColumnMeta) => !c.isGenerated && !c.isIdentity).map((c: ColumnMeta) => c.name));
  return names.has(triplet.encrypted) && names.has(triplet.iv) && names.has(triplet.tag);
}

export async function getTableColumnTypes(table: string): Promise<Map<string, string>> {
  const columns = await loadTableColumns(table);
  return new Map(columns.map((c) => [c.name, c.dataType]));
}

export async function getReadableTableColumns(table: string): Promise<string[]> {
  const columns = await loadTableColumns(table);
  return columns
    .map((c) => c.name)
    .filter((name) => !isSensitiveColumnName(name));
}

const PG_ARRAY_UDT_CASTS = new Map<string, string>([
  ['_bool', 'boolean[]'],
  ['_int2', 'smallint[]'],
  ['_int4', 'integer[]'],
  ['_int8', 'bigint[]'],
  ['_float4', 'real[]'],
  ['_float8', 'double precision[]'],
  ['_numeric', 'numeric[]'],
  ['_uuid', 'uuid[]'],
  ['_text', 'text[]'],
  ['_varchar', 'text[]'],
  ['_bpchar', 'text[]'],
  ['_date', 'date[]'],
  ['_timestamp', 'timestamp[]'],
  ['_timestamptz', 'timestamptz[]'],
  ['_time', 'time[]'],
  ['_json', 'json[]'],
  ['_jsonb', 'jsonb[]'],
]);

export function normalizePgColumnType(dataType: string, udtName?: string | null): string {
  const type = String(dataType || '').trim();
  const udt = String(udtName || '').trim();
  if (type === 'ARRAY') return PG_ARRAY_UDT_CASTS.get(udt) ?? `${udt.replace(/^_/, '') || 'text'}[]`;
  return type;
}

/** Sufixo PG para cast explícito — evita "could not determine data type of parameter $N" com NULL. */
function pgCastSuffix(dataType: string): string {
  const normalized = String(dataType || '').trim();
  if (/^[a-z_][a-z0-9_ ]*(\[\])$/i.test(normalized)) return normalized;
  switch (normalized) {
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
    case 'timestamptz':
      return 'timestamptz';
    case 'timestamp':
      return 'timestamp';
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
  if (await tableHasWritableColumn(table, 'company_id')) next.company_id = companyId;
  // tenant_id pode existir como generated/computed; nunca force escrita nele via API genérica.
  delete next.tenant_id;
  delete next.tenantId;
  return next;
}

async function loadTableColumns(table: string): Promise<ColumnMeta[]> {
  const cached = tableColumnsCache.get(table);
  if (cached && Date.now() - cached.loadedAt < TABLE_COLUMNS_CACHE_TTL_MS) return cached.columns;
  const result = await pool.query<{
    column_name: string;
    data_type: string;
    udt_name: string;
    is_generated: string;
    is_identity: string;
  }>(
    `SELECT column_name, data_type, udt_name, is_generated, is_identity
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1`,
    [table],
  );
  const cols = result.rows.map((r) => ({
    name: r.column_name,
    dataType: normalizePgColumnType(r.data_type, r.udt_name),
    isGenerated: r.is_generated !== 'NEVER',
    isIdentity: r.is_identity === 'YES',
  }));
  tableColumnsCache.set(table, { columns: cols, loadedAt: Date.now() });
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

export function coerceArrayValue(column: string, dataType: string, value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (!Array.isArray(value)) {
    throw new DataRowValidationError(
      `Campo ${column} deve ser enviado como array para a coluna ${dataType}.`,
      'DATA_INVALID_ARRAY_PAYLOAD',
      { column, expectedType: dataType, receivedType: typeof value },
    );
  }
  if (dataType === 'integer[]' || dataType === 'smallint[]' || dataType === 'bigint[]') {
    return value.map((item, index) => {
      const n = Number(item);
      if (!Number.isInteger(n)) {
        throw new DataRowValidationError(
          `Campo ${column} contém valor inválido na posição ${index}.`,
          'DATA_INVALID_INTEGER_ARRAY_ITEM',
          { column, expectedType: dataType, index, value: item },
        );
      }
      return n;
    });
  }
  return value;
}

/** Remove colunas inexistentes e ajusta tipos (ex.: string → jsonb). */
export async function filterRowToTableSchema(
  table: string,
  row: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const columns = await loadTableColumns(table);
  if (!columns.length) {
    observabilityConsole.error('[dataRowSchema] no columns found for table', table);
    return {};
  }

  const byName = new Map(columns.map((c) => [c.name, c.dataType]));
  const out: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(row)) {
    if (isSensitiveColumnName(key)) {
      if (value == null || value === '') continue;
      if (await tableHasEncryptedTriplet(table, key)) {
        const triplet = encryptedColumnTriplet(key);
        const encrypted = encryptSecret(coerceTextValue(value) as string);
        out[triplet.encrypted] = encrypted.encrypted;
        out[triplet.iv] = encrypted.iv;
        out[triplet.tag] = encrypted.tag;
      }
      continue;
    }
    const column = columns.find((c) => c.name === key);
    if (!column || column.isGenerated || column.isIdentity) continue;
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
    if (dataType === 'ARRAY' || dataType.endsWith('[]')) {
      out[key] = coerceArrayValue(key, dataType, value);
      continue;
    }
    out[key] = value;
  }

  return out;
}

export function clearTableColumnsCache(): void {
  tableColumnsCache.clear();
}
