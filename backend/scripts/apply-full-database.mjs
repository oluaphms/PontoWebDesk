/**
 * Schema completo na VPS: bootstrap + supabase_full_schema + supabase/migrations + backend/db/migrations
 *
 * Uso:
 *   cd backend && npm run db:migrate:full
 *   cd backend && node scripts/apply-full-database.mjs --dry-run
 *   cd backend && node scripts/apply-full-database.mjs --from 20250401000000
 *
 * Recomendado: banco vazio ou backup antes (substitui o fluxo mínimo db:apply-schema).
 */
import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..', '..');

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('[db:full] Defina DATABASE_URL em backend/.env');
  process.exit(1);
}

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const continueOnError = args.includes('--continue-on-error');
const fromIdx = args.findIndex((a) => a === '--from');
const fromName = fromIdx >= 0 ? args[fromIdx + 1] : null;

const ssl =
  process.env.DATABASE_SSL === 'true' || process.env.DATABASE_SSL === '1'
    ? { rejectUnauthorized: false }
    : undefined;

const pool = new pg.Pool({ connectionString, ssl });

const STEPS = [
  {
    key: 'bootstrap',
    label: 'bootstrap.sql',
    path: path.join(__dirname, '..', 'db', 'vps', 'bootstrap.sql'),
  },
  {
    key: 'base',
    label: 'supabase_full_schema.sql',
    path: path.join(repoRoot, 'supabase_full_schema.sql'),
  },
];

function listSupabaseMigrations() {
  const dir = path.join(repoRoot, 'supabase', 'migrations');
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
}

function listBackendMigrations() {
  const dir = path.join(__dirname, '..', 'db', 'migrations');
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
    if (dryRun) {
      console.log('[db:full] (dry-run) aplicaria:', name);
      return { applied: false, skipped: false };
    }
    const sql = fs.readFileSync(filePath, 'utf8');
    await client.query(sql);
    await markApplied(client, name);
    console.log('[db:full] OK', name);
    return { applied: true, skipped: false };
  }
  console.log('[db:full] skip (já aplicado):', name);
  return { applied: false, skipped: true };
}

async function runSqlContent(client, sql, name) {
  if (await isApplied(client, name)) {
    console.log('[db:full] skip (já aplicado):', name);
    return { applied: false, skipped: true };
  }
  if (dryRun) {
    console.log('[db:full] (dry-run) aplicaria:', name);
    return { applied: false, skipped: false };
  }
  await client.query(sql);
  await markApplied(client, name);
  console.log('[db:full] OK', name);
  return { applied: true, skipped: false };
}

let started = !fromName;

if (dryRun) {
  console.log('[db:full] dry-run — ficheiros que seriam aplicados:');
  for (const step of STEPS) {
    console.log('  ', step.label);
  }
  const supabaseFiles = listSupabaseMigrations();
  for (const file of supabaseFiles) {
    if (!started) {
      if (file === fromName || file.startsWith(fromName || '')) started = true;
      else continue;
    }
    console.log('  ', file);
  }
  for (const file of listBackendMigrations()) {
    console.log('  ', `backend/db/migrations/${file}`);
  }
  console.log(`[db:full] Total supabase: ${listSupabaseMigrations().length}, backend: ${listBackendMigrations().length}`);
  process.exit(0);
}

try {
  const client = await pool.connect();
  let applied = 0;
  let failed = 0;
  let skipped = 0;

  try {
    await ensureTrackingTable(client);

    for (const step of STEPS) {
      if (!fs.existsSync(step.path)) {
        throw new Error(`Arquivo não encontrado: ${step.path}`);
      }
      const name = `vps/${step.key}`;
      try {
        const r = await runSqlFile(client, step.path, name);
        if (r.skipped) skipped += 1;
        else if (r.applied) applied += 1;
      } catch (err) {
        failed += 1;
        console.error('[db:full] ERRO', name, err.message || err);
        if (!continueOnError) throw err;
      }
    }

    const supabaseFiles = listSupabaseMigrations();
    const supabaseDir = path.join(repoRoot, 'supabase', 'migrations');

    for (const file of supabaseFiles) {
      if (!started) {
        if (file === fromName || file.startsWith(fromName)) started = true;
        else continue;
      }
      const name = `supabase/${file}`;
      const filePath = path.join(supabaseDir, file);
      try {
        const r = await runSqlFile(client, filePath, name);
        if (r.skipped) skipped += 1;
        else if (r.applied) applied += 1;
      } catch (err) {
        failed += 1;
        console.error('[db:full] ERRO', name, err.message || err);
        if (!continueOnError) throw err;
      }
    }

    const backendDir = path.join(__dirname, '..', 'db', 'migrations');
    for (const file of listBackendMigrations()) {
      const name = `backend/${file}`;
      const filePath = path.join(backendDir, file);
      try {
        const r = await runSqlFile(client, filePath, name);
        if (r.skipped) skipped += 1;
        else if (r.applied) applied += 1;
      } catch (err) {
        failed += 1;
        console.error('[db:full] ERRO', name, err.message || err);
        if (!continueOnError) throw err;
      }
    }

    console.log(
      `[db:full] Concluído — aplicados: ${applied}, já existentes: ${skipped}, erros: ${failed}${dryRun ? ' (dry-run)' : ''}`,
    );
    if (failed > 0 && continueOnError) process.exit(2);
  } finally {
    client.release();
  }
} catch (err) {
  console.error('[db:full] Falhou:', err);
  process.exit(1);
} finally {
  await pool.end();
}
