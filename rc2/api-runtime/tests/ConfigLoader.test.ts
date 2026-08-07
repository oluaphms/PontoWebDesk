import { describe, expect, it } from 'vitest';
import { ConfigLoader, parseEnvFile } from '../src/ConfigLoader.ts';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createTempLayout } from './helpers/tempLayout.js';

describe('parseEnvFile', () => {
  it('ignora comentários e linhas vazias', () => {
    const m = parseEnvFile('# x\n\nFOO=bar\n');
    expect(m.FOO).toBe('bar');
  });

  it('remove aspas', () => {
    expect(parseEnvFile('X="y"').X).toBe('y');
  });
});

describe('ConfigLoader', () => {
  it('load lê backend.env', () => {
    const { paths, cleanup } = createTempLayout();
    try {
      const l = ConfigLoader.fromPaths(paths);
      expect(l.load().PGHOST).toBe('127.0.0.1');
    } finally {
      cleanup();
    }
  });

  it('load lança se ausente', () => {
    const { paths, cleanup } = createTempLayout({ withEnv: false });
    try {
      expect(() => ConfigLoader.fromPaths(paths).load()).toThrow(/BACKEND_ENV_MISSING/);
    } finally {
      cleanup();
    }
  });

  it('loadIfPresent retorna null', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pwd-env-'));
    const loader = new ConfigLoader(path.join(dir, 'missing.env'));
    expect(loader.loadIfPresent()).toBeNull();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
