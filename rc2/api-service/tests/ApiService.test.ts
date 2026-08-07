import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildServiceBinPath, SERVICE_DISPLAY_NAME, SERVICE_NAME, defaultApiServicePaths } from '../src/ServiceConfig.js';
import { mockApiServicePaths } from './helpers/mockApiServicePaths.js';
import { ApiService } from '../src/ApiService.js';
import { ServiceController } from '../src/ServiceController.js';
import { createBootstrapBackendInstall } from '../src/bootstrapBridge.js';
import type { ResolvedRuntimePaths } from '@pontowebdesk/api-runtime';
import { writeInstalledLayoutFixture } from '../../bootstrap/tests/layoutFixture.js';

function sampleResolvedPaths(overrides: Partial<ResolvedRuntimePaths> = {}): ResolvedRuntimePaths {
  const base: ResolvedRuntimePaths = {
    installRoot: 'C:\\pf',
    programDataRoot: 'C:\\pd',
    installStateFile: 'C:\\pd\\install-state.json',
    logsDir: 'C:\\pd\\Logs',
    configDir: 'C:\\pd\\Config',
    storageDir: 'C:\\pd\\Storage',
    binDir: 'C:\\pf\\Bin',
    backendRoot: 'C:\\pf\\Backend',
    backendEntry: 'C:\\pf\\Backend\\server\\dist\\server.js',
    nodeExecutable: 'C:\\pf\\Backend\\node\\node.exe',
    frontendWwwDir: 'C:\\pf\\Frontend\\www',
    databaseRoot: 'C:\\pf\\Database',
    databaseBinDir: 'C:\\pf\\Database\\bin',
    databaseToolsDir: 'C:\\pf\\Database\\tools',
    pgdataDir: 'C:\\pd\\Database\\pgdata',
    backendEnvFile: 'C:\\pd\\Config\\backend.env',
    secretsFile: 'C:\\pd\\Config\\secrets.json',
    migrationsDir: 'C:\\pf\\Migrations',
    migrateScriptPath: 'C:\\pf\\Bin\\apply-installed-database.mjs',
    serviceHostScript: 'C:\\pf\\Bin\\api-service-host.js',
    layoutManifestFile: 'C:\\pf\\layout.manifest.json',
    agentRepExe: 'C:\\pf\\Agent\\rep-agent.exe',
  };
  return { ...base, ...overrides };
}

describe('ServiceConfig', () => {
  it('buildServiceBinPath inclui node e host', () => {
    const p = mockApiServicePaths({
      nodeExecutable: 'C:\\pf\\Backend\\node\\node.exe',
      serviceHostScript: 'C:\\pf\\Bin\\api-service-host.js',
    });
    const bin = buildServiceBinPath(p);
    expect(bin).toContain('node.exe');
    expect(bin).toContain('api-service-host.js');
  });

  it('resolve paths from layout.manifest when roots provided', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pwd-api-svc-'));
    const installRoot = path.join(tmp, 'PontoWebDesk');
    const pd = path.join(tmp, 'PD', 'PontoWebDesk');
    writeInstalledLayoutFixture({ installRoot, programDataRoot: pd });
    const p = defaultApiServicePaths({ programFilesRoot: installRoot, programDataRoot: pd });
    expect(p.binDir).toContain('Bin');
    expect(p.backendEntry).toContain('server.js');
  });

  it('metadados SCM', () => {
    expect(SERVICE_NAME).toBe('PontoWebDeskApi');
    expect(SERVICE_DISPLAY_NAME).toBe('PontoWebDesk API');
  });
});

describe('ApiService', () => {
  it('expõe installer controller recovery validator', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pwd-api-svc2-'));
    const installRoot = path.join(tmp, 'PontoWebDesk');
    const pd = path.join(tmp, 'PD', 'PontoWebDesk');
    writeInstalledLayoutFixture({ installRoot, programDataRoot: pd });
    const svc = new ApiService({
      paths: defaultApiServicePaths({ programFilesRoot: installRoot, programDataRoot: pd }),
    });
    expect(svc.installer).toBeDefined();
    expect(svc.controller).toBeDefined();
    expect(svc.recovery).toBeDefined();
    expect(svc.validator).toBeDefined();
  });

  it('status via controller', () => {
    const sc = () => ({ exitCode: 0, stdout: 'RUNNING', stderr: '' });
    const svc = new ApiService({ paths: mockApiServicePaths() });
    const ctrl = new ServiceController(sc);
    expect(ctrl.query().installed).toBe(true);
  });
});

describe('bootstrapBridge', () => {
  it('createBootstrapBackendInstall', () => {
    const port = createBootstrapBackendInstall(sampleResolvedPaths());
    expect(typeof port.installBackend).toBe('function');
    expect(typeof port.validateHealth).toBe('function');
  });
});
