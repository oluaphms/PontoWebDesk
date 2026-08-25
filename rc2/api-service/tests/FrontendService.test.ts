import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import { FrontendServiceInstaller } from '../src/frontend/FrontendServiceInstaller.js';
import { FrontendServiceController } from '../src/frontend/FrontendServiceController.js';
import { FrontendServiceRecovery } from '../src/frontend/FrontendServiceRecovery.js';
import { FrontendServiceValidator } from '../src/frontend/FrontendServiceValidator.js';
import { FrontendService } from '../src/frontend/FrontendService.js';
import {
  FRONTEND_SERVICE_NAME,
  buildFrontendServiceBinPath,
} from '../src/frontend/FrontendServiceConfig.js';
import { mockFrontendServicePaths } from './helpers/mockFrontendServicePaths.js';
import { createBootstrapFrontendInstall } from '../src/frontend/bootstrapBridgeFrontend.js';
import type { ResolvedRuntimePaths } from '@pontowebdesk/api-runtime';

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

function layoutFixture(root: string): FrontendServicePaths {
  const installRoot = path.join(root, 'PontoWebDesk');
  const pd = path.join(root, 'PD', 'PontoWebDesk');
  fs.mkdirSync(path.join(installRoot, 'Frontend', 'www'), { recursive: true });
  fs.mkdirSync(path.join(installRoot, 'Bin'), { recursive: true });
  fs.mkdirSync(path.join(installRoot, 'Backend', 'node'), { recursive: true });
  fs.mkdirSync(path.join(pd, 'Config'), { recursive: true });
  fs.mkdirSync(path.join(pd, 'Logs'), { recursive: true });
  fs.writeFileSync(path.join(installRoot, 'Frontend', 'www', 'index.html'), '<html></html>', 'utf8');
  fs.writeFileSync(path.join(installRoot, 'Bin', 'serve-frontend.mjs'), '// serve', 'utf8');
  fs.writeFileSync(path.join(installRoot, 'Bin', 'PontoWebDeskServiceHost.exe'), 'exe', 'utf8');
  fs.writeFileSync(path.join(installRoot, 'Backend', 'node', 'node.exe'), '', 'utf8');
  return mockFrontendServicePaths({
    programFilesRoot: installRoot,
    programDataRoot: pd,
    binDir: path.join(installRoot, 'Bin'),
    frontendServeScript: path.join(installRoot, 'Bin', 'serve-frontend.mjs'),
    frontendWwwDir: path.join(installRoot, 'Frontend', 'www'),
    nodeExecutable: path.join(installRoot, 'Backend', 'node', 'node.exe'),
    configDir: path.join(pd, 'Config'),
    logsDir: path.join(pd, 'Logs'),
    runtimeConfigFile: path.join(pd, 'Config', 'frontend-service.json'),
    frontendServiceLogFile: path.join(pd, 'Logs', 'frontend-service.log'),
  });
}

