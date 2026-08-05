#!/usr/bin/env node
/**
 * Aplica apenas as migrações Supabase que corrigem rep_ingest_punch (company_id UUID).
 * Uso na VPS:
 *   cd backend && node scripts/apply-rep-ingest-fix.mjs
 *   cd backend && node scripts/apply-rep-ingest-fix.mjs --force
 */
import { observabilityConsole } from '../../services/observabilityConsole.js';
import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..', '..');
const force = process.argv.includes('--force');

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  observabilityConsole.error('[rep-ingest-fix] Defina DATABASE_URL em backend/.env');
  process.exit(1);
}

const ssl =
  process.env.DATABASE_SSL === 'true' || process.env.DATABASE_SSL === '1'
    ? { rejectUnauthorized: false }
    : undefined;

const REP_FIX_FILES = [
  '20260520350000_fix_rep_ingest_punch_uuid_text.sql',
  '20260522120000_rep_punch_hash_insert_guard.sql',
];

const pool = new pg.Pool({ connectionString, ssl });

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

async function dropRepIngestOverloads(client) {
  const r = await client.query(`
    select p.proname, pg_get_function_identity_arguments(p.oid) as args
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('rep_ingest_punch', 'rep_ingest_idempotency_precheck')
  `);
  for (const row of r.rows) {
    const sql = `DROP FUNCTION IF EXISTS public.${row.proname}(${row.args});`;
    observabilityConsole.log('[rep-ingest-fix] drop overload:', sql);
    await client.query(sql);
  }
}

async function verifyAllOverloads(client) {
  const verify = await client.query(`
    select
      p.proname,
      pg_get_function_identity_arguments(p.oid) as args,
      p.prosrc like '%v_company_uuid%' as has_uuid_fix
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'rep_ingest_punch'
    order by args
  `);
  if (verify.rows.length === 0) {
    observabilityConsole.error('[rep-ingest-fix] rep_ingest_punch não encontrada após migração');
    return false;
  }
  let ok = true;
  for (const row of verify.rows) {
    const line = `${row.proname}(${row.args}): ${row.has_uuid_fix ? 'OK' : 'FALTA v_company_uuid'}`;
    observabilityConsole.log('[rep-ingest-fix]', line);
    if (!row.has_uuid_fix) ok = false;
  }
  return ok;
}

const client = await pool.connect();
try {
  await ensureTrackingTable(client);
  const dir = path.join(repoRoot, 'supabase', 'migrations');

  if (force) {
    observabilityConsole.log('[rep-ingest-fix] --force: removendo overloads antigos antes de reaplicar');
    await dropRepIngestOverloads(client);
  }

  for (const file of REP_FIX_FILES) {
    const name = `supabase/${file}`;
    const filePath = path.join(dir, file);
    if (!fs.existsSync(filePath)) {
      throw new Error(`Arquivo não encontrado: ${filePath}`);
    }
    if (!force && (await isApplied(client, name))) {
      observabilityConsole.log('[rep-ingest-fix] skip (já aplicado):', file);
      continue;
    }
    observabilityConsole.log('[rep-ingest-fix] aplicando', file, force ? '(force)' : '');
    const sql = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
    await client.query(sql);
    await markApplied(client, name);
    observabilityConsole.log('[rep-ingest-fix] OK', file);
  }

  const ok = await verifyAllOverloads(client);
  if (!ok) {
    observabilityConsole.error(
      '[rep-ingest-fix] Alguma overload de rep_ingest_punch ainda sem v_company_uuid. Rode com --force.',
    );
    process.exit(1);
  }
  observabilityConsole.log('[rep-ingest-fix] rep_ingest_punch UUID fix: OK (todas as overloads)');
} catch (err) {
  observabilityConsole.error('[rep-ingest-fix] Falhou:', err);
  process.exit(1);
} finally {
  client.release();
  await pool.end();
}
