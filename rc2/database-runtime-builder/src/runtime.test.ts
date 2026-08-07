import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FROZEN_MAJOR, FROZEN_MINOR, REQUIRED_BIN } from './constants.js';
import { assertSupportedSource, parsePostgresVersion, SourceVersionError } from './discoverSource.js';
import { buildRuntimeFromSource } from './builder.js';
import { buildManifestFromTree, writeManifest } from './manifest.js';
import { validateRuntime } from './validator.js';
import type { SourceInstallInfo } from './types.js';

function mkTempRuntime(partial: {
  bins?: Record<string, Buffer | string>;
  skip?: string[];
  corruptManifestHash?: boolean;
  extraFile?: boolean;
}): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pwd-db-runtime-'));
  fs.mkdirSync(path.join(root, 'bin'), { recursive: true });
  fs.mkdirSync(path.join(root, 'lib'), { recursive: true });
  fs.mkdirSync(path.join(root, 'share'), { recursive: true });
  fs.mkdirSync(path.join(root, 'locale'), { recursive: true });
  fs.mkdirSync(path.join(root, 'licenses'), { recursive: true });

  for (const bin of REQUIRED_BIN) {
    if (partial.skip?.includes(`bin/${bin}`)) continue;
    const content = partial.bins?.[bin] ?? `fake-${bin}`;
    fs.writeFileSync(path.join(root, 'bin', bin), content);
  }

  fs.writeFileSync(path.join(root, 'lib', 'placeholder.dll'), 'dll');
  fs.writeFileSync(path.join(root, 'share', 'postgresql.conf.sample'), '# sample');
  fs.writeFileSync(path.join(root, 'locale', 'pt_BR'), 'locale');
  fs.writeFileSync(path.join(root, 'licenses', 'COPYRIGHT'), 'PostgreSQL License');
  fs.writeFileSync(path.join(root, 'VERSION'), '16.8\n');

  const manifest = buildManifestFromTree(root, '16.8');
  if (partial.corruptManifestHash && manifest.files.length > 0) {
    manifest.files[0].sha256 = '0'.repeat(64);
  }
  writeManifest(root, manifest);

  if (partial.extraFile) {
    fs.writeFileSync(path.join(root, 'bin', 'extra.exe'), 'extra');
  }

  return root;
}

const temps: string[] = [];
afterEach(() => {
  for (const t of temps.splice(0)) {
    fs.rmSync(t, { recursive: true, force: true });
  }
});

describe('parsePostgresVersion', () => {
  it('interpreta saída padrão do postgres --version', () => {
    const p = parsePostgresVersion('postgres (PostgreSQL) 16.8');
    expect(p).toEqual({ major: 16, minor: 8, patch: 0, versionFull: '16.8' });
  });

  it('interpreta patch explícito', () => {
    const p = parsePostgresVersion('postgres (PostgreSQL) 16.8.1');
    expect(p?.versionFull).toBe('16.8.1');
  });
});

describe('assertSupportedSource', () => {
  it('aceita 16.8 quando lib existe', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pwd-pg-lib-'));
    temps.push(root);
    fs.mkdirSync(path.join(root, 'lib'));
    const info: SourceInstallInfo = {
      root,
      versionFull: '16.8',
      major: 16,
      minor: 8,
      patch: 0,
      postgresExe: path.join(root, 'bin', 'postgres.exe'),
    };
    expect(() => assertSupportedSource(info)).not.toThrow();
  });

  it('rejeita major 18', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pwd-pg-lib-'));
    temps.push(root);
    fs.mkdirSync(path.join(root, 'lib'));
    expect(() =>
      assertSupportedSource({
        root,
        major: 18,
        minor: 0,
        patch: 0,
        versionFull: '18.0',
        postgresExe: path.join(root, 'bin', 'postgres.exe'),
      }),
    ).toThrow(SourceVersionError);
  });

  it('rejeita minor 7', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pwd-pg-lib-'));
    temps.push(root);
    fs.mkdirSync(path.join(root, 'lib'));
    expect(() =>
      assertSupportedSource({
        root,
        major: 16,
        minor: 7,
        patch: 0,
        versionFull: '16.7',
        postgresExe: path.join(root, 'bin', 'postgres.exe'),
      }),
    ).toThrow(SourceVersionError);
  });
});

