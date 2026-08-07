/**
 * Sincroniza runtime RC1 para o instalador Local.
 *
 * 1) Empacota release/rc1-consolidado → SaaS-Demo/
 * 2) Espelha SaaS-Demo/ → PontoWebDesk-Demo/SaaS-Demo/ (fonte do build-installer.bat)
 *
 * Uso: node scripts/sync-installer-runtime.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SAAS = path.join(ROOT, 'SaaS-Demo');
const INSTALLER_RUNTIME = path.join(ROOT, 'PontoWebDesk-Demo', 'SaaS-Demo');

function rmDir(p) {
  if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
}

function copyTree(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    if (ent.name === 'node_modules' || ent.name === '.git') continue;
    const s = path.join(src, ent.name);
    const d = path.join(dest, ent.name);
    if (ent.isDirectory()) copyTree(s, d);
    else fs.copyFileSync(s, d);
  }
}

console.log('[sync-installer] Empacotando SaaS-Demo a partir do RC1…');
const pack = spawnSync(process.execPath, [path.join(ROOT, 'scripts', '_pack_saas_demo.mjs')], {
  cwd: ROOT,
  stdio: 'inherit',
});
if (pack.status !== 0) {
  console.error('[sync-installer] _pack_saas_demo.mjs falhou.');
  process.exit(pack.status ?? 1);
}

if (!fs.existsSync(path.join(SAAS, 'docker-compose.yml'))) {
  console.error('[sync-installer] SaaS-Demo incompleto após pack.');
  process.exit(1);
}

console.log('[sync-installer] Espelhando → PontoWebDesk-Demo/SaaS-Demo …');
fs.mkdirSync(path.dirname(INSTALLER_RUNTIME), { recursive: true });
rmDir(INSTALLER_RUNTIME);
copyTree(SAAS, INSTALLER_RUNTIME);

console.log('[sync-installer] OK');
console.log(
  JSON.stringify(
    {
      saasDemo: SAAS,
      installerRuntime: INSTALLER_RUNTIME,
      version: fs.readFileSync(path.join(SAAS, 'VERSION'), 'utf8').trim(),
      next: 'cd installer && build-installer.bat',
    },
    null,
    2,
  ),
);
