/**
 * Cria usuário admin inicial no PostgreSQL (Hostinger).
 * Uso: cd backend && node scripts/seed-admin.mjs
 */
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('[seed-admin] Defina DATABASE_URL em backend/.env');
  process.exit(1);
}

const email = (process.env.SEED_ADMIN_EMAIL || 'admin@local.test').trim().toLowerCase();
const password = process.env.SEED_ADMIN_PASSWORD || '123456';
const companyId = process.env.SEED_COMPANY_ID || 'demo-company';
const role = process.env.SEED_ADMIN_ROLE || 'admin';

const ssl =
  process.env.DATABASE_SSL === 'true' || process.env.DATABASE_SSL === '1'
    ? { rejectUnauthorized: false }
    : undefined;

const pool = new pg.Pool({ connectionString, ssl });

try {
  const hash = await bcrypt.hash(password, 10);
  const existing = await pool.query('select id from users where lower(email) = $1 limit 1', [email]);
  if (existing.rowCount > 0) {
    await pool.query(
      'update users set password_hash = $1, company_id = $2, role = $3 where lower(email) = $4',
      [hash, companyId, role, email],
    );
    console.log('[seed-admin] Senha atualizada para', email);
  } else {
    await pool.query(
      `insert into users (email, password_hash, company_id, role)
       values ($1, $2, $3, $4)`,
      [email, hash, companyId, role],
    );
    console.log('[seed-admin] Usuário criado:', email);
  }
  console.log('[seed-admin] company_id:', companyId, '| role:', role);
  console.log('[seed-admin] Use estas credenciais no login (API local).');
} catch (err) {
  console.error('[seed-admin] Falhou:', err);
  process.exit(1);
} finally {
  await pool.end();
}
