/**
 * DbMigrate para layout instalado RC2 — usa RC2_MIGRATIONS_ROOT (Program Files/Migrations).
 * Não referencia monorepo.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const backendNodeModules =
  process.env.RC2_BACKEND_NODE_MODULES ??
  path.join(scriptDir, '..', 'Backend', 'server', 'node_modules');
const pgPkg = path.join(backendNodeModules, 'pg');
if (!fs.existsSync(pgPkg)) {
  console.error('[migrate] pg não encontrado em', pgPkg);
  process.exit(1);
}

const require = createRequire(import.meta.url);
const pg = require(pgPkg);

const migrationsRoot = process.env.RC2_MIGRATIONS_ROOT;
if (!migrationsRoot) {
  console.error('[migrate] RC2_MIGRATIONS_ROOT obrigatório');
  process.exit(1);
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('[migrate] DATABASE_URL obrigatório');
  process.exit(1);
}

const ssl =
  process.env.DATABASE_SSL === 'true' || process.env.DATABASE_SSL === '1'
    ? { rejectUnauthorized: false }
    : undefined;

const pool = new pg.Pool({ connectionString, ssl });

const STEPS = [
  {
    key: 'bootstrap',
    label: 'bootstrap.sql',
    path: path.join(migrationsRoot, 'backend', 'db', 'vps', 'bootstrap.sql'),
  },
  {
    key: 'base',
    label: 'supabase_full_schema.sql',
    path: path.join(migrationsRoot, 'supabase_full_schema.sql'),
  },
];

function listSqlDir(relativeDir) {
  const dir = path.join(migrationsRoot, ...relativeDir.split('/'));
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
}

async function ensureTrackingTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS public._schema_migrations (
      name text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    );
  `);
}

async function isApplied(client, name) {
  const r = await client.query(
    'select 1 from public._schema_migrations where name = $1 limit 1',
    [name],
  );
  return (r.rowCount ?? 0) > 0;
}

async function markApplied(client, name) {
  await client.query(
    'insert into public._schema_migrations (name) values ($1) on conflict (name) do nothing',
    [name],
  );
}

async function ensurePgExtensions(client) {
  await client.query('CREATE SCHEMA IF NOT EXISTS extensions');
  const extRes = await client.query(`
    SELECT e.extname, n.nspname AS schema
    FROM pg_extension e
    JOIN pg_namespace n ON n.oid = e.extnamespace
    WHERE e.extname IN ('pgcrypto', 'uuid-ossp')
  `);
  const byName = new Map(extRes.rows.map((r) => [r.extname, r.schema]));
  if (byName.get('pgcrypto') === 'public') {
    await client.query('ALTER EXTENSION pgcrypto SET SCHEMA extensions');
  } else if (!byName.has('pgcrypto')) {
    await client.query('CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions');
  }
  if (byName.get('uuid-ossp') === 'public') {
    await client.query('ALTER EXTENSION "uuid-ossp" SET SCHEMA extensions');
  } else if (!byName.has('uuid-ossp')) {
    await client.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions');
  }
}

async function runSqlFile(client, filePath, name) {
  if (!(await isApplied(client, name))) {
    const sql = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
    await client.query(sql);
    await markApplied(client, name);
    console.log('[migrate] OK', name);
    return;
  }
  console.log('[migrate] skip', name);
}

try {
  const client = await pool.connect();
  try {
    await ensureTrackingTable(client);
    await ensurePgExtensions(client);
    await client.query('SET search_path TO public, extensions');
    for (const step of STEPS) {
      if (!fs.existsSync(step.path)) {
        throw new Error(`Arquivo não encontrado: ${step.path}`);
      }
      await runSqlFile(client, step.path, `vps/${step.key}`);
    }

    const supabaseFiles = listSqlDir('supabase/migrations').map((file) => ({
      file,
      abs: path.join(migrationsRoot, 'supabase', 'migrations', file),
      name: `supabase/${file}`,
    }));
    const supabaseEarly = [];
    const supabaseAfterMaster = [];
    for (const item of supabaseFiles) {
      const sql = fs.readFileSync(item.abs, 'utf8');
      // Depende de master_* já existentes (control plane).
      if (/\bmaster_[a-z0-9_]+\b/i.test(sql)) {
        supabaseAfterMaster.push(item);
      } else {
        supabaseEarly.push(item);
      }
    }

    // 1) Operacional (employees, etc.) sem depender do Master.
    for (const item of supabaseEarly) {
      await runSqlFile(client, item.abs, item.name);
    }
    // 2) Backend (inclui master_tenants / master_users + patches em employees).
    for (const file of listSqlDir('backend/db/migrations')) {
      const name = `backend/${file}`;
      await runSqlFile(client, path.join(migrationsRoot, 'backend', 'db', 'migrations', file), name);
    }
    // 3) Supabase restante que referencia master_*.
    for (const item of supabaseAfterMaster) {
      await runSqlFile(client, item.abs, item.name);
    }
    console.log('[migrate] Concluído');
  } finally {
    client.release();
  }
} catch (err) {
  console.error('[migrate] Falhou:', err);
  process.exit(1);
} finally {
  await pool.end();
}
