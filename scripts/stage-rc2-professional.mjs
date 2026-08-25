#!/usr/bin/env node
/**
 * RC2.4.0 — Monta dist-installer/PontoWebDesk-Professional/ para o Setup Professional futuro.
 *
 * Uso:
 *   node scripts/stage-rc2-professional.mjs [--build] [--allow-missing-database]
 *
 * Env:
 *   RC2_DATABASE_RUNTIME_DIR — pasta Database\ já montada (Runtime Builder)
 *   RC2_NODE_DIR — pasta com node.exe (default: dirname(process.execPath) no win32)
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  REPO_ROOT,
  STAGING_PRODUCT_DIR,
  STAGING_DIRS,
  EXPECTED_PROGRAMDATA_FILE,
  MANIFEST_FILE,
  VERSION_FILE,
  COMPONENT_PATHS,
  STAGING_REQUIRED_ROOTS,
  STAGING_REQUIRED_FILES,
  DEFAULT_DATABASE_RUNTIME_DIR,
  DATABASE_RUNTIME_REQUIRED_FILES,
  STAGING_CRITICAL_FILES,
} from './rc2-professional-paths.mjs';

const argv = process.argv.slice(2);
const FLAG_BUILD = argv.includes('--build');
const FLAG_ALLOW_MISSING_DB =
  argv.includes('--allow-missing-database') || process.env.RC2_ALLOW_MISSING_DATABASE === '1';

function log(step, detail = {}) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), step, ...detail }));
}

function runNpm(npmArgs, cwd, label) {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  log('run', { label, cmd: npm, args: npmArgs, cwd });
  const r = spawnSync(npm, npmArgs, {
    cwd,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: process.env,
  });
  if (r.status !== 0) {
    throw new Error(`${label}_FAILED: exit ${r.status ?? r.signal ?? 'null'}`);
  }
}

function runNode(nodeArgs, cwd, label) {
  log('run', { label, cmd: process.execPath, args: nodeArgs, cwd });
  const r = spawnSync(process.execPath, nodeArgs, { cwd, stdio: 'inherit', shell: false, env: process.env });
  if (r.status !== 0) {
    throw new Error(`${label}_FAILED: exit ${r.status ?? r.signal}`);
  }
}

function stagingCopyError(src, dest, err) {
  const code = err && typeof err === 'object' && 'code' in err ? err.code : undefined;
  const message = err instanceof Error ? err.message : String(err);
  const detail = {
    code: 'STAGE_COPY_FAILED',
    src,
    dest,
    errno: code,
    message,
    hint:
      code === 'EPERM' || code === 'EACCES'
        ? 'Verifique antivirus, permissões, junction/symlink ou arquivo bloqueado (feche Node/Setup que use o destino).'
        : undefined,
  };
  const wrapped = new Error(`STAGE_COPY_FAILED: ${src} -> ${dest}: ${message}`);
  wrapped.detail = detail;
  return wrapped;
}

function safeRmDir(p, label = 'cleanup') {
  if (!fs.existsSync(p)) return;
  try {
    fs.rmSync(p, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch (err) {
    const code = err && typeof err === 'object' && 'code' in err ? err.code : undefined;
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `STAGE_CLEANUP_FAILED (${label}): path=${p} code=${code ?? 'unknown'} message=${message}. ` +
        'Feche processos Node, Bootstrap ou antivirus que mantenham handles neste diretório.',
    );
  }
}

function mkdirp(p) {
  fs.mkdirSync(p, { recursive: true });
}

function copyFile(src, dest) {
  try {
    mkdirp(path.dirname(dest));
    fs.copyFileSync(src, dest);
  } catch (err) {
    throw stagingCopyError(src, dest, err);
  }
}

/**
 * Copia árvore resolvendo junctions/symlinks npm (file: deps no Windows).
 * Junctions aparecem como isSymbolicLink() && !isDirectory() — copyFileSync no diretório gera EPERM.
 */
