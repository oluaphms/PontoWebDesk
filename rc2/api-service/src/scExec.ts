import { spawnSync } from 'node:child_process';

export interface ScExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export type ScExecutor = (args: string[]) => ScExecResult;

/** sc.exe exige espaço depois de `=` — chave e valor em argv separados. */
export function scQuote(value: string): string {
  if (value.startsWith('"') && value.endsWith('"')) return value;
  if (/[\s&<>^|]/.test(value)) return `"${value.replace(/"/g, '\\"')}"`;
  return value;
}

export function scOpt(key: string, value: string): [string, string] {
  return [`${key}=`, scQuote(value)];
}

/**
 * Valor de binPath= quando o serviço é `node.exe script.js`.
 * sc.exe trata o primeiro trecho entre aspas como o exe; aspas internas
 * precisam ser escapadas para ImagePath ficar `"node.exe" "script.js"`.
 */
export function scBinPathValue(executable: string, script: string): string {
  return `"\\"${executable}\\" \\"${script}\\""`;
}

export function scCreateArgs(
  serviceName: string,
  binPathValue: string,
  displayName: string,
  startType: string,
): string[] {
  return [
    'create',
    serviceName,
    ...scOpt('binPath', binPathValue),
    ...scOpt('DisplayName', displayName),
    ...scOpt('start', startType),
  ];
}

export function defaultScExecutor(): ScExecutor {
  return (args: string[]) => {
    const r = spawnSync('sc.exe', args, {
      encoding: 'utf8',
      windowsHide: true,
      shell: false,
      windowsVerbatimArguments: true,
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
