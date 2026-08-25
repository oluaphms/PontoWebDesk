import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FROZEN_MAJOR, FROZEN_MINOR, FROZEN_VERSION, REQUIRED_BIN } from './constants.js';
import {
  assertSupportedSource,
  parsePostgresVersion,
  SourceValidationError,
  validatePostgreSqlSourceRoot,
} from './discoverSource.js';
import { isAmd64Pe, readPeMachineType } from './peUtil.js';
import { buildRuntimeFromSource } from './builder.js';
import { buildManifestFromTree, writeManifest } from './manifest.js';
import { validateRuntime } from './validator.js';
import type { SourceInstallInfo } from './types.js';

/** Cabeçalho PE mínimo AMD64 para testes de arquitetura. */
function writeMinimalPe64(filePath: string): void {
  const buf = Buffer.alloc(0x100);
  buf.writeUInt16LE(0x5a4d, 0);
  buf.writeUInt32LE(0x80, 0x3c);
  buf.writeUInt32LE(0x00004550, 0x80);
  buf.writeUInt16LE(0x8664, 0x84);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, buf);
}

function writeMinimalPe32(filePath: string): void {
  const buf = Buffer.alloc(0x100);
  buf.writeUInt16LE(0x5a4d, 0);
  buf.writeUInt32LE(0x80, 0x3c);
  buf.writeUInt32LE(0x00004550, 0x80);
  buf.writeUInt16LE(0x014c, 0x84);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, buf);
}

function mkValidSourceRoot(partial?: {
  skipBin?: string;
  skipLib?: boolean;
  skipShare?: boolean;
  emptyLib?: boolean;
  emptyShare?: boolean;
  arch?: 'x64' | 'x86';
  versionLine?: string;
}): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pwd-pg-src-valid-'));
  temps.push(root);
  fs.mkdirSync(path.join(root, 'bin'), { recursive: true });

  const writePe = partial?.arch === 'x86' ? writeMinimalPe32 : writeMinimalPe64;
  for (const bin of ['postgres.exe', 'pg_ctl.exe', 'initdb.exe'] as const) {
    if (partial?.skipBin === bin) continue;
    writePe(path.join(root, 'bin', bin));
  }

  if (!partial?.skipLib) {
    fs.mkdirSync(path.join(root, 'lib'), { recursive: true });
    if (!partial?.emptyLib) fs.writeFileSync(path.join(root, 'lib', 'placeholder.dll'), 'dll');
  }
  if (!partial?.skipShare) {
    fs.mkdirSync(path.join(root, 'share'), { recursive: true });
    if (!partial?.emptyShare) {
      fs.writeFileSync(path.join(root, 'share', 'postgresql.conf.sample'), '# sample');
    }
  }

  return root;
}

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

