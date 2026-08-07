import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ServiceInstaller } from '../src/ServiceInstaller.js';
import { mockApiServicePaths } from './helpers/mockApiServicePaths.js';

describe('ServiceInstaller extra', () => {
  it('install retorna ALREADY_INSTALLED', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pwd-svc-'));
    const paths = mockApiServicePaths({
      binDir: path.join(root, 'Bin'),
      serviceHostScript: path.join(root, 'Bin', 'host.js'),
      programFilesRoot: root,
    });
    const sc = (args: string[]) => {
      if (args[0] === 'query') return { exitCode: 0, stdout: 'OK', stderr: '' };
      return { exitCode: 0, stdout: '', stderr: '' };
    };
    const inst = new ServiceInstaller(paths, sc);
    const r = inst.install();
    expect(r.message).toBe('ALREADY_INSTALLED');
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('install falha em non-win32', () => {
    const platform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'linux' });
    const r = new ServiceInstaller(mockApiServicePaths(), () => ({
      exitCode: 0,
      stdout: '',
      stderr: '',
    })).install();
    Object.defineProperty(process, 'platform', { value: platform });
    expect(r.ok).toBe(false);
  });
});