function copyTree(src, dest, options = {}) {
  const { skip = new Set() } = options;
  if (!fs.existsSync(src)) return false;
  let stat;
  try {
    stat = fs.lstatSync(src);
  } catch (err) {
    throw stagingCopyError(src, dest, err);
  }

  if (stat.isSymbolicLink()) {
    const resolved = fs.realpathSync(src);
    const targetStat = fs.statSync(resolved);
    if (targetStat.isDirectory()) return copyTree(resolved, dest, options);
    copyFile(resolved, dest);
    return true;
  }

  if (!stat.isDirectory()) {
    copyFile(src, dest);
    return true;
  }

  mkdirp(dest);
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    if (skip.has(ent.name)) continue;
    const s = path.join(src, ent.name);
    const d = path.join(dest, ent.name);
    if (ent.isSymbolicLink()) {
      const resolved = fs.realpathSync(s);
      const rs = fs.statSync(resolved);
      if (rs.isDirectory()) copyTree(resolved, d, options);
      else copyFile(resolved, d);
      continue;
    }
    if (ent.isDirectory()) copyTree(s, d, options);
    else if (ent.isFile()) copyFile(s, d);
    else {
      throw stagingCopyError(
        s,
        d,
        new Error(`Unsupported dirent type name=${ent.name} (neither file, directory nor symlink)`),
      );
    }
  }
  return true;
}

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function readVersionText() {
  const candidates = [
    path.join(REPO_ROOT, VERSION_FILE),
    path.join(REPO_ROOT, 'installer', VERSION_FILE),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return fs.readFileSync(c, 'utf8').trim();
  }
  const rootPkg = readJson(path.join(REPO_ROOT, 'package.json'));
  return rootPkg.version ?? '0.0.0';
}

function ensureApiServiceBuilt() {
  const host = path.join(REPO_ROOT, 'rc2', 'api-service', 'dist', 'serviceHost.js');
  if (fs.existsSync(host) && !FLAG_BUILD) return host;
  runNpm(['run', 'build'], path.join(REPO_ROOT, 'rc2', 'api-service'), 'api-service-build');
  if (!fs.existsSync(host)) throw new Error('API_SERVICE_HOST_MISSING after build');
  return host;
}

function ensureBackendBuilt() {
  const distEntry = path.join(REPO_ROOT, 'backend', 'dist', 'server.js');
  if (fs.existsSync(distEntry) && !FLAG_BUILD) return;
  runNpm(['run', 'release'], path.join(REPO_ROOT, 'backend'), 'backend-release');
  if (!fs.existsSync(distEntry)) throw new Error('BACKEND_DIST_MISSING after release');
}

function ensureMasterContractBuilt() {
  const mcDist = path.join(REPO_ROOT, 'shared', 'master-contract', 'dist', 'index.js');
  if (fs.existsSync(mcDist) && !FLAG_BUILD) return;
  runNpm(['run', 'build'], path.join(REPO_ROOT, 'shared', 'master-contract'), 'master-contract-build');
}

function ensureFrontendBuilt() {
  const index = path.join(REPO_ROOT, 'dist', 'index.html');
  if (fs.existsSync(index) && !FLAG_BUILD) return;
  // Professional embutido: browser em :3010 → API local :3000 (não VPS/SaaS).
  const prev = { ...process.env };
  process.env.VITE_API_URL = 'http://127.0.0.1:3000/api';
  process.env.VITE_LOCAL_API_BASE_URL = 'http://127.0.0.1:3000/api';
  process.env.VITE_DATA_PROVIDER = 'LOCAL_API';
  process.env.VITE_APP_URL = 'http://127.0.0.1:3010';
  process.env.VITE_DEPLOYMENT_MODE = 'LOCAL';
  try {
    runNpm(['run', 'build:production'], REPO_ROOT, 'frontend-vite-build');
  } finally {
    for (const k of [
      'VITE_API_URL',
      'VITE_LOCAL_API_BASE_URL',
      'VITE_DATA_PROVIDER',
      'VITE_APP_URL',
      'VITE_DEPLOYMENT_MODE',
    ]) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  }
  if (!fs.existsSync(index)) throw new Error('FRONTEND_DIST_MISSING after vite build');
}