describe('validateRuntime', () => {
  it('PASS runtime válido completo', () => {
    const dir = mkTempRuntime({});
    temps.push(dir);
    const r = validateRuntime(dir);
    expect(r.ok).toBe(true);
    expect(r.errors).toHaveLength(0);
  });

  it('FAIL runtime incompleto (sem lib)', () => {
    const dir = mkTempRuntime({});
    temps.push(dir);
    fs.rmSync(path.join(dir, 'lib'), { recursive: true, force: true });
    const r = validateRuntime(dir);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes('lib'))).toBe(true);
  });

  it('FAIL postgres.exe ausente', () => {
    const dir = mkTempRuntime({ skip: ['bin/postgres.exe'] });
    temps.push(dir);
    const r = validateRuntime(dir);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes('postgres.exe'))).toBe(true);
  });

  it('FAIL manifesto inválido (JSON)', () => {
    const dir = mkTempRuntime({});
    temps.push(dir);
    fs.writeFileSync(path.join(dir, 'manifest.json'), '{ broken', 'utf8');
    const r = validateRuntime(dir);
    expect(r.ok).toBe(false);
  });

  it('FAIL hash divergente', () => {
    const dir = mkTempRuntime({ corruptManifestHash: true });
    temps.push(dir);
    const r = validateRuntime(dir);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes('SHA256'))).toBe(true);
  });

  it('FAIL arquivos extras (strict)', () => {
    const dir = mkTempRuntime({ extraFile: true });
    temps.push(dir);
    const r = validateRuntime(dir, { rejectExtraFiles: true });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes('extra'))).toBe(true);
  });
});

describe('buildRuntimeFromSource', () => {
  it('monta árvore mínima e valida', () => {
    const src = fs.mkdtempSync(path.join(os.tmpdir(), 'pwd-pg-src-'));
    temps.push(src);
    fs.mkdirSync(path.join(src, 'bin'), { recursive: true });
    fs.mkdirSync(path.join(src, 'lib'), { recursive: true });
    fs.mkdirSync(path.join(src, 'share'), { recursive: true });
    fs.mkdirSync(path.join(src, 'share', 'locale'), { recursive: true });
    fs.mkdirSync(path.join(src, 'doc'), { recursive: true });

    for (const b of REQUIRED_BIN) {
      fs.writeFileSync(path.join(src, 'bin', b), b);
    }
    fs.writeFileSync(path.join(src, 'bin', 'psql.exe'), 'psql');
    fs.writeFileSync(path.join(src, 'lib', 'x.dll'), 'x');
    fs.writeFileSync(path.join(src, 'share', 'pg'), 'x');
    fs.writeFileSync(path.join(src, 'share', 'locale', 'pt'), 'x');
    fs.writeFileSync(path.join(src, 'doc', 'COPYRIGHT'), 'c');

    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'pwd-pg-out-'));
    temps.push(out);

    const report = buildRuntimeFromSource(
      {
        root: src,
        versionFull: '16.8',
        major: 16,
        minor: 8,
        patch: 0,
        postgresExe: path.join(src, 'bin', 'postgres.exe'),
      },
      { outputDir: out, clean: false },
    );

    expect(report.ok).toBe(true);
    expect(fs.existsSync(path.join(out, 'bin', 'postgres.exe'))).toBe(true);
    expect(fs.existsSync(path.join(out, 'tools', 'psql.exe'))).toBe(true);
    expect(fs.readFileSync(path.join(out, 'VERSION'), 'utf8').trim()).toBe('16.8');
  });
});

describe('manifest', () => {
  it('inclui sha256 e metadados por arquivo', () => {
    const dir = mkTempRuntime({});
    temps.push(dir);
    const m = buildManifestFromTree(dir, '16.8');
    const pg = m.files.find((f) => f.path === 'bin/postgres.exe');
    expect(pg?.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(pg?.data).toBeTruthy();
    expect(pg?.versao).toBe('16.8');
    expect(pg?.category).toBe('bin');
  });
});

describe('versão congelada', () => {
  it('constantes RC2.2.5', () => {
    expect(FROZEN_MAJOR).toBe(16);
    expect(FROZEN_MINOR).toBe(8);
  });
});
