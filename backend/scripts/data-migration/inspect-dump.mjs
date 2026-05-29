/**
 * Lista tabelas com dados no dump Supabase (formato custom pg_dump).
 * Uso: node scripts/data-migration/inspect-dump.mjs [caminho/dump]
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultDump = path.join(__dirname, '..', '..', 'data', 'supabase-data.dump');
const dumpPath = path.resolve(process.argv[2] || defaultDump);

if (!fs.existsSync(dumpPath)) {
  console.error('[inspect-dump] Ficheiro não encontrado:', dumpPath);
  process.exit(1);
}

const stat = fs.statSync(dumpPath);
console.log('[inspect-dump] Ficheiro:', dumpPath);
console.log('[inspect-dump] Tamanho:', (stat.size / 1024 / 1024).toFixed(2), 'MB');
console.log('[inspect-dump] Formato: PostgreSQL custom (PGDMP)\n');

const list = spawnSync('pg_restore', ['-l', dumpPath], { encoding: 'utf8' });
if (list.status !== 0) {
  console.error('[inspect-dump] pg_restore não disponível ou falhou.');
  console.error(list.stderr || list.stdout);
  console.error('\nInstale PostgreSQL client (pg_restore) ou rode na VPS/Linux.');
  process.exit(1);
}

const tables = new Set();
for (const line of list.stdout.split('\n')) {
  const m = line.match(/TABLE DATA (public|auth|storage) (\S+)/);
  if (m) tables.add(`${m[1]}.${m[2]}`);
}

const publicTables = [...tables].filter((k) => k.startsWith('public.')).sort();
const authTables = [...tables].filter((k) => k.startsWith('auth.')).sort();
const storageTables = [...tables].filter((k) => k.startsWith('storage.')).sort();

console.log('=== public (%d tabelas com dados) ===', publicTables.length);
for (const t of publicTables) console.log(' ', t.replace('public.', ''));

console.log('\n=== auth (%d) ===', authTables.length);
for (const t of authTables) console.log(' ', t.replace('auth.', ''));

if (storageTables.length) {
  console.log('\n=== storage (%d) ===', storageTables.length);
  for (const t of storageTables) console.log(' ', t.replace('storage.', ''));
}

const FEATURE_TABLES = [
  'companies',
  'users',
  'employees',
  'departments',
  'work_shifts',
  'schedules',
  'escala_ciclica',
  'escala_mensal',
  'schedule_assignments',
  'employee_shift_schedule',
  'colaborador_jornada',
  'user_schedules',
  'rep_devices',
  'rep_punch_logs',
  'time_records',
  'punches',
  'timesheets',
  'timesheets_daily',
  'feriados',
  'holidays',
  'job_titles',
  'notifications',
  'requests',
  'company_rules',
  'overtime_rules',
  'folha_pagamento_periodos',
  'timeclock_devices',
];

console.log('\n=== Funcionalidades principais (presença no dump) ===');
for (const t of FEATURE_TABLES) {
  const ok = tables.has(`public.${t}`);
  const count = ok ? '(com dados)' : '(ausente no dump)';
  console.log(`  ${ok ? '✓' : '✗'} ${t} ${count}`);
}
