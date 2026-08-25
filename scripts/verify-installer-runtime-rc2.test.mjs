/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { STAGING_CRITICAL_FILES } from './rc2-professional-paths.mjs';
import { REQUIRED_BIN } from '../rc2/database-runtime-builder/dist/constants.js';
import { buildManifestFromTree, writeManifest } from '../rc2/database-runtime-builder/dist/manifest.js';

const SCRIPTS_DIR = path.dirname(fileURLToPath(import.meta.url));
const VERIFY_SCRIPT = path.join(SCRIPTS_DIR, 'verify-installer-runtime-rc2.mjs');

function seedValidDatabaseRuntime(stagingRoot) {
  const db = path.join(stagingRoot, 'Database');
  fs.mkdirSync(path.join(db, 'bin'), { recursive: true });
  fs.mkdirSync(path.join(db, 'lib'), { recursive: true });
  fs.mkdirSync(path.join(db, 'share'), { recursive: true });

  for (const bin of REQUIRED_BIN) {
    fs.writeFileSync(path.join(db, 'bin', bin), `fake-${bin}`);
  }
  fs.writeFileSync(path.join(db, 'lib', 'placeholder.dll'), 'dll');
  fs.writeFileSync(path.join(db, 'share', 'postgresql.conf.sample'), '# sample');
  fs.writeFileSync(path.join(db, 'VERSION'), '16.8\n');

  const manifest = buildManifestFromTree(db, '16.8');
  writeManifest(db, manifest);
}

function runVerify(stagingDir) {
  const r = spawnSync(process.execPath, [VERIFY_SCRIPT], {
    env: { ...process.env, RC2_STAGING_DIR: stagingDir },
    encoding: 'utf8',
  });
  return { ...r, out: `${r.stdout ?? ''}${r.stderr ?? ''}`.trim() };
}

describe('verify-installer-runtime-rc2', () => {
  it('falha quando staging vazio', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pwd-verify-empty-'));
    const r = runVerify(tmp);
    expect(r.status).toBe(1);
    const doc = JSON.parse(r.out);
    expect(doc.ok).toBe(false);
    expect(doc.errorCount).toBeGreaterThan(0);
  });

  it('falha quando falta Bootstrap/dist/index.js', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pwd-verify-partial-'));
    for (const rel of STAGING_CRITICAL_FILES) {
      if (rel === 'Bootstrap/dist/index.js') continue;
      const abs = path.join(tmp, rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      if (rel.endsWith('.exe')) fs.writeFileSync(abs, Buffer.alloc(0));
      else if (rel === 'layout.manifest.json') {
        fs.writeFileSync(abs, `${JSON.stringify({ components: {} })}\n`, 'utf8');
      } else {
        fs.writeFileSync(abs, 'ok', 'utf8');
      }
    }
    const r = runVerify(tmp);
    expect(r.status).toBe(1);
    expect(r.out).toContain('Bootstrap/dist/index.js');
  });

  it('passa quando todos os arquivos criticos existem', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pwd-verify-ok-'));
    seedValidDatabaseRuntime(tmp);
    for (const rel of STAGING_CRITICAL_FILES) {
      if (rel.startsWith('Database/')) continue;
      const abs = path.join(tmp, rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      if (rel.endsWith('.exe')) fs.writeFileSync(abs, Buffer.alloc(0));
      else if (rel === 'layout.manifest.json') {
        fs.writeFileSync(abs, `${JSON.stringify({ components: {} })}\n`, 'utf8');
      } else {
        fs.writeFileSync(abs, 'ok', 'utf8');
      }
    }
    for (const dir of [
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
      'Migrations',
    ]) {
      fs.mkdirSync(path.join(tmp, dir), { recursive: true });
    }
    fs.writeFileSync(
      path.join(tmp, 'Config', 'expected-programdata.json'),
      `${JSON.stringify({ directories: { pgdata: 'Database/pgdata' } })}\n`,
      'utf8',
    );
    const r = runVerify(tmp);
    expect(r.status).toBe(0);
    expect(JSON.parse(r.out).ok).toBe(true);
  });
});
