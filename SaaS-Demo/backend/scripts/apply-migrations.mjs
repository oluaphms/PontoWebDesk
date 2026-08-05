import { observabilityConsole } from '../../services/observabilityConsole.js';
/**
 * Aplica arquivos SQL em backend/db/migrations/ em ordem.
 * Uso: cd backend && node scripts/apply-migrations.mjs
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
  observabilityConsole.error('[apply-migrations] Defina DATABASE_URL em backend/.env');
  process.exit(1);
}

const ssl =
  process.env.DATABASE_SSL === 'true' || process.env.DATABASE_SSL === '1'
    ? { rejectUnauthorized: false }
    : undefined;

const migrationsDir = path.join(__dirname, '..', 'db', 'migrations');
const files = fs
  .readdirSync(migrationsDir)
  .filter((f) => f.endsWith('.sql'))
  .sort();

const pool = new pg.Pool({ connectionString, ssl });

try {
  for (const file of files) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    observabilityConsole.log('[apply-migrations]', file);
    await pool.query(sql);
  }
  observabilityConsole.log('[apply-migrations] OK —', files.length, 'arquivo(s)');
} catch (err) {
  observabilityConsole.error('[apply-migrations] Falhou:', err);
  process.exit(1);
} finally {
  await pool.end();
}
