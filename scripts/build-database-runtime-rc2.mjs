#!/usr/bin/env node
/**
 * RC2 — Monta Database/ redistribuível via Runtime Builder (PostgreSQL 16.8 x64).
 *
 * Uso:
 *   node scripts/build-database-runtime-rc2.mjs [--source "C:\Program Files\PostgreSQL\16"]
 *
 * Env:
 *   RC2_PG_SOURCE_ROOT — raiz da instalação PG 16.8 no host de build
 *   RC2_DATABASE_RUNTIME_OUT — destino (default: rc2/database-runtime-builder/dist-runtime/Database)
 */
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DEFAULT_DATABASE_RUNTIME_DIR } from './rc2-professional-paths.mjs';

const SCRIPTS_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(SCRIPTS_DIR, '..');
const BUILDER_DIR = path.join(REPO_ROOT, 'rc2', 'database-runtime-builder');
const CLI = path.join(BUILDER_DIR, 'dist', 'cli.js');

const argv = process.argv.slice(2);
let sourceRoot = process.env.RC2_PG_SOURCE_ROOT;
let outputDir = process.env.RC2_DATABASE_RUNTIME_OUT ?? DEFAULT_DATABASE_RUNTIME_DIR;

for (let i = 0; i < argv.length; i += 1) {
  const a = argv[i];
  if (a === '--source' && argv[i + 1]) {
    sourceRoot = argv[++i];
  } else if (a === '--out' && argv[i + 1]) {
    outputDir = path.resolve(argv[++i]);
  }
}

function runNode(args, cwd, label) {
  const r = spawnSync(process.execPath, args, {
    cwd,
    stdio: 'inherit',
    env: process.env,
  });
  if (r.status !== 0) {
    throw new Error(`${label}_FAILED: exit ${r.status ?? r.signal ?? 'null'}`);
  }
}

console.log(JSON.stringify({ step: 'build-database-runtime-rc2', outputDir, sourceRoot: sourceRoot ?? '(auto-discover)' }));

runNode(['dist/cli.js', 'build', '--out', path.resolve(outputDir), ...(sourceRoot ? ['--source', path.resolve(sourceRoot)] : [])], BUILDER_DIR, 'database-runtime-build');

runNode(['dist/cli.js', 'validate', '--out', path.resolve(outputDir)], BUILDER_DIR, 'database-runtime-validate');

console.log(JSON.stringify({ ok: true, outputDir: path.resolve(outputDir) }));