describe('validatePostgreSqlSourceRoot', () => {
  it('aceita source válido PostgreSQL 16.8 x64', () => {
    const root = mkValidSourceRoot();
    const info = validatePostgreSqlSourceRoot(root, {
      versionLineOverride: 'postgres (PostgreSQL) 16.8',
    });
    expect(info.versionFull).toBe('16.8');
    expect(info.major).toBe(16);
    expect(info.minor).toBe(8);
    expect(info.patch).toBe(0);
  });

  it('FAIL source inexistente', () => {
    const missing = path.join(os.tmpdir(), 'pwd-pg-missing-' + Date.now());
    expect(() => validatePostgreSqlSourceRoot(missing)).toThrow(SourceValidationError);
    try {
      validatePostgreSqlSourceRoot(missing);
    } catch (e) {
      expect(e).toBeInstanceOf(SourceValidationError);
      const err = e as SourceValidationError;
      expect(err.check).toBe('SOURCE_DIR_MISSING');
      expect(err.analyzedPath).toBe(path.resolve(missing));
      expect(err.expected).toContain('existente');
    }
  });

  it('FAIL postgres.exe ausente', () => {
    const root = mkValidSourceRoot({ skipBin: 'postgres.exe' });
    expect(() =>
      validatePostgreSqlSourceRoot(root, { versionLineOverride: 'postgres (PostgreSQL) 16.8' }),
    ).toThrow(SourceValidationError);
    try {
      validatePostgreSqlSourceRoot(root, { versionLineOverride: 'postgres (PostgreSQL) 16.8' });
    } catch (e) {
      const err = e as SourceValidationError;
      expect(err.check).toBe('SOURCE_BIN_MISSING');
      expect(err.analyzedPath).toContain('postgres.exe');
    }
  });

  it('FAIL lib ausente', () => {
    const root = mkValidSourceRoot({ skipLib: true });
    expect(() =>
      validatePostgreSqlSourceRoot(root, { versionLineOverride: 'postgres (PostgreSQL) 16.8' }),
    ).toThrow(SourceValidationError);
    try {
      validatePostgreSqlSourceRoot(root, { versionLineOverride: 'postgres (PostgreSQL) 16.8' });
    } catch (e) {
      const err = e as SourceValidationError;
      expect(err.check).toBe('SOURCE_DIR_MISSING');
      expect(err.analyzedPath).toContain(`${path.sep}lib`);
    }
  });

  it('FAIL share ausente', () => {
    const root = mkValidSourceRoot({ skipShare: true });
    expect(() =>
      validatePostgreSqlSourceRoot(root, { versionLineOverride: 'postgres (PostgreSQL) 16.8' }),
    ).toThrow(SourceValidationError);
    try {
      validatePostgreSqlSourceRoot(root, { versionLineOverride: 'postgres (PostgreSQL) 16.8' });
    } catch (e) {
      const err = e as SourceValidationError;
      expect(err.check).toBe('SOURCE_DIR_MISSING');
      expect(err.analyzedPath).toContain(`${path.sep}share`);
    }
  });

  it('FAIL lib vazio', () => {
    const root = mkValidSourceRoot({ emptyLib: true });
    expect(() =>
      validatePostgreSqlSourceRoot(root, { versionLineOverride: 'postgres (PostgreSQL) 16.8' }),
    ).toThrow(SourceValidationError);
    try {
      validatePostgreSqlSourceRoot(root, { versionLineOverride: 'postgres (PostgreSQL) 16.8' });
    } catch (e) {
      expect((e as SourceValidationError).check).toBe('SOURCE_DIR_EMPTY');
    }
  });

  it('FAIL versão incompatível 16.14', () => {
    const root = mkValidSourceRoot();
    expect(() =>
      validatePostgreSqlSourceRoot(root, {
        versionLineOverride: 'postgres (PostgreSQL) 16.14',
      }),
    ).toThrow(SourceValidationError);
    try {
      validatePostgreSqlSourceRoot(root, { versionLineOverride: 'postgres (PostgreSQL) 16.14' });
    } catch (e) {
      const err = e as SourceValidationError;
      expect(err.check).toBe('SOURCE_VERSION_INCOMPATIBLE');
      expect(err.expected).toContain('16.8');
      expect(err.found).toBe('16.14');
    }
  });

  it('FAIL versão patch 16.8.1', () => {
    const root = mkValidSourceRoot();
    expect(() =>
      validatePostgreSqlSourceRoot(root, {
        versionLineOverride: 'postgres (PostgreSQL) 16.8.1',
      }),
    ).toThrow(SourceValidationError);
  });

  it('FAIL versão major 18', () => {
    const root = mkValidSourceRoot();
    expect(() =>
      validatePostgreSqlSourceRoot(root, {
        versionLineOverride: 'postgres (PostgreSQL) 18.0',
      }),
    ).toThrow(SourceValidationError);
  });

  it('FAIL arquitetura x86', () => {
    const root = mkValidSourceRoot({ arch: 'x86' });
    expect(() =>
      validatePostgreSqlSourceRoot(root, { versionLineOverride: 'postgres (PostgreSQL) 16.8' }),
    ).toThrow(SourceValidationError);
    try {
      validatePostgreSqlSourceRoot(root, { versionLineOverride: 'postgres (PostgreSQL) 16.8' });
    } catch (e) {
      const err = e as SourceValidationError;
      expect(err.check).toBe('SOURCE_ARCH_INCOMPATIBLE');
      expect(err.expected).toBe('x64');
      expect(err.found).toContain('x86');
    }
  });

  it('rejeita diretório data/ como source', () => {
    const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pwd-pg-data-'));
    temps.push(dataRoot);
    const dataDir = path.join(dataRoot, 'data');
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(path.join(dataDir, 'PG_VERSION'), '16\n');
    expect(() => validatePostgreSqlSourceRoot(dataDir)).toThrow(SourceValidationError);
    try {
      validatePostgreSqlSourceRoot(dataDir);
    } catch (e) {
      expect((e as SourceValidationError).check).toBe('SOURCE_IS_DATA_DIR');
    }
  });
});

describe('peUtil', () => {
  it('detecta PE AMD64', () => {
    const f = path.join(os.tmpdir(), `pwd-pe64-${Date.now()}.exe`);
    writeMinimalPe64(f);
    temps.push(f);
    expect(readPeMachineType(f)).toBe(0x8664);
    expect(isAmd64Pe(f)).toBe(true);
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
    ).toThrow(SourceValidationError);
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
    ).toThrow(SourceValidationError);
  });

  it('rejeita patch 16.8.1', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pwd-pg-lib-'));
    temps.push(root);
    fs.mkdirSync(path.join(root, 'lib'));
    expect(() =>
      assertSupportedSource({
        root,
        major: 16,
        minor: 8,
        patch: 1,
        versionFull: '16.8.1',
        postgresExe: path.join(root, 'bin', 'postgres.exe'),
      }),
    ).toThrow(SourceValidationError);
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
