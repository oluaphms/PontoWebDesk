import { spawnSync } from 'node:child_process';

export interface ScExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export type ScExecutor = (args: string[]) => ScExecResult;

export function defaultScExecutor(): ScExecutor {
  return (args: string[]) => {
    const r = spawnSync('sc', args, {
      encoding: 'utf8',
      windowsHide: true,
      shell: process.platform === 'win32',
    });
    return {
      exitCode: r.status ?? 1,
      stdout: (r.stdout ?? '').toString(),
      stderr: (r.stderr ?? '').toString(),
    };
  };
}

export function netExecutor(action: 'start' | 'stop', serviceName: string): ScExecResult {
  const r = spawnSync('net', [action, serviceName], {
    encoding: 'utf8',
    windowsHide: true,
    shell: process.platform === 'win32',
  });
  return {
    exitCode: r.status ?? 1,
    stdout: (r.stdout ?? '').toString(),
    stderr: (r.stderr ?? '').toString(),
  };
}

export function parseScQueryState(stdout: string): string | null {
  const m = /STATE\s*:\s*\d+\s+(\w+)/i.exec(stdout);
  if (m) return m[1]?.toUpperCase() ?? null;
  if (/\bRUNNING\b/i.test(stdout)) return 'RUNNING';
  if (/\bSTOPPED\b/i.test(stdout)) return 'STOPPED';
  return null;
}
