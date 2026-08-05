import { observabilityConsole } from '../../services/observabilityConsole.js';
/**
 * Garante schema mínimo de rep_devices na VPS (idempotente).
 * Uso: cd backend && npm run db:ensure-rep
 */
import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  observabilityConsole.error('[db:ensure-rep] Defina DATABASE_URL em backend/.env');
  process.exit(1);
}

const ssl =
  process.env.DATABASE_SSL === 'true' || process.env.DATABASE_SSL === '1'
    ? { rejectUnauthorized: false }
    : undefined;

const sqlPath = path.join(__dirname, '..', 'db', 'vps', 'ensure_rep_devices.sql');
const sql = fs.readFileSync(sqlPath, 'utf8');

const pool = new pg.Pool({ connectionString, ssl });

try {
  await pool.query(sql);
  const check = await pool.query(`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'rep_devices'
    ORDER BY ordinal_position
  `);
  observabilityConsole.log('[db:ensure-rep] OK — rep_devices com', check.rows.length, 'colunas');
  for (const row of check.rows) {
    observabilityConsole.log('  -', row.column_name, '(' + row.data_type + ')');
  }
} catch (e) {
  observabilityConsole.error('[db:ensure-rep] Falhou:', e instanceof Error ? e.message : e);
  process.exit(1);
} finally {
  await pool.end();
}
