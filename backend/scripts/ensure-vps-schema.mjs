import { observabilityConsole } from '../../services/observabilityConsole.js';
/**
 * Garante schema mínimo na VPS (companies + rep_devices). Idempotente.
 * Uso: cd backend && npm run db:ensure-vps
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
  observabilityConsole.error('[db:ensure-vps] Defina DATABASE_URL em backend/.env');
  process.exit(1);
}

const ssl =
  process.env.DATABASE_SSL === 'true' || process.env.DATABASE_SSL === '1'
    ? { rejectUnauthorized: false }
    : undefined;

const sqlFiles = ['ensure_companies.sql', 'ensure_rep_devices.sql'];

const pool = new pg.Pool({ connectionString, ssl });

async function runFile(name: string): Promise<void> {
  const sqlPath = path.join(__dirname, '..', 'db', 'vps', name);
  const sql = fs.readFileSync(sqlPath, 'utf8');
  observabilityConsole.log('[db:ensure-vps] aplicando', name);
  await pool.query(sql);
}

try {
  for (const file of sqlFiles) {
    await runFile(file);
  }

  for (const table of ['companies', 'rep_devices']) {
    const check = await pool.query(
      `SELECT count(*)::int AS c FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = $1`,
      [table],
    );
    observabilityConsole.log('[db:ensure-vps] OK —', table, '→', check.rows[0]?.c ?? 0, 'colunas');
  }
} catch (e) {
  observabilityConsole.error('[db:ensure-vps] Falhou:', e instanceof Error ? e.message : e);
  process.exit(1);
} finally {
  await pool.end();
}
