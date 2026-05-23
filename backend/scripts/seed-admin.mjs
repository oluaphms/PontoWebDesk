/**
 * Cria usuário admin inicial no PostgreSQL (Hostinger / VPS).
 * Compatível com schema mínimo (backend/db/schema.sql) e schema completo (db:migrate:full).
 *
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

async function tableHasColumn(client, table, column) {
  const r = await client.query(
    `select 1 from information_schema.columns
     where table_schema = 'public' and table_name = $1 and column_name = $2 limit 1`,
    [table, column],
  );
  return (r.rowCount ?? 0) > 0;
}

async function authUsersExists(client) {
  const r = await client.query(
    `select 1 from information_schema.tables
     where table_schema = 'auth' and table_name = 'users' limit 1`,
  );
  return (r.rowCount ?? 0) > 0;
}

try {
  const hash = await bcrypt.hash(password, 10);
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const hasNome = await tableHasColumn(client, 'users', 'nome');
    const hasPasswordHash = await tableHasColumn(client, 'users', 'password_hash');
    const useAuthUsers = await authUsersExists(client);

    const existing = await client.query(
      'select id from users where lower(email) = $1 limit 1',
      [email],
    );

    if (existing.rowCount > 0) {
      const userId = existing.rows[0].id;
      if (hasPasswordHash) {
        await client.query(
          'update users set password_hash = $1, company_id = $2, role = $3 where id = $4',
          [hash, companyId, role, userId],
        );
      } else {
        await client.query(
          'update users set company_id = $1, role = $2 where id = $3',
          [companyId, role, userId],
        );
        console.warn('[seed-admin] Tabela users sem password_hash — rode db:migrate:full ou 003_api_local_auth.sql');
      }
      if (hasNome) {
        await client.query(
          `update users set nome = coalesce(nullif(trim(nome), ''), $1) where id = $2`,
          ['Administrador', userId],
        );
      }
      console.log('[seed-admin] Senha/perfil atualizados para', email);
    } else if (hasNome && useAuthUsers) {
      const authInsert = await client.query(
        'insert into auth.users (email) values ($1) returning id',
        [email],
      );
      const userId = authInsert.rows[0].id;
      const cols = ['id', 'nome', 'email', 'company_id', 'role'];
      const vals = [userId, 'Administrador', email, companyId, role];
      if (hasPasswordHash) {
        cols.push('password_hash');
        vals.push(hash);
      }
      const placeholders = vals.map((_, i) => `$${i + 1}`).join(', ');
      await client.query(
        `insert into users (${cols.join(', ')}) values (${placeholders})`,
        vals,
      );
      console.log('[seed-admin] Usuário criado (schema Supabase):', email);
    } else {
      if (hasPasswordHash) {
        await client.query(
          `insert into users (email, password_hash, company_id, role)
           values ($1, $2, $3, $4)`,
          [email, hash, companyId, role],
        );
      } else {
        await client.query(
          `insert into users (email, company_id, role) values ($1, $2, $3)`,
          [email, companyId, role],
        );
      }
      console.log('[seed-admin] Usuário criado (schema mínimo):', email);
    }

    await client.query('COMMIT');
    console.log('[seed-admin] company_id:', companyId, '| role:', role);
    console.log('[seed-admin] Use estas credenciais no login (API local).');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
} catch (err) {
  console.error('[seed-admin] Falhou:', err);
  process.exit(1);
} finally {
  await pool.end();
}
