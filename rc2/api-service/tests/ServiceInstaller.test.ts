import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { ServiceInstaller } from '../src/ServiceInstaller.js';
import { SERVICE_NAME, defaultApiServicePaths } from '../src/ServiceConfig.js';
import { mockApiServicePaths } from './helpers/mockApiServicePaths.js';

describe('ServiceInstaller', () => {
  it('uninstall ok quando ausente', () => {
    const sc = (args: string[]) =>
      args[0] === 'query'
        ? { exitCode: 1, stdout: '1060', stderr: '' }
        : { exitCode: 0, stdout: '', stderr: '' };
    const r = new ServiceInstaller(mockApiServicePaths(), sc).uninstall();
    expect(r.message).toBe('NOT_INSTALLED');
  });

  it('install chama sc create', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pwd-svc-'));
    const paths = mockApiServicePaths({
      binDir: path.join(root, 'Bin'),
      serviceHostScript: path.join(root, 'Bin', 'host.js'),
      nodeExecutable: path.join(root, 'node.exe'),
      backendEntry: path.join(root, 'server.js'),
      programFilesRoot: root,
      configDir: path.join(root, 'Config'),
      logsDir: path.join(root, 'Logs'),
      backendEnvFile: path.join(root, 'Config', 'backend.env'),
    });
    fs.mkdirSync(paths.binDir, { recursive: true });
    fs.mkdirSync(paths.configDir, { recursive: true });
    fs.mkdirSync(paths.logsDir, { recursive: true });
    fs.writeFileSync(path.join(paths.binDir, 'PontoWebDeskServiceHost.exe'), 'exe', 'utf8');
    fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
    fs.writeFileSync(path.join(root, 'dist', 'serviceHost.js'), '// host', 'utf8');
    const calls: string[][] = [];
    const sc = (args: string[]) => {
      calls.push(args);
      if (args[0] === 'query') return { exitCode: 1, stdout: '1060', stderr: '' };
      return { exitCode: 0, stdout: '', stderr: '' };
    };
    const inst = new ServiceInstaller(paths, sc);
    vi.spyOn(inst, 'writeServiceHostFromDist').mockImplementation(() => {
      fs.writeFileSync(paths.serviceHostScript, '// host', 'utf8');
    });
    const r = inst.install();
    expect(r.ok).toBe(true);
    expect(calls.some((c) => c[0] === 'create' && c[1] === SERVICE_NAME)).toBe(true);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('isInstalled detecta query ok', () => {
    const sc = (args: string[]) =>
      args[0] === 'query'
        ? { exitCode: 0, stdout: 'RUNNING', stderr: '' }
        : { exitCode: 0, stdout: '', stderr: '' };
    const inst = new ServiceInstaller(mockApiServicePaths(), sc);
    expect(inst.isInstalled()).toBe(true);
  });

  it('uninstall chama sc delete', () => {
    const calls: string[][] = [];
    const sc = (args: string[]) => {
      calls.push(args);
      return { exitCode: 0, stdout: '', stderr: '' };
    };
    const inst = new ServiceInstaller(mockApiServicePaths(), sc);
    inst.uninstall();
    expect(calls.some((c) => c[0] === 'delete')).toBe(true);
  });
});
