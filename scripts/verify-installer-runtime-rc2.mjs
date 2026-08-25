#!/usr/bin/env node
/**
 * RC2.4.0 — Valida staging Professional antes do Inno Setup.
 *
 * Uso: node scripts/verify-installer-runtime-rc2.mjs
 * Env: RC2_STAGING_DIR (default: dist-installer/PontoWebDesk-Professional)
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  STAGING_PRODUCT_DIR,
  EXPECTED_PROGRAMDATA_FILE,
  MANIFEST_FILE,
  VERSION_FILE,
  STAGING_CRITICAL_FILES,
} from './rc2-professional-paths.mjs';

const SCRIPTS_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(SCRIPTS_DIR, '..');
const DATABASE_RUNTIME_CLI = path.join(REPO_ROOT, 'rc2', 'database-runtime-builder', 'dist', 'cli.js');

const FROZEN_PG_VERSION = '16.8';
const FROZEN_PG_ARCH = 'x64';

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

function verifyLayout(errors) {
  for (const rel of REQUIRED_LAYOUT_DIRS) {
    checkDir(rel, 'layout', errors);
  }
}

function verifyCriticalFiles(errors) {
  for (const rel of STAGING_CRITICAL_FILES) {
    checkFile(rel, 'critical', errors);
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

function verifyManifestConsistency(errors) {
  const manifestPath = path.join(STAGING, MANIFEST_FILE);
  if (!fs.existsSync(manifestPath)) return;
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    for (const [name, comp] of Object.entries(manifest.components ?? {})) {
      const base = comp.path;
      for (const rel of comp.requiredFiles ?? []) {
        const full = path.join(base, rel).replace(/\\/g, '/');
        if (!exists(full)) {
          errors.push({
            bucket: 'manifest',
            code: 'MANIFEST_REQUIRED_FILE_MISSING',
            component: name,
            path: full,
          });
        }
      }
    }
  } catch {
    errors.push({ bucket: 'manifest', code: 'MANIFEST_INVALID_JSON', path: MANIFEST_FILE });
  }
}

function verifyDatabaseRuntime(errors, warnings) {
  const dbRoot = path.join(STAGING, 'Database');
  const requiredBins = ['bin/postgres.exe', 'bin/pg_ctl.exe', 'bin/initdb.exe'];
  const requiredDirs = ['lib', 'share'];

  for (const rel of requiredBins) {
    checkFile(`Database/${rel}`, 'database', errors);
  }
  for (const rel of requiredDirs) {
    checkDir(`Database/${rel}`, 'database', errors);
  }

  const versionPath = path.join(dbRoot, 'VERSION');
  if (fs.existsSync(versionPath)) {
    const version = fs.readFileSync(versionPath, 'utf8').trim();
    if (version !== FROZEN_PG_VERSION) {
      errors.push({
        bucket: 'database',
        code: 'DATABASE_VERSION_MISMATCH',
        path: 'Database/VERSION',
        expected: FROZEN_PG_VERSION,
        found: version,
      });
    }
  }

  const dbManifestPath = path.join(dbRoot, 'manifest.json');
  if (fs.existsSync(dbManifestPath)) {
    try {
      const dbManifest = JSON.parse(fs.readFileSync(dbManifestPath, 'utf8'));
      if (dbManifest.postgresqlVersion !== FROZEN_PG_VERSION) {
        errors.push({
          bucket: 'database',
          code: 'DATABASE_MANIFEST_VERSION_MISMATCH',
          path: 'Database/manifest.json',
          expected: FROZEN_PG_VERSION,
          found: dbManifest.postgresqlVersion ?? null,
        });
      }
      if (dbManifest.architecture !== FROZEN_PG_ARCH) {
        errors.push({
          bucket: 'database',
          code: 'DATABASE_MANIFEST_ARCH_MISMATCH',
          path: 'Database/manifest.json',
          expected: FROZEN_PG_ARCH,
          found: dbManifest.architecture ?? null,
        });
      }
      if (typeof dbManifest.fileCount !== 'number' || dbManifest.fileCount < 1) {
        errors.push({
          bucket: 'database',
          code: 'DATABASE_MANIFEST_FILECOUNT_INVALID',
          path: 'Database/manifest.json',
          found: dbManifest.fileCount ?? null,
        });
      }
      if (dbManifest.sourceRoot) {
        warnings.push({
          bucket: 'database',
          code: 'DATABASE_BUILD_SOURCE_ROOT_METADATA',
          path: 'Database/manifest.json',
          message:
            `sourceRoot=${dbManifest.sourceRoot} — metadado de build; runtime embarcado não depende deste caminho`,
        });
      }
    } catch {
      errors.push({ bucket: 'database', code: 'DATABASE_MANIFEST_INVALID_JSON', path: 'Database/manifest.json' });
    }
  }

  if (!fs.existsSync(DATABASE_RUNTIME_CLI)) {
    errors.push({
      bucket: 'database',
      code: 'DATABASE_RUNTIME_CLI_MISSING',
      path: DATABASE_RUNTIME_CLI,
    });
    return;
  }

  if (!fs.existsSync(path.join(dbRoot, 'bin', 'postgres.exe'))) return;

  const r = spawnSync(
    process.execPath,
    [DATABASE_RUNTIME_CLI, 'validate', '--out', dbRoot],
    { encoding: 'utf8', env: process.env },
  );
  if (r.status !== 0) {
    let detail = (r.stdout || r.stderr || '').trim();
    try {
      const parsed = JSON.parse(detail);
      detail = parsed.errors?.join('; ') || detail;
    } catch {
      /* keep raw */
    }
    errors.push({
      bucket: 'database',
      code: 'DATABASE_RUNTIME_VALIDATE_FAILED',
      path: 'Database',
      message: detail || `exit ${r.status ?? r.signal ?? 'null'}`,
    });
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
        },
        null,
        2,
      ),
    );
    process.exit(1);
  }

  verifyLayout(errors);
  verifyCriticalFiles(errors);
  verifyPgdataExpectation(errors);
  verifyManifestConsistency(errors);
  verifyDatabaseRuntime(errors, warnings);

  const report = {
    ok: errors.length === 0,
    staging: STAGING,
    errorCount: errors.length,
    warningCount: warnings.length,
    errors,
    warnings,
  };

  console.log(JSON.stringify(report, null, 2));
  process.exit(errors.length > 0 ? 1 : 0);
}

main();
