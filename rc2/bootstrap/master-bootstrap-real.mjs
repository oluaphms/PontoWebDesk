/**
 * Validação real (sem SCM): provision + migrate + MASTER_* + API + login.
 * Uso: node master-bootstrap-real.mjs  (cwd = rc2/bootstrap)
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { InstallationContext } from '@pontowebdesk/api-runtime';
import { toBootstrapPaths } from './dist/runtime/bootstrapPaths.js';
import { Logger } from './dist/Logger.js';
import { PostgresInstallOrchestrator } from './dist/postgres/PostgresInstallOrchestrator.js';
import { SecretsStore } from './dist/postgres/SecretsStore.js';
import { PostgresEmbeddedService } from './dist/postgres/PostgresEmbeddedService.js';
import { PostgresDiscovery } from './dist/postgres/PostgresDiscovery.js';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const pf = process.env.RC2_PROGRAM_FILES_ROOT || 'C:\\Program Files\\PontoWebDesk';
const pd = process.env.RC2_PROGRAM_DATA_ROOT || 'C:\\ProgramData\\PontoWebDesk';
process.env.RC2_PROGRAM_FILES_ROOT = pf;
process.env.RC2_PROGRAM_DATA_ROOT = pd;
process.env.PATH = `${path.join(pf, 'Database', 'bin')};${process.env.PATH || ''}`;

const ctx = InstallationContext.load({ programFilesRoot: pf, programDataRoot: pd });
const paths = toBootstrapPaths(ctx.paths);
const log = new Logger({ logDir: paths.logsDir, component: 'master-real-test' });
const store = new SecretsStore(paths.secretsFile);
const secrets = store.loadOrCreate(55432);
const discovery = await new PostgresDiscovery(paths).verifyVersion(new PostgresDiscovery(paths).discover());
const pg = new PostgresEmbeddedService(paths, log, discovery);

console.log('[1] password + HBA');
await pg.setSuperuserPassword(secrets.postgresSuperuserPassword, secrets.port);
await pg.writeProductionHba();

console.log('[2] create_database');
const orch = new PostgresInstallOrchestrator(paths, log);
await orch.runStep('create_database');

console.log('[3] migrate + grants + backend.env');
await orch.runStep('apply_schema');
await orch.runStep('db_migrate_full');

const env = fs.readFileSync(paths.backendEnvFile, 'utf8');
const masterKeys = [...env.matchAll(/^([A-Z0-9_]+)=/gm)].map((m) => m[1]).filter((k) => k.startsWith('MASTER_'));
fs.writeFileSync(path.join(paths.configDir, 'api-service.env'), env.endsWith('\n') ? env : `${env}\n`, 'utf8');
console.log('[4] MASTER keys', masterKeys.join(','));

const envMap = { ...process.env };
for (const line of env.split(/\r?\n/)) {
  const t = line.trim();
  if (!t || t.startsWith('#')) continue;
  const eq = t.indexOf('=');
  if (eq <= 0) continue;
  envMap[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
}
envMap.PORT = '3000';
envMap.NODE_ENV = 'production';

const nodeExe = path.join(pf, 'Backend', 'node', 'node.exe');
const serverJs = path.join(pf, 'Backend', 'server', 'dist', 'server.js');
const cwd = path.join(pf, 'Backend', 'server');

function startApi() {
  return spawn(nodeExe, [serverJs], { cwd, env: envMap, stdio: ['ignore', 'pipe', 'pipe'] });
}

async function waitHealth(ms = 90000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try {
      const r = await fetch('http://127.0.0.1:3000/api/health/live');
      if (r.ok) return true;
    } catch {
      /* */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

async function login() {
  return fetch('http://127.0.0.1:3000/api/master/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: secrets.masterOwner1Email,
      password: secrets.masterOwner1Password,
    }),
  });
}

async function countMasters() {
  const { stdout } = await execFileAsync(
    path.join(pf, 'Database', 'bin', 'psql.exe'),
    [
      '-h',
      '127.0.0.1',
      '-p',
      String(secrets.port),
      '-U',
      'postgres',
      '-d',
      'pontowebdesk',
      '-tAc',
      "SELECT count(*)||'|'||coalesce(min(email),'')||'|'||coalesce(min(role),'') FROM public.master_users;",
    ],
    {
      env: { ...process.env, PGPASSWORD: secrets.postgresSuperuserPassword },
      timeout: 20000,
    },
  );
  return stdout.trim();
}

console.log('[5] start API #1');
let child = startApi();
let boot = '';
child.stderr.on('data', (d) => {
  boot += d.toString();
});
child.stdout.on('data', (d) => {
  boot += d.toString();
});
if (!(await waitHealth())) {
  console.error(boot.slice(-3000));
  child.kill();
  process.exit(2);
}
console.log('[6] API has MASTER_PERSISTENCE=', envMap.MASTER_PERSISTENCE, 'OWNER=', envMap.MASTER_OWNER_1_EMAIL);

const r1 = await login();
const t1 = await r1.text();
console.log('[7] login1', r1.status, t1.slice(0, 200));
const c1 = await countMasters();
console.log('[8] master_users', c1);

const r2 = await login();
const c2 = await countMasters();
console.log('[9] login2', r2.status, 'count', c2);

child.kill();
await new Promise((r) => setTimeout(r, 2000));
console.log('[10] restart API');
child = startApi();
if (!(await waitHealth())) {
  child.kill();
  process.exit(3);
}
const r3 = await login();
const c3 = await countMasters();
console.log('[11] login3', r3.status, 'count', c3);
child.kill();

const count = Number(String(c3).split('|')[0]);
const out = {
  result: r1.ok && r2.ok && r3.ok && count === 1 ? 'OK' : 'FAIL',
  masterUsers: count,
  email: secrets.masterOwner1Email,
  masterEnvKeys: masterKeys,
  loginStatuses: [r1.status, r2.status, r3.status],
  idempotent: c1.startsWith('1|') && c2.startsWith('1|') && c3.startsWith('1|'),
  apiReceivedMasterVars: Boolean(envMap.MASTER_JWT_SECRET && envMap.MASTER_OWNER_1_PASSWORD),
};
console.log(JSON.stringify(out, null, 2));
fs.writeFileSync(path.join(pd, 'Logs', 'master-bootstrap-real-result.json'), JSON.stringify(out, null, 2));
process.exit(out.result === 'OK' ? 0 : 1);
