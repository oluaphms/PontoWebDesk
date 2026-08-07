/**
 * DbMigrate para layout instalado RC2 — usa RC2_MIGRATIONS_ROOT (Program Files/Migrations).
 * Não referencia monorepo.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

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
    for (const step of STEPS) {
      if (!fs.existsSync(step.path)) {
        throw new Error(`Arquivo não encontrado: ${step.path}`);
      }
      await runSqlFile(client, step.path, `vps/${step.key}`);
    }
    for (const file of listSqlDir('supabase/migrations')) {
      const name = `supabase/${file}`;
      await runSqlFile(client, path.join(migrationsRoot, 'supabase', 'migrations', file), name);
    }
    for (const file of listSqlDir('backend/db/migrations')) {
      const name = `backend/${file}`;
      await runSqlFile(client, path.join(migrationsRoot, 'backend', 'db', 'migrations', file), name);
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
