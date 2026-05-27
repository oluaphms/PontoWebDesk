/**
 * Contagens rápidas na VPS (sem ligar ao Supabase).
 * Uso: cd backend && node scripts/data-migration/count-vps-tables.mjs
 */
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '..', '.env') });

const url = process.env.DATABASE_URL?.trim();
if (!url) {
  console.error('Defina DATABASE_URL em backend/.env');
  process.exit(1);
}

const TABLES = [
  'companies',
  'users',
  'employees',
  'departments',
  'work_shifts',
  'schedules',
  'schedule_assignments',
  'time_records',
  'punches',
  'timesheets',
  'notifications',
  'requests',
];

const pool = new pg.Pool({ connectionString: url });

try {
  console.log('\n[VPS] Contagens em public.*\n');
  for (const table of TABLES) {
    try {
      const r = await pool.query(`select count(*)::bigint as c from public.${table}`);
      const c = Number(r.rows[0]?.c ?? 0);
      if (c > 0) console.log(String(table).padEnd(28), c);
    } catch {
      // tabela pode não existir no schema
    }
  }
  const extra = await pool.query(`
    select tablename from pg_tables
    where schemaname = 'public' and tablename not like 'pg_%'
    order by tablename
  `);
  console.log('\n[VPS] Tabelas public existentes:', extra.rows.length);
  console.log('[VPS] Se employees/departments = 0, importe o dump do Supabase (docs/migration/supabase-to-vps-data.md)\n');
} finally {
  await pool.end();
}
