import { Pool } from 'pg';

const connectionString = process.env.DATABASE_URL;

const sslEnabled =
  process.env.DATABASE_SSL === 'true' ||
  process.env.DATABASE_SSL === '1' ||
  process.env.PGSSLMODE === 'require';

export const pool = new Pool({
  connectionString,
  ssl: sslEnabled ? { rejectUnauthorized: false } : undefined,
  max: Number(process.env.PG_POOL_MAX || 10),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

export async function checkDatabaseConnection(): Promise<boolean> {
  if (!connectionString) return false;
  try {
    const client = await pool.connect();
    try {
      await client.query('select 1 as ok');
      return true;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('[DB] conexão falhou:', err);
    return false;
  }
}