function ensureAgentBuilt() {
  const exe = path.join(REPO_ROOT, 'dist', 'rep-agent.exe');
  if (fs.existsSync(exe) && !FLAG_BUILD) return;
  runNpm(['run', 'build:agent'], REPO_ROOT, 'agent-build');
  if (!fs.existsSync(exe)) throw new Error('AGENT_EXE_MISSING after build:agent');
}

function stageNodeRuntime(stagingRoot) {
  const nodeDir = path.join(stagingRoot, 'Backend', 'node');
  mkdirp(nodeDir);
  const fromDir = process.env.RC2_NODE_DIR
    ? path.resolve(process.env.RC2_NODE_DIR)
    : path.dirname(process.execPath);
  const nodeExe = path.join(fromDir, process.platform === 'win32' ? 'node.exe' : 'node');
  if (!fs.existsSync(nodeExe)) {
    throw new Error(`NODE_RUNTIME_MISSING: ${nodeExe} (defina RC2_NODE_DIR)`);
  }
  copyFile(nodeExe, path.join(nodeDir, 'node.exe'));
  log('stageNodeRuntime', { from: nodeExe });
}

function stageBackend(stagingRoot) {
  ensureMasterContractBuilt();
  ensureBackendBuilt();

  const serverRoot = path.join(stagingRoot, 'Backend', 'server');
  safeRmDir(serverRoot, 'backend-server');
  mkdirp(serverRoot);

  copyTree(path.join(REPO_ROOT, 'backend', 'dist'), path.join(serverRoot, 'dist'));
  for (const f of ['package.json', 'package-lock.json']) {
    const src = path.join(REPO_ROOT, 'backend', f);
    if (fs.existsSync(src)) copyFile(src, path.join(serverRoot, f));
  }

  log('stageBackend', { action: 'npm ci --omit=dev in staging server' });
  runNpm(['ci', '--omit=dev'], serverRoot, 'backend-server-npm-ci');

  const mcDest = path.join(stagingRoot, 'Backend', 'shared', 'master-contract');
  safeRmDir(mcDest, 'master-contract');
  mkdirp(mcDest);
  copyFile(
    path.join(REPO_ROOT, 'shared', 'master-contract', 'package.json'),
    path.join(mcDest, 'package.json'),
  );
  copyTree(path.join(REPO_ROOT, 'shared', 'master-contract', 'dist'), path.join(mcDest, 'dist'));
}

function compileServiceHostExe() {
  const nativeDir = path.join(REPO_ROOT, 'rc2', 'api-service', 'native');
  const exe = path.join(nativeDir, 'PontoWebDeskServiceHost.exe');
  const script = path.join(nativeDir, 'compile-host.ps1');
  if (fs.existsSync(exe) && !FLAG_BUILD) return exe;
  if (process.platform !== 'win32') {
    throw new Error('SERVICE_HOST_COMPILE_REQUIRES_WIN32');
  }
  const r = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script],
    { cwd: nativeDir, stdio: 'inherit', env: process.env },
  );
  if (r.status !== 0) {
    throw new Error(`SERVICE_HOST_COMPILE_FAILED: exit ${r.status ?? r.signal}`);
  }
  if (!fs.existsSync(exe)) throw new Error(`SERVICE_HOST_EXE_MISSING after compile: ${exe}`);
  return exe;
}

function stageApiServiceHost(stagingRoot) {
  const hostSrc = ensureApiServiceBuilt();
  copyFile(hostSrc, path.join(stagingRoot, 'Bin', 'api-service-host.js'));
  copyFile(compileServiceHostExe(), path.join(stagingRoot, 'Bin', 'PontoWebDeskServiceHost.exe'));
  const apiPkg = readJson(path.join(REPO_ROOT, 'rc2', 'api-service', 'package.json'));
  return apiPkg.version;
}

