/**
 * Verifica paridade mínima RC1 do runtime do instalador (SaaS-Demo / PontoWebDesk-Demo).
 * Uso: node scripts/verify-installer-runtime.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const RUNTIMES = [
  { label: 'SaaS-Demo', dir: path.join(ROOT, 'SaaS-Demo') },
  { label: 'PontoWebDesk-Demo/SaaS-Demo', dir: path.join(ROOT, 'PontoWebDesk-Demo', 'SaaS-Demo') },
];

const REQUIRED = [
  'VERSION',
  'docker-compose.yml',
  'backend/Dockerfile',
  'backend/package.json',
  'backend/db/migrations/041_departments_id_default.sql',
  'backend/db/migrations/042_plan_employee_limit_contracted_seats.sql',
  'backend/db/migrations/043_vps_rls_all_tenant_tables.sql',
  'backend/db/migrations/018_master_persistence.sql',
  'backend/db/migrations/027_master_auth_persistence.sql',
  'shared/master-contract/package.json',
  'supabase/migrations',
  'supabase_full_schema.sql',
  'database/initial.sql',
];

const results = [];

for (const rt of RUNTIMES) {
  const row = { runtime: rt.label, ok: true, missing: [], warnings: [] };
  if (!fs.existsSync(rt.dir)) {
    row.ok = false;
    row.missing.push('(pasta inteira ausente)');
    results.push(row);
    continue;
  }
  for (const rel of REQUIRED) {
    const abs = path.join(rt.dir, rel);
    if (!fs.existsSync(abs)) {
      row.ok = false;
      row.missing.push(rel);
    }
  }
  const mcPkg = path.join(rt.dir, 'shared/master-contract/package.json');
  if (fs.existsSync(mcPkg)) {
    const pkg = JSON.parse(fs.readFileSync(mcPkg, 'utf8'));
    const exp = pkg.exports?.['.']?.import ?? pkg.main ?? '';
    if (String(exp).includes('.ts')) {
      row.warnings.push('master-contract ainda exporta .ts (esperado dist/index.js RC1)');
      row.ok = false;
    }
  }
  const ver = path.join(rt.dir, 'VERSION');
  if (fs.existsSync(ver)) {
    const v = fs.readFileSync(ver, 'utf8').trim();
    if (v !== '1.0.0-rc.1') row.warnings.push(`VERSION=${v} (esperado 1.0.0-rc.1)`);
  }
  const df = path.join(rt.dir, 'backend/Dockerfile');
  if (fs.existsSync(df)) {
    const t = fs.readFileSync(df, 'utf8');
    if (!t.includes('npm run release')) {
      row.warnings.push('backend/Dockerfile sem npm run release');
      row.ok = false;
    }
  }
  results.push(row);
}

console.log(JSON.stringify({ results, pass: results.every((r) => r.ok) }, null, 2));
process.exit(results.every((r) => r.ok) ? 0 : 1);
