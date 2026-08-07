import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  InstallationContext,
  LayoutResolver,
  RuntimePathResolver,
} from '@pontowebdesk/api-runtime';
import { BootstrapDoctor } from '../src/runtime/BootstrapDoctor.js';
import { minimalLayoutManifest, writeInstalledLayoutFixture } from './layoutFixture.js';

describe('LayoutResolver', () => {
  it('loads layout.manifest.json', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pwd-layout-'));
    const installRoot = path.join(tmp, 'PontoWebDesk');
    writeInstalledLayoutFixture({ installRoot, programDataRoot: path.join(tmp, 'PD') });
    const m = new LayoutResolver(installRoot).load();
    expect(m.productName).toContain('PontoWebDesk');
    expect(m.components.database.path).toBe('Database');
  });

  it('throws when manifest missing', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pwd-noman-'));
    expect(() => new LayoutResolver(tmp).load()).toThrow(/LAYOUT_MANIFEST_MISSING/);
  });
});

describe('RuntimePathResolver', () => {
  it('derives database bin from manifest component', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pwd-resolver-'));
    const installRoot = path.join(tmp, 'PF', 'PontoWebDesk');
    const pd = path.join(tmp, 'PD', 'PontoWebDesk');
    const manifest = minimalLayoutManifest();
    writeInstalledLayoutFixture({ installRoot, programDataRoot: pd });
    const resolver = RuntimePathResolver.fromManifest(installRoot, pd, manifest);
    const p = resolver.resolve();
    expect(p.databaseBinDir.endsWith(path.join('Database', 'bin'))).toBe(true);
    expect(p.migrationsDir.endsWith('Migrations')).toBe(true);
    expect(p.installRoot).toBe(installRoot);
    expect(p.pgdataDir).toContain('pgdata');
  });
});

describe('InstallationContext', () => {
  it('loads version from manifest', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pwd-ctx-'));
    const installRoot = path.join(tmp, 'PontoWebDesk');
    const pd = path.join(tmp, 'ProgramData', 'PontoWebDesk');
    writeInstalledLayoutFixture({ installRoot, programDataRoot: pd });
    const ctx = InstallationContext.load({ programFilesRoot: installRoot, programDataRoot: pd });
    expect(ctx.version).toBe('0.0.0-test');
    expect(ctx.paths.secretsFile).toContain('secrets.json');
  });
});

describe('BootstrapDoctor', () => {
  it('passes when required layout files exist', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pwd-doc-'));
    const installRoot = path.join(tmp, 'PontoWebDesk');
    const pd = path.join(tmp, 'ProgramData', 'PontoWebDesk');
    writeInstalledLayoutFixture({ installRoot, programDataRoot: pd, touchFiles: true });
    const ctx = InstallationContext.load({ programFilesRoot: installRoot, programDataRoot: pd });
    const report = new BootstrapDoctor(ctx).run();
    expect(report.ok).toBe(true);
    expect(report.checks.some((c) => c.id === 'database.pgdata.layout' && c.ok)).toBe(true);
  });
});
