import { pool } from './index.js';

type Queryable = Pick<typeof pool, 'query'>;

const COLUMN_CACHE = new Map<string, boolean>();

export async function tableHasColumn(
  tableName: string,
  columnName: string,
  db: Queryable = pool,
  schemaName = 'public',
): Promise<boolean> {
  const schema = schemaName.toLowerCase();
  const table = tableName.toLowerCase();
  const column = columnName.toLowerCase();
  const key = `${schema}.${table}.${column}`;
  if (COLUMN_CACHE.has(key)) return COLUMN_CACHE.get(key)!;

  const result = await db.query(
    `select 1 from information_schema.columns
     where table_schema = $1 and table_name = $2 and column_name = $3
     limit 1`,
    [schema, table, column],
  );
  const ok = (result.rowCount ?? 0) > 0;
  COLUMN_CACHE.set(key, ok);
  return ok;
}