function resolveDatabaseRuntimeDir() {
  const env = process.env.RC2_DATABASE_RUNTIME_DIR;
  if (env) return path.resolve(env);
  return DEFAULT_DATABASE_RUNTIME_DIR;
}

function databaseRuntimeDiagnostics(src) {
  const diagnostics = {
    resolvedSourceDir: src,
    env_RC2_DATABASE_RUNTIME_DIR: process.env.RC2_DATABASE_RUNTIME_DIR ?? null,
    defaultFallbackDir: DEFAULT_DATABASE_RUNTIME_DIR,
    expectedFiles: DATABASE_RUNTIME_REQUIRED_FILES,
    directoryExists: fs.existsSync(src),
    topLevelEntries: [],
    missingExpected: [],
  };
  if (diagnostics.directoryExists) {
    try {
      diagnostics.topLevelEntries = fs.readdirSync(src);
    } catch (err) {
      diagnostics.readDirError = err instanceof Error ? err.message : String(err);
    }
    for (const rel of DATABASE_RUNTIME_REQUIRED_FILES) {
      if (!fs.existsSync(path.join(src, rel))) diagnostics.missingExpected.push(rel);
    }
  }
  return diagnostics;
}

function formatDatabaseRuntimeMissingError(src) {
  const diag = databaseRuntimeDiagnostics(src);
  return (
    `DATABASE_RUNTIME_MISSING: ${path.join(src, 'bin', 'postgres.exe')}\n` +
    `Defina RC2_DATABASE_RUNTIME_DIR apontando para uma pasta Database\\ já montada (Runtime Builder).\n` +
    `Diagnóstico: ${JSON.stringify(diag, null, 2)}`
  );
}

function stageDatabase(stagingRoot) {
  const src = resolveDatabaseRuntimeDir();
  const postgres = path.join(src, 'bin', 'postgres.exe');
  if (!fs.existsSync(postgres)) {
    if (FLAG_ALLOW_MISSING_DB) {
      log('stageDatabase', { warning: 'SKIPPED_MISSING_RUNTIME', src });
      mkdirp(path.join(stagingRoot, 'Database'));
      return null;
    }
    throw new Error(formatDatabaseRuntimeMissingError(src));
  }
  const dest = path.join(stagingRoot, 'Database');
  safeRmDir(dest, 'database');
  copyTree(src, dest);
  let version = '16.8';
  const verFile = path.join(dest, 'VERSION');
  if (fs.existsSync(verFile)) version = fs.readFileSync(verFile, 'utf8').trim();
  return version;
}

function stageFrontend(stagingRoot) {
  ensureFrontendBuilt();
  const www = path.join(stagingRoot, 'Frontend', 'www');
  safeRmDir(www, 'frontend-www');
  copyTree(path.join(REPO_ROOT, 'dist'), www, {
    skip: new Set(['rep-agent.exe', 'rep-agent-bundle.cjs', 'rep-agent.staging.exe']),
  });
}

function stageAgent(stagingRoot) {
  ensureAgentBuilt();
  copyFile(path.join(REPO_ROOT, 'dist', 'rep-agent.exe'), path.join(stagingRoot, 'Agent', 'rep-agent.exe'));
}

