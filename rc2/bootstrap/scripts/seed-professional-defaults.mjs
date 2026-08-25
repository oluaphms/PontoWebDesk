/**
 * Seed Professional — empresa + admin + colaborador (idempotente).
 * Uso (install): node Bin/seed-professional-defaults.mjs
 * Env: DATABASE_URL, RC2_BACKEND_NODE_MODULES, RC2_SEED_*
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const backendNodeModules =
  process.env.RC2_BACKEND_NODE_MODULES ??
  path.join(scriptDir, '..', 'Backend', 'server', 'node_modules');

function requireFromBackend(pkgName) {
  const pkgPath = path.join(backendNodeModules, pkgName);
  if (!fs.existsSync(pkgPath)) {
    console.error(`[seed-professional] ${pkgName} não encontrado em`, pkgPath);
    process.exit(1);
  }
  return createRequire(import.meta.url)(pkgPath);
}

const pg = requireFromBackend('pg');
const bcrypt = requireFromBackend('bcryptjs');

const connectionString =
  process.env.DATABASE_URL_ADMIN ||
  process.env.DATABASE_URL_MIGRATE ||
  process.env.DATABASE_URL;
if (!connectionString) {
  console.error(
    '[seed-professional] DATABASE_URL_ADMIN, DATABASE_URL_MIGRATE ou DATABASE_URL obrigatório',
  );
  process.exit(1);
}

function envOr(key, fallback) {
  const v = String(process.env[key] || '').trim();
  return v || fallback;
}

const seed = {
  companyName: envOr('RC2_SEED_COMPANY_NAME', 'FL LOCADORA LTDA'),
  companyCnpj: envOr('RC2_SEED_COMPANY_CNPJ', '15048950000163').replace(/\D/g, ''),
  companySlug: envOr('RC2_SEED_COMPANY_SLUG', 'fl-locadora'),
  adminEmail: envOr('RC2_SEED_ADMIN_EMAIL', 'admin@pontowebdesk.com').toLowerCase(),
  adminPassword: envOr('RC2_SEED_ADMIN_PASSWORD', 'admin123'),
  adminName: envOr('RC2_SEED_ADMIN_NAME', 'Administrador'),
  adminRole: envOr('RC2_SEED_ADMIN_ROLE', 'admin'),
  collabEmail: envOr('RC2_SEED_COLLAB_EMAIL', 'paulohmorais@hotmail.com').toLowerCase(),
  collabPassword: envOr('RC2_SEED_COLLAB_PASSWORD', 'P@hms70548084'),
  collabName: envOr('RC2_SEED_COLLAB_NAME', 'Paulo Henrique'),
  collabRole: envOr('RC2_SEED_COLLAB_ROLE', 'employee'),
};

const ssl =
  process.env.DATABASE_SSL === 'true' || process.env.DATABASE_SSL === '1'
    ? { rejectUnauthorized: false }
    : undefined;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const pool = new pg.Pool({ connectionString, ssl });

async function tableExists(client, table) {
  const r = await client.query(
    `select 1 from information_schema.tables
     where table_schema = 'public' and table_name = $1 limit 1`,
    [table],
  );
  return (r.rowCount ?? 0) > 0;
}

async function tableHasColumn(client, table, column) {
  const r = await client.query(
    `select 1 from information_schema.columns
     where table_schema = 'public' and table_name = $1 and column_name = $2 limit 1`,
    [table, column],
  );
  return (r.rowCount ?? 0) > 0;
}

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

async function ensureCompany(client) {
  if (!(await tableExists(client, 'companies'))) {
    throw new Error('[seed-professional] Tabela companies ausente — rode db_migrate_full.');
  }

  await client.query(`
DO $policy$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename = 'companies'
       AND policyname = 'companies_trusted_bootstrap_select'
  ) THEN
    CREATE POLICY companies_trusted_bootstrap_select ON public.companies
      FOR SELECT
      USING (
        coalesce(nullif(current_setting('app.rls_enforced', true), ''), 'false') <> 'true'
        OR coalesce(nullif(current_setting('app.master_control_plane', true), ''), '') = 'true'
        OR (
          NOT (id IS DISTINCT FROM public.get_my_company_id())
          AND public.get_my_company_id() IS NOT NULL
        )
      );
  END IF;
END
$policy$;
`);

  if (await tableHasColumn(client, 'companies', 'cnpj')) {
    const byCnpj = await client.query(
      `select id::text as id from companies
       where regexp_replace(coalesce(cnpj, ''), '\\D', '', 'g') = $1
       limit 1`,
      [seed.companyCnpj],
    );
    if (byCnpj.rows[0]?.id) return String(byCnpj.rows[0].id);
  }

  const bySlug = await tableHasColumn(client, 'companies', 'slug')
    ? await client.query(`select id::text as id from companies where slug = $1 limit 1`, [
        seed.companySlug,
      ])
    : { rows: [] };
  if (bySlug.rows[0]?.id) return String(bySlug.rows[0].id);

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
    vals.push(seed.companyName);
    valueSql.push(`$${vals.length}`);
  }
  if (await tableHasColumn(client, 'companies', 'name')) {
    cols.push('name');
    vals.push(seed.companyName);
    valueSql.push(`$${vals.length}`);
  }
  if (await tableHasColumn(client, 'companies', 'slug')) {
    cols.push('slug');
    vals.push(seed.companySlug);
    valueSql.push(`$${vals.length}`);
  }
  if (await tableHasColumn(client, 'companies', 'cnpj')) {
    cols.push('cnpj');
    vals.push(seed.companyCnpj);
    valueSql.push(`$${vals.length}`);
  }

  const ins = await client.query(
    `insert into companies (${cols.join(', ')}) values (${valueSql.join(', ')}) returning id::text as id`,
    vals,
  );
  const id = ins.rows[0]?.id;
  if (!id) throw new Error('[seed-professional] INSERT companies sem id');
  console.log('[seed-professional] empresa criada', seed.companyName, id);
  return String(id);
}

async function authUsersExists(client) {
  const r = await client.query(
    `select 1 from information_schema.tables
     where table_schema = 'auth' and table_name = 'users' limit 1`,
  );
  return (r.rowCount ?? 0) > 0;
}

async function upsertUser(client, { email, password, name, role, companyId, cargo }) {
  if (!(await tableExists(client, 'users'))) {
    throw new Error('[seed-professional] Tabela users ausente');
  }
  const hash = await bcrypt.hash(password, 12);
  const hasNome = await tableHasColumn(client, 'users', 'nome');
  const hasPasswordHash = await tableHasColumn(client, 'users', 'password_hash');
  const hasCargo = await tableHasColumn(client, 'users', 'cargo');
  const hasStatus = await tableHasColumn(client, 'users', 'status');
  const hasUpdatedAt = await tableHasColumn(client, 'users', 'updated_at');
  const useAuthUsers = await authUsersExists(client);

  if (!hasPasswordHash) {
    throw new Error('[seed-professional] users.password_hash ausente — migrate incompleto');
  }

  const existing = await client.query(
    'select id from users where lower(trim(email)) = $1 limit 1',
    [email],
  );

  if ((existing.rowCount ?? 0) > 0) {
    const userId = existing.rows[0].id;
    await client.query(
      'update users set password_hash = $1, company_id = $2, role = $3 where id = $4',
      [hash, companyId, role, userId],
    );
    if (hasNome) {
      const fields = ['nome = $2'];
      const values = [userId, name];
      if (hasCargo) {
        values.push(cargo);
        fields.push(`cargo = $${values.length}`);
      }
      if (hasStatus) {
        values.push('active');
        fields.push(`status = $${values.length}`);
      }
      if (hasUpdatedAt) fields.push('updated_at = now()');
      await client.query(`update users set ${fields.join(', ')} where id = $1`, values);
    }
    console.log('[seed-professional] user atualizado', email, role);
    return String(userId);
  }

  let userId = null;
  if (useAuthUsers) {
    const authInsert = await client.query(
      'insert into auth.users (email) values ($1) returning id',
      [email],
    );
    userId = authInsert.rows[0].id;
  }

  const cols = [];
  const vals = [];
  if (userId) {
    cols.push('id');
    vals.push(userId);
  } else if (await tableHasColumn(client, 'users', 'id')) {
    cols.push('id');
    vals.push(crypto.randomUUID());
    userId = vals[vals.length - 1];
  }

  if (hasNome) {
    cols.push('nome');
    vals.push(name);
  }
  cols.push('email', 'password_hash', 'company_id', 'role');
  vals.push(email, hash, companyId, role);
  if (hasCargo) {
    cols.push('cargo');
    vals.push(cargo);
  }
  if (hasStatus) {
    cols.push('status');
    vals.push('active');
  }
  const placeholders = vals.map((_, i) => `$${i + 1}`).join(', ');
  const ins = await client.query(
    `insert into users (${cols.join(', ')}) values (${placeholders}) returning id`,
    vals,
  );
  console.log('[seed-professional] user criado', email, role);
  return String(ins.rows[0].id);
}

async function upsertEmployee(client, { email, password, name, role, companyId, userId }) {
  if (!(await tableExists(client, 'employees'))) return;
  if (!(await tableHasColumn(client, 'employees', 'password_hash'))) return;

  const hash = await bcrypt.hash(password, 12);
  const hasNome = await tableHasColumn(client, 'employees', 'nome');
  const hasName = await tableHasColumn(client, 'employees', 'name');
  const hasStatus = await tableHasColumn(client, 'employees', 'status');
  const hasRole = await tableHasColumn(client, 'employees', 'role');
  const hasUserId = await tableHasColumn(client, 'employees', 'user_id');

  const existing = await client.query(
    'select id from employees where lower(trim(email)) = $1 limit 1',
    [email],
  );

  if ((existing.rowCount ?? 0) > 0) {
    const empId = existing.rows[0].id;
    const sets = ['password_hash = $1', 'company_id = $2'];
    const vals = [hash, companyId];
    if (hasRole) {
      vals.push(role);
      sets.push(`role = $${vals.length}`);
    }
    if (hasNome) {
      vals.push(name);
      sets.push(`nome = $${vals.length}`);
    } else if (hasName) {
      vals.push(name);
      sets.push(`name = $${vals.length}`);
    }
    if (hasStatus) {
      vals.push('active');
      sets.push(`status = $${vals.length}`);
    }
    if (hasUserId && userId) {
      vals.push(userId);
      sets.push(`user_id = $${vals.length}`);
    }
    vals.push(empId);
    await client.query(`update employees set ${sets.join(', ')} where id = $${vals.length}`, vals);
    console.log('[seed-professional] employee atualizado', email);
    return;
  }

  const idKind = await (async () => {
    const r = await client.query(
      `select data_type, udt_name from information_schema.columns
       where table_schema = 'public' and table_name = 'employees' and column_name = 'id' limit 1`,
    );
    const dt = String(r.rows[0]?.data_type || '').toLowerCase();
    const udt = String(r.rows[0]?.udt_name || '').toLowerCase();
    return dt === 'uuid' || udt === 'uuid' ? 'uuid' : 'text';
  })();

  const cols = [];
  const vals = [];
  const valueSql = [];

  if (await tableHasColumn(client, 'employees', 'id')) {
    cols.push('id');
    if (idKind === 'uuid') valueSql.push('gen_random_uuid()');
    else {
      vals.push(`emp_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`);
      valueSql.push(`$${vals.length}`);
    }
  }

  cols.push('email');
  vals.push(email);
  valueSql.push(`$${vals.length}`);

  cols.push('password_hash');
  vals.push(hash);
  valueSql.push(`$${vals.length}`);

  cols.push('company_id');
  vals.push(companyId);
  valueSql.push(`$${vals.length}`);

  if (hasRole) {
    cols.push('role');
    vals.push(role);
    valueSql.push(`$${vals.length}`);
  }
  if (hasNome) {
    cols.push('nome');
    vals.push(name);
    valueSql.push(`$${vals.length}`);
  } else if (hasName) {
    cols.push('name');
    vals.push(name);
    valueSql.push(`$${vals.length}`);
  }
  if (hasStatus) {
    cols.push('status');
    vals.push('active');
    valueSql.push(`$${vals.length}`);
  }
  if (hasUserId && userId) {
    cols.push('user_id');
    vals.push(userId);
    valueSql.push(`$${vals.length}`);
  }

  await client.query(
    `insert into employees (${cols.join(', ')}) values (${valueSql.join(', ')})`,
    vals,
  );
  console.log('[seed-professional] employee criado', email);
}

try {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Seed de install: bypass RLS (app role é restrito por company_id).
    await client.query('SET LOCAL row_security = off');
    const companyId = await ensureCompany(client);
    if (!companyId || (await tableHasColumn(client, 'users', 'company_id'))) {
      const r = await client.query(
        `select data_type from information_schema.columns
         where table_schema = 'public' and table_name = 'users' and column_name = 'company_id' limit 1`,
      );
      if (r.rows[0]?.data_type === 'uuid' && !UUID_RE.test(companyId)) {
        throw new Error(`[seed-professional] company_id inválido para UUID: ${companyId}`);
      }
    }

    await upsertUser(client, {
      email: seed.adminEmail,
      password: seed.adminPassword,
      name: seed.adminName,
      role: seed.adminRole,
      companyId,
      cargo: 'Administrador',
    });

    const collabId = await upsertUser(client, {
      email: seed.collabEmail,
      password: seed.collabPassword,
      name: seed.collabName,
      role: seed.collabRole,
      companyId,
      cargo: 'Colaborador',
    });

    await upsertEmployee(client, {
      email: seed.collabEmail,
      password: seed.collabPassword,
      name: seed.collabName,
      role: seed.collabRole,
      companyId,
      userId: collabId,
    });

    await client.query('COMMIT');
    console.log('[seed-professional] OK', {
      companyId,
      admin: seed.adminEmail,
      collaborator: seed.collabEmail,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
} catch (err) {
  console.error('[seed-professional] Falhou:', err instanceof Error ? err.message : err);
  process.exit(1);
} finally {
  await pool.end();
}
