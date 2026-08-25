import { spawn } from 'node:child_process';
import path from 'node:path';

/** psql.exe em Database\\tools depende de DLLs em Database\\bin no PATH (Windows). */
export function pgProcessEnv(binDir: string, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const pathKey = process.platform === 'win32' ? 'Path' : 'PATH';
  const current = process.env[pathKey] ?? process.env.PATH ?? '';
  return { ...process.env, ...extra, [pathKey]: `${binDir}${path.delimiter}${current}` };
}

export interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export function execFileAsync(
  command: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number } = {},
): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (d: Buffer) => {
      stdout += d.toString();
    });
    child.stderr?.on('data', (d: Buffer) => {
      stderr += d.toString();
    });
    const timer =
      options.timeoutMs != null
        ? setTimeout(() => {
            child.kill();
            reject(new Error(`EXEC_TIMEOUT: ${command}`));
          }, options.timeoutMs)
        : undefined;
    child.on('error', reject);
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      resolve({ exitCode: code ?? 1, stdout, stderr });
    });
  });
}
