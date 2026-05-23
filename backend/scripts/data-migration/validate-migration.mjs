/**
 * Compara contagens Supabase vs VPS (tabelas public com dados na origem).
 *
 * Uso:
 *   SUPABASE_DATABASE_URL=... DATABASE_URL=... node scripts/data-migration/validate-migration.mjs
 */
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '..', '.env') });

const supabaseUrl = process.env.SUPABASE_DATABASE_URL;
const vpsUrl = process.env.DATABASE_URL;

const KEY_TABLES = [
  'companies',
  'users',
  'employees',
  'departments',
  'time_records',
  'punches',
  'rep_punch_logs',
  'work_shifts',
  'notifications',
  'requests',
  'timesheets',
];

if (!supabaseUrl || !vpsUrl) {
  console.error('[validate] Defina SUPABASE_DATABASE_URL e DATABASE_URL em backend/.env');
  process.exit(1);
}

const ssl = (url) =>
  url.includes('sslmode=require') || process.env.DATABASE_SSL === 'true'
    ? { rejectUnauthorized: false }
    : undefined;

async function listPublicTables(pool) {
  const r = await pool.query(`
    select tablename from pg_tables
    where schemaname = 'public'
    order by tablename
  `);
  return r.rows.map((x) => x.tablename);
}

async function countTable(pool, table) {
  try {
    const r = await pool.query(`select count(*)::bigint as c from public.${table}`);
    return Number(r.rows[0]?.c ?? 0);
  } catch {
    return null;
  }
}

async function countAuthUsers(pool) {
  try {
    const r = await pool.query('select count(*)::bigint as c from auth.users');
    return Number(r.rows[0]?.c ?? 0);
  } catch {
    return null;
  }
}

async function countUsersWithoutPassword(pool) {
  try {
    const r = await pool.query(
      `select count(*)::bigint as c from public.users where password_hash is null or password_hash = ''`,
    );
    return Number(r.rows[0]?.c ?? 0);
  } catch {
    return null;
  }
}

const srcPool = new pg.Pool({ connectionString: supabaseUrl, ssl: ssl(supabaseUrl) });
const dstPool = new pg.Pool({ connectionString: vpsUrl, ssl: ssl(vpsUrl) });

let mismatches = 0;

try {
  const srcTables = await listPublicTables(srcPool);
  const tablesToCheck = [
    ...new Set([...KEY_TABLES, ...srcTables.filter((t) => !t.startsWith('pg_'))]),
  ].filter((t) => t !== '_schema_migrations');

  console.log('\n[validate] Contagens Supabase vs VPS\n');
  console.log('Tabela'.padEnd(36), 'Supabase'.padStart(10), 'VPS'.padStart(10), 'Status');
  console.log('-'.repeat(70));

  for (const table of tablesToCheck) {
    const src = await countTable(srcPool, table);
    const dst = await countTable(dstPool, table);
    if (src === null && dst === null) continue;
    if (src === 0 && (dst === 0 || dst === null)) continue;

    const ok = src === dst;
    if (!ok) mismatches += 1;
    const status = ok ? 'OK' : 'DIFF';
    console.log(
      table.padEnd(36),
      String(src ?? 'N/A').padStart(10),
      String(dst ?? 'N/A').padStart(10),
      status,
    );
  }

  const authSrc = await countAuthUsers(srcPool);
  const authDst = await countAuthUsers(dstPool);
  console.log('-'.repeat(70));
  console.log(
    'auth.users'.padEnd(36),
    String(authSrc ?? 'N/A').padStart(10),
    String(authDst ?? 'N/A').padStart(10),
    authSrc === authDst ? 'OK' : 'DIFF',
  );
  if (authSrc !== authDst) mismatches += 1;

  const noPwd = await countUsersWithoutPassword(dstPool);
  if (noPwd != null && noPwd > 0) {
    console.log(`\n[validate] AVISO: ${noPwd} utilizador(es) em public.users sem password_hash (login API).`);
    console.log('  Rode npm run db:seed para admin ou UPDATE password_hash por email.');
  }

  console.log(mismatches === 0 ? '\n[validate] Todas as contagens conferem.\n' : `\n[validate] ${mismatches} diferença(s).\n`);
  process.exit(mismatches === 0 ? 0 : 2);
} catch (err) {
  console.error('[validate] Falhou:', err);
  process.exit(1);
} finally {
  await srcPool.end();
  await dstPool.end();
}
