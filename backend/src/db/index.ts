import '../loadEnv.js';
import { Pool } from 'pg';
import { buildPgPoolConfig } from './pgConfig.js';

const pgConfig = buildPgPoolConfig();
const hasDbTarget = Boolean(
  pgConfig.connectionString ||
    (pgConfig.host && pgConfig.user && pgConfig.database),
);

export const pool = new Pool(pgConfig);

export async function checkDatabaseConnection(): Promise<boolean> {
  if (!hasDbTarget) return false;
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