describe('FrontendServiceInstaller', () => {
  it('install chama sc create com binPath node + serve-frontend.mjs', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pwd-fe-svc-'));
    const paths = layoutFixture(root);
    const calls: string[][] = [];
    const sc = (args: string[]) => {
      calls.push(args);
      if (args[0] === 'query') return { exitCode: 1, stdout: '1060', stderr: '' };
      return { exitCode: 0, stdout: '', stderr: '' };
    };
    const inst = new FrontendServiceInstaller(paths, sc);
    const r = inst.install();
    expect(r.ok).toBe(true);
    expect(calls.some((c) => c[0] === 'create' && c[1] === FRONTEND_SERVICE_NAME)).toBe(true);
    expect(fs.existsSync(paths.runtimeConfigFile)).toBe(true);
    const bin = buildFrontendServiceBinPath(paths);
    const createArgs = calls.find((c) => c[0] === 'create') ?? [];
    expect(createArgs).toContain('binPath=');
    expect(createArgs.join(' ')).toContain('PontoWebDeskServiceHost.exe');
    expect(bin).toContain('node.exe');
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('uninstall ok quando ausente', () => {
    const sc = (args: string[]) =>
      args[0] === 'query'
        ? { exitCode: 1, stdout: '1060', stderr: '' }
        : { exitCode: 0, stdout: '', stderr: '' };
    const r = new FrontendServiceInstaller(mockFrontendServicePaths(), sc).uninstall();
    expect(r.message).toBe('NOT_INSTALLED');
  });
});

describe('FrontendServiceController lifecycle', () => {
  it('start/stop/uninstall via sc mock (sem net)', () => {
    let installed = true;
    const sc = (args: string[]) => {
      if (args[0] === 'query') {
        if (!installed) return { exitCode: 1, stdout: '1060', stderr: '' };
        return { exitCode: 0, stdout: 'STATE : 4 RUNNING', stderr: '' };
      }
      if (args[0] === 'delete') installed = false;
      return { exitCode: 0, stdout: '', stderr: '' };
    };
    const ctrl = new FrontendServiceController(sc);
    expect(ctrl.start().message).toBe('ALREADY_RUNNING');
    expect(ctrl.query().state).toBe('RUNNING');
    const inst = new FrontendServiceInstaller(mockFrontendServicePaths(), sc);
    expect(inst.uninstall().ok).toBe(true);
    expect(ctrl.query().installed).toBe(false);
  });
});

describe('FrontendServiceRecovery', () => {
  it('configura failure reset 86400', () => {
    const calls: string[][] = [];
    const sc = (args: string[]) => {
      calls.push(args);
      return { exitCode: 0, stdout: '', stderr: '' };
    };
    const r = new FrontendServiceRecovery(sc).configure();
    expect(r.ok).toBe(true);
    const failure = calls.find((c) => c[0] === 'failure');
    expect(failure?.join(' ')).toMatch(/86400/);
    expect(failure?.join(' ')).toMatch(/restart\/5000/);
  });
});

describe('FrontendServiceValidator health', () => {
  it('valida TCP e HTTP 200 com servidor real', async () => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200);
      res.end('ok');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const addr = server.address();
    if (!addr || typeof addr === 'string') throw new Error('no address');
    const port = addr.port;

    const sc = (args: string[]) =>
      args[0] === 'query'
        ? { exitCode: 0, stdout: 'STATE : 4 RUNNING', stderr: '' }
        : { exitCode: 0, stdout: '', stderr: '' };

    const v = await new FrontendServiceValidator(sc, mockFrontendServicePaths(), {
      host: '127.0.0.1',
      port,
      waitTimeoutMs: 5000,
    }).validateOnce();

    expect(v.checks.tcp_3010).toBe(true);
    expect(v.checks.http_root_200).toBe(true);
    expect(v.ok).toBe(true);
    server.close();
  });
});

describe('FrontendService installAndStart', () => {
  it('rollback uninstall quando validação falha', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pwd-fe-roll-'));
    const paths = layoutFixture(root);
    let installed = false;
    const calls: string[][] = [];
    const sc = (args: string[]) => {
      calls.push(args);
      if (args[0] === 'query') {
        if (!installed) return { exitCode: 1, stdout: '1060', stderr: '' };
        return { exitCode: 0, stdout: 'STATE : 4 RUNNING', stderr: '' };
      }
      if (args[0] === 'create') installed = true;
      if (args[0] === 'delete') installed = false;
      return { exitCode: 0, stdout: '', stderr: '' };
    };
    const svc = new FrontendService(paths, sc);
    vi.spyOn(svc.validator, 'validate').mockResolvedValue({
      ok: false,
      errors: ['mock fail'],
      checks: {},
    });
    const r = await svc.installAndStart();
    expect(r.ok).toBe(false);
    expect(calls.some((c) => c[0] === 'delete')).toBe(true);
    fs.rmSync(root, { recursive: true, force: true });
    vi.restoreAllMocks();
  });
});

describe('bootstrapBridgeFrontend', () => {
  it('createBootstrapFrontendInstall', () => {
    const port = createBootstrapFrontendInstall(sampleResolvedPaths());
    expect(typeof port.installFrontend).toBe('function');
    expect(typeof port.validateFrontend).toBe('function');
    expect(typeof port.rollbackFrontend).toBe('function');
  });
});