function stageConfig(stagingRoot) {
  const configDir = path.join(stagingRoot, 'Config');
  mkdirp(path.join(configDir, 'templates'));

  const agentTemplate = path.join(REPO_ROOT, 'installer', 'config.template.json');
  if (fs.existsSync(agentTemplate)) {
    copyFile(agentTemplate, path.join(configDir, 'templates', 'agent.config.template.json'));
  }

  const programDataMeta = {
    programDataRoot: '%ProgramData%\\PontoWebDesk',
    directories: {
      pgdata: 'Database/pgdata',
      logs: 'Logs',
      config: 'Config',
      backups: 'Backups',
      storage: 'Storage',
    },
    note: 'pgdata é criado pelo Bootstrap em ProgramData; não faz parte do pacote Program Files.',
  };
  fs.writeFileSync(
    path.join(stagingRoot, EXPECTED_PROGRAMDATA_FILE),
    `${JSON.stringify(programDataMeta, null, 2)}\n`,
    'utf8',
  );

  const backendEnvDefault = [
    'NODE_ENV=production',
    'PORT=3000',
    'HOST=127.0.0.1',
    '# Gerado pelo Setup; segredos em Config/secrets.json (ProgramData)',
    '',
  ].join('\n');
  fs.writeFileSync(path.join(configDir, 'templates', 'backend.env.default'), backendEnvDefault, 'utf8');
}

function writeVersion(stagingRoot, productVersion) {
  fs.writeFileSync(path.join(stagingRoot, VERSION_FILE), `${productVersion}\n`, 'utf8');
}

function stageBootstrap(stagingRoot) {
  const bootstrapDir = path.join(REPO_ROOT, 'rc2', 'bootstrap');
  runNpm(['run', 'build'], bootstrapDir, 'bootstrap-build');
  runNpm(['ci', '--omit=dev'], bootstrapDir, 'bootstrap-npm-ci');
  runNpm(
    ['install', '--omit=dev', '--no-save', 'file:../api-service'],
    bootstrapDir,
    'bootstrap-api-service-runtime',
  );
  const dest = path.join(stagingRoot, 'Bootstrap');
  safeRmDir(dest, 'bootstrap');
  mkdirp(dest);
  copyTree(path.join(bootstrapDir, 'dist'), path.join(dest, 'dist'));
  copyTree(path.join(bootstrapDir, 'node_modules'), path.join(dest, 'node_modules'));
  for (const f of ['package.json', 'package-lock.json']) {
    const src = path.join(bootstrapDir, f);
    if (fs.existsSync(src)) copyFile(src, path.join(dest, f));
  }
}

function stageMigrateRunner(stagingRoot) {
  const src = path.join(REPO_ROOT, 'rc2', 'bootstrap', 'scripts', 'apply-installed-database.mjs');
  if (!fs.existsSync(src)) {
    throw new Error(`MIGRATE_RUNNER_SOURCE_MISSING: ${src}`);
  }
  copyFile(src, path.join(stagingRoot, 'Bin', 'apply-installed-database.mjs'));
  const seed = path.join(REPO_ROOT, 'rc2', 'bootstrap', 'scripts', 'seed-professional-defaults.mjs');
  if (!fs.existsSync(seed)) {
    throw new Error(`SEED_PROFESSIONAL_SOURCE_MISSING: ${seed}`);
  }
  copyFile(seed, path.join(stagingRoot, 'Bin', 'seed-professional-defaults.mjs'));
  const fe = path.join(REPO_ROOT, 'rc2', 'bootstrap', 'scripts', 'serve-frontend.mjs');
  if (!fs.existsSync(fe)) {
    throw new Error(`FRONTEND_SERVE_SCRIPT_SOURCE_MISSING: ${fe}`);
  }
  copyFile(fe, path.join(stagingRoot, 'Bin', 'serve-frontend.mjs'));
}

function stageMigrations(stagingRoot) {
  const dest = path.join(stagingRoot, 'Migrations');
  mkdirp(dest);
  const pairs = [
    [path.join(REPO_ROOT, 'supabase_full_schema.sql'), path.join(dest, 'supabase_full_schema.sql')],
  ];
  for (const [s, d] of pairs) {
    if (fs.existsSync(s)) copyFile(s, d);
  }
  copyTree(path.join(REPO_ROOT, 'supabase', 'migrations'), path.join(dest, 'supabase', 'migrations'));
  copyTree(path.join(REPO_ROOT, 'backend', 'db', 'migrations'), path.join(dest, 'backend', 'db', 'migrations'));
  copyTree(path.join(REPO_ROOT, 'backend', 'db', 'vps'), path.join(dest, 'backend', 'db', 'vps'));
  fs.writeFileSync(
    path.join(dest, 'manifest.json'),
    `${JSON.stringify({ version: '1.0.0-rc2.4.1', packagedAt: new Date().toISOString() }, null, 2)}\n`,
  );
}

