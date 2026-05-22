#!/usr/bin/env node
/**
 * Empacota o agente REP em dist/rep-agent.exe (esbuild bundle CJS + pkg).
 * `pkg .` no monorepo React puxa dependências do frontend — este script isola só o agente.
 */
import { execSync } from 'node:child_process';
import { mkdirSync, existsSync, unlinkSync, renameSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const distDir = path.join(root, 'dist');
const bundlePath = path.join(distDir, 'rep-agent-bundle.cjs');
const exePath = path.join(distDir, 'rep-agent.exe');
const exeStagingPath = path.join(distDir, 'rep-agent.staging.exe');

mkdirSync(distDir, { recursive: true });

const buildId = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

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
  define: {
    __REP_AGENT_BUILD_ID__: JSON.stringify(buildId),
  },
});

console.log('[build:agent] pkg → dist/rep-agent.staging.exe …');
execSync(
  `npx pkg "${bundlePath}" --targets node18-win-x64 --output "${exeStagingPath}"`,
  { cwd: root, stdio: 'inherit', shell: true }
);

if (!existsSync(exeStagingPath)) {
  console.error('[build:agent] Falha: staging exe não foi gerado.');
  process.exit(1);
}

try {
  if (existsSync(exePath)) unlinkSync(exePath);
  renameSync(exeStagingPath, exePath);
  console.log(`[build:agent] OK: ${exePath} (build=${buildId})`);
} catch (e) {
  console.warn(
    `[build:agent] Não foi possível substituir rep-agent.exe (${e?.message || e}). ` +
      `Use dist/rep-agent.staging.exe — pare o serviço PontoWebDeskAgent e copie como Administrador.`
  );
  console.log(`[build:agent] OK: ${exeStagingPath} (build=${buildId})`);
}
