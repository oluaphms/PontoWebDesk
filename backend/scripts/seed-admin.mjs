/**
 * Cria usuário admin inicial no PostgreSQL (Hostinger / VPS).
 * Compatível com schema mínimo (backend/db/schema.sql) e schema completo (db:migrate:full).
 *
 * Uso: cd backend && node scripts/seed-admin.mjs
 */
import crypto from 'node:crypto';
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
const companyIdEnv = (process.env.SEED_COMPANY_ID || '').trim();
const role = process.env.SEED_ADMIN_ROLE || 'admin';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

async function usersCompanyIdIsUuid(client) {
  const r = await client.query(
    `select data_type from information_schema.columns
     where table_schema = 'public' and table_name = 'users' and column_name = 'company_id'
     limit 1`,
  );
  return r.rows[0]?.data_type === 'uuid';
}

async function companiesTableExists(client) {
  const r = await client.query(
    `select 1 from information_schema.tables
     where table_schema = 'public' and table_name = 'companies' limit 1`,
  );
  return (r.rowCount ?? 0) > 0;
}

/** 'uuid' | 'text' — companies.id sem DEFAULT exige valor explícito no INSERT. */
async function companiesIdKind(client) {
  const r = await client.query(
    `select data_type, udt_name from information_schema.columns
     where table_schema = 'public' and table_name = 'companies' and column_name = 'id'
     limit 1`,
  );
  const dataType = String(r.rows[0]?.data_type || '').toLowerCase();
  const udtName = String(r.rows[0]?.udt_name || '').toLowerCase();
  if (dataType === 'uuid' || udtName === 'uuid') return 'uuid';
  return 'text';
}

/** Cria empresa demo quando o schema exige company_id UUID e a tabela está vazia. */
async function createBootstrapCompany(client) {
  if (!(await companiesTableExists(client))) return null;
  if (!(await tableHasColumn(client, 'companies', 'id'))) {
    throw new Error('[seed-admin] Tabela companies sem coluna id.');
  }

  const nome = (process.env.SEED_COMPANY_NAME || 'Empresa Demo').trim();
  const slugBase = (process.env.SEED_COMPANY_SLUG || 'empresa-demo').trim();
  const slug = `${slugBase}-${Date.now().toString(36)}`;
  const idKind = await companiesIdKind(client);

  const cols = ['id'];
  const vals = [];
  const valueSql = [];

  if (idKind === 'uuid') {
    valueSql.push('gen_random_uuid()');
  } else {
    vals.push(`tnt_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`);
    valueSql.push(`$${vals.length}`);
  }

  if (await tableHasColumn(client, 'companies', 'nome')) {
    cols.push('nome');
    vals.push(nome);
    valueSql.push(`$${vals.length}`);
  }
  if (await tableHasColumn(client, 'companies', 'name')) {
    cols.push('name');
    vals.push(nome);
    valueSql.push(`$${vals.length}`);
  }
  if (await tableHasColumn(client, 'companies', 'slug')) {
    cols.push('slug');
    vals.push(slug);
    valueSql.push(`$${vals.length}`);
  }

  if (cols.length < 2) {
    throw new Error('[seed-admin] Tabela companies sem colunas reconhecidas (nome/name/slug).');
  }

  const ins = await client.query(
    `insert into companies (${cols.join(', ')}) values (${valueSql.join(', ')}) returning id::text as id`,
    vals,
  );
  const id = ins.rows[0]?.id;
  if (!id) throw new Error('[seed-admin] INSERT em companies não devolveu id.');
  console.log('[seed-admin] Empresa bootstrap criada:', id, `(${nome})`, `[id.${idKind}]`);
  return String(id).trim();
}

/** Schema completo (Supabase/VPS) usa UUID; schema mínimo aceita texto (demo-company). */
async function resolveCompanyId(client) {
  if (companyIdEnv) return companyIdEnv;

  const existing = await client.query(
    `select company_id::text as company_id from users where lower(trim(email)) = $1 limit 1`,
    [email],
  );
  const fromUser = existing.rows[0]?.company_id;
  if (fromUser && String(fromUser).trim()) {
    console.log('[seed-admin] company_id do utilizador existente:', fromUser);
    return String(fromUser).trim();
  }

  const companies = await client.query(
    `select id::text as id from companies
     order by created_at desc nulls last
     limit 1`,
  );
  const fromCompanies = companies.rows[0]?.id;
  if (fromCompanies && String(fromCompanies).trim()) {
    console.log('[seed-admin] company_id da primeira empresa:', fromCompanies);
    return String(fromCompanies).trim();
  }

  const needsUuid = await usersCompanyIdIsUuid(client);
  if (needsUuid) {
    const bootId = await createBootstrapCompany(client);
    if (bootId) return bootId;
    throw new Error(
      'Nenhuma empresa em public.companies e falha ao criar bootstrap. Defina SEED_COMPANY_ID=<uuid>.',
    );
  }
  console.warn('[seed-admin] Sem companies — usando demo-company (schema mínimo)');
  return 'demo-company';
}

try {
  const hash = await bcrypt.hash(password, 10);
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const hasNome = await tableHasColumn(client, 'users', 'nome');
    const hasPasswordHash = await tableHasColumn(client, 'users', 'password_hash');
    const useAuthUsers = await authUsersExists(client);
    const companyId = await resolveCompanyId(client);

    if (await usersCompanyIdIsUuid(client) && !UUID_RE.test(companyId)) {
      throw new Error(
        `company_id "${companyId}" não é UUID. Use SEED_COMPANY_ID com id de public.companies.`,
      );
    }

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
