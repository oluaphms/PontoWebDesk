#!/usr/bin/env node
/**
 * Empacota o agente REP em dist/rep-agent.exe (esbuild bundle CJS + pkg).
 * `pkg .` no monorepo React puxa dependências do frontend — este script isola só o agente.
 */
import { execSync } from 'node:child_process';
import { mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const distDir = path.join(root, 'dist');
const bundlePath = path.join(distDir, 'rep-agent-bundle.cjs');
const exePath = path.join(distDir, 'rep-agent.exe');

mkdirSync(distDir, { recursive: true });

console.log('[build:agent] Bundling scripts/rep-agent.mjs …');
await esbuild.build({
  entryPoints: [path.join(__dirname, 'rep-agent.mjs')],
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'cjs',
  outfile: bundlePath,
  sourcemap: false,
  logLevel: 'info',
});

console.log('[build:agent] pkg → dist/rep-agent.exe …');
execSync(
  `npx pkg "${bundlePath}" --targets node18-win-x64 --output "${exePath}"`,
  { cwd: root, stdio: 'inherit', shell: true }
);

if (!existsSync(exePath)) {
  console.error('[build:agent] Falha: dist/rep-agent.exe não foi gerado.');
  process.exit(1);
}

console.log(`[build:agent] OK: ${exePath}`);
