import { observabilityConsole } from '../../services/observabilityConsole.js';
/**
 * Aplica backend/db/schema.sql no PostgreSQL (Hostinger ou local).
 * Uso: cd backend && node scripts/apply-schema.mjs
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
  observabilityConsole.error('[apply-schema] Defina DATABASE_URL em backend/.env');
  process.exit(1);
}

const ssl =
  process.env.DATABASE_SSL === 'true' || process.env.DATABASE_SSL === '1'
    ? { rejectUnauthorized: false }
    : undefined;

const schemaPath = path.join(__dirname, '..', 'db', 'schema.sql');
const sql = fs.readFileSync(schemaPath, 'utf8');

const pool = new pg.Pool({ connectionString, ssl });

try {
  await pool.query(sql);
  observabilityConsole.log('[apply-schema] OK — tabelas criadas/atualizadas em', connectionString.replace(/:[^:@/]+@/, ':***@'));
} catch (err) {
  observabilityConsole.error('[apply-schema] Falhou:', err);
  process.exit(1);
} finally {
  await pool.end();
}
