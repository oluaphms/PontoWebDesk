#!/usr/bin/env node
/**
 * RC2.4.0 — Valida staging Professional antes do Inno Setup.
 *
 * Uso: node scripts/verify-installer-runtime-rc2.mjs
 * Env: RC2_STAGING_DIR (default: dist-installer/PontoWebDesk-Professional)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  STAGING_PRODUCT_DIR,
  EXPECTED_PROGRAMDATA_FILE,
  MANIFEST_FILE,
  VERSION_FILE,
} from './rc2-professional-paths.mjs';

const STAGING =
  process.env.RC2_STAGING_DIR != null && process.env.RC2_STAGING_DIR !== ''
    ? path.resolve(process.env.RC2_STAGING_DIR)
    : STAGING_PRODUCT_DIR;

const REQUIRED_LAYOUT_DIRS = [
  'Backend',
  'Backend/node',
  'Backend/server',
  'Frontend',
  'Frontend/www',
  'Database',
  'Agent',
  'Bin',
  'Config',
  'Bootstrap',
  'Bootstrap/dist',
];

function exists(rel) {
  return fs.existsSync(path.join(STAGING, rel));
}

function checkFile(rel, bucket, errors) {
  if (!exists(rel)) errors.push({ bucket, code: 'FILE_MISSING', path: rel });
}

function checkDir(rel, bucket, errors) {
  const abs = path.join(STAGING, rel);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) {
    errors.push({ bucket, code: 'DIR_MISSING', path: rel });
  }
}

function verifyBackend(errors) {
  checkFile('Backend/node/node.exe', 'backend', errors);
  checkFile('Backend/server/dist/server.js', 'backend', errors);
  checkFile('Backend/shared/master-contract/dist/index.js', 'backend', errors);
}

function verifyApiService(errors) {
  checkFile('Bin/api-service-host.js', 'apiService', errors);
}

function verifyBootstrap(errors) {
  checkFile('Bootstrap/dist/index.js', 'bootstrap', errors);
  checkFile('Bootstrap/package.json', 'bootstrap', errors);
}

function verifyDatabase(errors, warnings) {
  checkFile('Database/bin/postgres.exe', 'database', errors);
  checkFile('Database/VERSION', 'database', errors);
  checkFile('Database/manifest.json', 'database', errors);
  if (!exists('Database/bin/postgres.exe') && exists('Database')) {
    const entries = fs.readdirSync(path.join(STAGING, 'Database'));
    if (entries.length === 0) {
      warnings.push({
        bucket: 'database',
        code: 'DATABASE_RUNTIME_EMPTY',
        message: 'Database/ vazio — execute Runtime Builder ou RC2_DATABASE_RUNTIME_DIR antes do stage',
      });
    }
  }
}

function verifyPgdataExpectation(errors) {
  checkFile(EXPECTED_PROGRAMDATA_FILE, 'layout', errors);
  const abs = path.join(STAGING, EXPECTED_PROGRAMDATA_FILE);
  if (!fs.existsSync(abs)) return;
  try {
    const doc = JSON.parse(fs.readFileSync(abs, 'utf8'));
    if (!doc.directories?.pgdata) {
      errors.push({
        bucket: 'database',
        code: 'PGDATA_LAYOUT_UNDEFINED',
        path: EXPECTED_PROGRAMDATA_FILE,
      });
    } else if (doc.directories.pgdata !== 'Database/pgdata') {
      errors.push({
        bucket: 'database',
        code: 'PGDATA_PATH_UNEXPECTED',
        message: doc.directories.pgdata,
      });
    }
  } catch {
    errors.push({ bucket: 'layout', code: 'EXPECTED_PROGRAMDATA_INVALID_JSON', path: EXPECTED_PROGRAMDATA_FILE });
  }
}

function verifyFrontend(errors) {
  checkFile('Frontend/www/index.html', 'frontend', errors);
}

function verifyAgent(errors) {
  const rep = 'Agent/rep-agent.exe';
  if (!exists(rep)) {
    errors.push({ bucket: 'agent', code: 'FILE_MISSING', path: rep });
  }
}

function verifyLayout(errors) {
  for (const rel of REQUIRED_LAYOUT_DIRS) {
    checkDir(rel, 'layout', errors);
  }
  checkFile(VERSION_FILE, 'layout', errors);
  checkFile(MANIFEST_FILE, 'layout', errors);
}

function verifyManifestConsistency(warnings) {
  const manifestPath = path.join(STAGING, MANIFEST_FILE);
  if (!fs.existsSync(manifestPath)) return;
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  for (const [name, comp] of Object.entries(manifest.components ?? {})) {
    const base = comp.path;
    for (const rel of comp.requiredFiles ?? []) {
      const full = path.join(base, rel).replace(/\\/g, '/');
      if (!exists(full)) {
        warnings.push({
          bucket: 'manifest',
          code: 'MANIFEST_REQUIRED_FILE_MISSING',
          component: name,
          path: full,
        });
      }
    }
  }
}

function main() {
  const errors = [];
  const warnings = [];

  if (!fs.existsSync(STAGING)) {
    console.log(
      JSON.stringify(
        {
          ok: false,
          staging: STAGING,
          errors: [{ bucket: 'layout', code: 'STAGING_MISSING', path: STAGING }],
          warnings: [],
        },
        null,
        2,
      ),
    );
    process.exit(1);
  }

  verifyLayout(errors);
  verifyBackend(errors);
  verifyApiService(errors);
  verifyBootstrap(errors);
  verifyDatabase(errors, warnings);
  verifyPgdataExpectation(errors);
  verifyFrontend(errors);
  verifyAgent(errors);
  verifyManifestConsistency(warnings);

  const hardFail = errors.length > 0;
  const report = {
    ok: !hardFail,
    staging: STAGING,
    errorCount: errors.length,
    warningCount: warnings.length,
    errors,
    warnings,
  };

  console.log(JSON.stringify(report, null, 2));
  process.exit(hardFail ? 1 : 0);
}

main();
