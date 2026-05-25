/**
 * Testa DATABASE_URL do backend/.env (útil na VPS após migrar do Supabase).
 * Uso: cd backend && node scripts/test-db-connection.mjs
 */
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const connectionString = process.env.DATABASE_URL?.trim();
if (!connectionString) {
  console.error('[test-db] DATABASE_URL ausente em backend/.env');
  process.exit(1);
}

/** Mascara senha na URL para log seguro */
function maskUrl(url) {
  try {
    const u = new URL(url);
    if (u.password) u.password = '***';
    return u.toString();
  } catch {
    return '(URL inválida — senha com @ sem encoding quebra o parse)';
  }
}

const ssl =
  process.env.DATABASE_SSL === 'true' || process.env.DATABASE_SSL === '1'
    ? { rejectUnauthorized: false }
    : undefined;

console.log('[test-db] Tentando:', maskUrl(connectionString));

const pool = new pg.Pool({ connectionString, ssl });

try {
  const r = await pool.query('select current_database() as db, current_user as usr');
  console.log('[test-db] OK — conectado:', r.rows[0]);
  process.exit(0);
} catch (err) {
  console.error('[test-db] FALHOU:', err.message || err);
  if (String(connectionString).includes('@') && !connectionString.includes('%40')) {
    console.error(
      '[test-db] Dica: se a senha contém "@", codifique na URL (ex.: Admin@123 → Admin%402123).',
    );
  }
  process.exit(1);
} finally {
  await pool.end();
}
