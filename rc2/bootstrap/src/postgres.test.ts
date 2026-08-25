import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Bootstrap } from './Bootstrap.js';
import { SecretsStore } from './postgres/SecretsStore.js';
import { isPortFree } from './postgres/PostgresPortCheck.js';
import { PostgresInstallOrchestrator } from './postgres/PostgresInstallOrchestrator.js';
import { Logger } from './Logger.js';
import { InstallationContext } from '@pontowebdesk/api-runtime';
import { toBootstrapPaths } from './runtime/bootstrapPaths.js';
import { writeInstalledLayoutFixture } from '../tests/layoutFixture.js';

describe('SecretsStore', () => {
  it('generates and loads secrets', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pwd-sec-'));
    const store = new SecretsStore(path.join(tmp, 'secrets.json'));
    const doc = store.loadOrCreate(55432);
    expect(doc.port).toBe(55432);
    expect(store.load()?.pontowebAppPassword).toBe(doc.pontowebAppPassword);
  });
});

describe('PostgresPortCheck', () => {
  it('checks local port', async () => {
    const free = await isPortFree(0);
    expect(typeof free).toBe('boolean');
  });
});

describe('Embedded PG stub pipeline', () => {
  it('runs PG steps in stub mode on win32', async () => {
    if (os.platform() !== 'win32') return;
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pwd-rc2-emb-'));
    const installRoot = path.join(tmp, 'PF', 'PontoWebDesk');
    const programDataRoot = path.join(tmp, 'PD', 'PontoWebDesk');
    writeInstalledLayoutFixture({ installRoot, programDataRoot, touchFiles: true });
    const bootstrap = new Bootstrap({
      programFilesRoot: installRoot,
      programDataRoot,
      embeddedPostgres: true,
      postgresStub: true,
      apiServiceStub: true,
      frontendServiceStub: true,
    });
    const result = await bootstrap.runEmbeddedInstall();
    expect(result.ok).toBe(true);
    expect(result.finalState).toBe('INSTALLED');
  });
});

describe('PostgresInstallOrchestrator stub', () => {
  it('invokes stub without binaries', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pwd-pg-stub-'));
    const installRoot = path.join(tmp, 'PontoWebDesk');
    const programDataRoot = path.join(tmp, 'PD', 'PontoWebDesk');
    writeInstalledLayoutFixture({ installRoot, programDataRoot });
    const ctx = InstallationContext.load({ programFilesRoot: installRoot, programDataRoot });
    const paths = toBootstrapPaths(ctx.paths);
    const log = new Logger({ logDir: os.tmpdir(), component: 'test' });
    const orch = new PostgresInstallOrchestrator(paths, log, { stub: true });
    await orch.runStep('install_postgresql');
    await orch.runStep('create_database');
  });
});