function writeLayoutManifest(stagingRoot, meta) {
  const doc = {
    manifestVersion: '1.0.0-rc2.4.3',
    productName: 'PontoWebDesk Professional',
    productVersion: meta.productVersion,
    buildDate: new Date().toISOString(),
    layout: { productFolderName: 'PontoWebDesk' },
    programData: {
      directories: {
        config: 'Config',
        logs: 'Logs',
        storage: 'Storage',
        pgdata: 'Database/pgdata',
        backups: 'Backups',
      },
    },
    components: {
      backend: {
        path: COMPONENT_PATHS.backend,
        version: meta.backendVersion,
        requiredFiles: ['node/node.exe', 'server/dist/server.js', 'shared/master-contract/dist/index.js'],
      },
      frontend: {
        path: COMPONENT_PATHS.frontend,
        version: meta.productVersion,
        requiredFiles: ['www/index.html'],
      },
      database: {
        path: COMPONENT_PATHS.database,
        version: meta.databaseVersion ?? 'missing',
        requiredFiles: ['bin/postgres.exe', 'VERSION', 'manifest.json'],
        binSubdir: 'bin',
        toolsSubdir: 'tools',
      },
      agent: {
        path: COMPONENT_PATHS.agent,
        version: meta.productVersion,
        requiredFiles: ['rep-agent.exe'],
      },
      apiService: {
        path: COMPONENT_PATHS.apiService,
        version: meta.apiServiceVersion,
        requiredFiles: [
          'api-service-host.js',
          'serve-frontend.mjs',
          'apply-installed-database.mjs',
          'seed-professional-defaults.mjs',
          'PontoWebDeskServiceHost.exe',
        ],
      },
      migrations: {
        path: 'Migrations',
        version: meta.productVersion,
        requiredFiles: ['manifest.json', 'supabase_full_schema.sql'],
        migrateRunner: 'Bin/apply-installed-database.mjs',
      },
      bootstrap: {
        path: 'Bootstrap',
        version: meta.bootstrapVersion ?? meta.productVersion,
        requiredFiles: ['dist/index.js', 'package.json'],
      },
    },
  };
  fs.writeFileSync(path.join(stagingRoot, MANIFEST_FILE), `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
  return doc;
}

const STAGING_PARENT = path.dirname(STAGING_PRODUCT_DIR);
const STAGING_BASENAME = path.basename(STAGING_PRODUCT_DIR);

function cleanupStaleStagingBuilds() {
  if (!fs.existsSync(STAGING_PARENT)) return;
  for (const ent of fs.readdirSync(STAGING_PARENT, { withFileTypes: true })) {
    if (!ent.isDirectory()) continue;
    if (ent.name.startsWith(`${STAGING_BASENAME}.build-`)) {
      safeRmDir(path.join(STAGING_PARENT, ent.name), 'stale-staging-build');
    }
  }
}

function createTempStagingRoot() {
  mkdirp(STAGING_PARENT);
  const tempRoot = path.join(STAGING_PARENT, `${STAGING_BASENAME}.build-${process.pid}-${Date.now()}`);
  safeRmDir(tempRoot, 'temp-staging-pre-create');
  mkdirp(tempRoot);
  for (const rel of STAGING_DIRS) {
    mkdirp(path.join(tempRoot, rel));
  }
  return tempRoot;
}

function assertStagingComplete(stagingRoot, { requireDatabase }) {
  const missing = [];
  for (const rel of STAGING_REQUIRED_ROOTS) {
    const abs = path.join(stagingRoot, rel);
    if (!fs.existsSync(abs)) {
      missing.push({ kind: 'directory', path: rel });
      continue;
    }
    if (!fs.statSync(abs).isDirectory()) {
      missing.push({ kind: 'not_a_directory', path: rel });
    }
  }
  for (const rel of STAGING_REQUIRED_FILES) {
    const abs = path.join(stagingRoot, rel);
    if (!fs.existsSync(abs)) missing.push({ kind: 'file', path: rel });
  }
  if (requireDatabase) {
    for (const rel of DATABASE_RUNTIME_REQUIRED_FILES) {
      const abs = path.join(stagingRoot, 'Database', rel);
      if (!fs.existsSync(abs)) missing.push({ kind: 'database_runtime_file', path: `Database/${rel}` });
    }
  }
  for (const rel of STAGING_CRITICAL_FILES) {
    if (rel.startsWith('Database/') && !requireDatabase) continue;
    const abs = path.join(stagingRoot, rel);
    if (!fs.existsSync(abs)) missing.push({ kind: 'critical_file', path: rel });
  }
  if (missing.length > 0) {
    throw new Error(`STAGING_INCOMPLETE: ${JSON.stringify({ stagingRoot, missing }, null, 2)}`);
  }
}

function promoteStaging(tempRoot) {
  const final = STAGING_PRODUCT_DIR;

  if (fs.existsSync(final)) {
    safeRmDir(final, 'existing-staging-before-promote');
  }
  mkdirp(STAGING_PARENT);

  // Windows: rename de árvore grande (node_modules) pode falhar com EPERM (AV/indexador/handles).
  log('promoteStaging', { mode: 'copyTree', from: tempRoot, to: final });
  copyTree(tempRoot, final);
  safeRmDir(tempRoot, 'temp-after-copy-promote');
}

function main() {
  log('stage-rc2-professional', { start: true, flags: { build: FLAG_BUILD, allowMissingDatabase: FLAG_ALLOW_MISSING_DB } });

  cleanupStaleStagingBuilds();
  const tempRoot = createTempStagingRoot();
  log('stage-rc2-professional', { tempStaging: tempRoot, finalStaging: STAGING_PRODUCT_DIR });

  try {
    const productVersion = readVersionText();
    const backendPkg = readJson(path.join(REPO_ROOT, 'backend', 'package.json'));

    stageNodeRuntime(tempRoot);
    stageBackend(tempRoot);
    const apiServiceVersion = stageApiServiceHost(tempRoot);
    const databaseVersion = stageDatabase(tempRoot);
    stageFrontend(tempRoot);
    stageAgent(tempRoot);
    stageConfig(tempRoot);
    stageMigrations(tempRoot);
    stageMigrateRunner(tempRoot);
    stageBootstrap(tempRoot);
    writeVersion(tempRoot, productVersion);

    const manifest = writeLayoutManifest(tempRoot, {
      productVersion,
      backendVersion: backendPkg.version,
      apiServiceVersion,
      databaseVersion,
      bootstrapVersion: readJson(path.join(REPO_ROOT, 'rc2', 'bootstrap', 'package.json')).version,
    });

    assertStagingComplete(tempRoot, { requireDatabase: !FLAG_ALLOW_MISSING_DB && databaseVersion !== null });

    promoteStaging(tempRoot);

    log('stage-rc2-professional', {
      ok: true,
      staging: STAGING_PRODUCT_DIR,
      productVersion,
      databasePresent: databaseVersion !== null,
      manifest: manifest.manifestVersion,
    });
  } catch (err) {
    safeRmDir(tempRoot, 'failed-staging-build');
    throw err;
  }
}

try {
  main();
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  const payload = { ok: false, error: message };
  if (err instanceof Error && err.detail) payload.detail = err.detail;
  console.error(JSON.stringify(payload));
  process.exit(1);
}
