import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import type { EnvMap } from './ConfigLoader.js';
import type { ApiRuntimeLogger } from './Logger.js';
import type { ApiRuntimePaths } from './types.js';

export interface ProcessRunnerStartResult {
  ok: boolean;
  pid?: number;
  error?: string;
}

export class ProcessRunner {
  private child: ChildProcess | null = null;

  constructor(
    private readonly paths: ApiRuntimePaths,
    private readonly log: ApiRuntimeLogger,
  ) {}

  isRunning(): boolean {
    return this.child != null && this.child.exitCode == null && !this.child.killed;
  }

  getPid(): number | undefined {
    return this.child?.pid;
  }

  async start(env: EnvMap): Promise<ProcessRunnerStartResult> {
    if (this.isRunning()) {
      return { ok: false, error: 'PROCESS_ALREADY_RUNNING' };
    }

    if (!fs.existsSync(this.paths.backendEntry)) {
      return { ok: false, error: `BACKEND_ENTRY_MISSING: ${this.paths.backendEntry}` };
    }

    const nodeExe = fs.existsSync(this.paths.nodeExecutable)
      ? this.paths.nodeExecutable
      : process.execPath;

    this.child = spawn(nodeExe, [this.paths.backendEntry], {
      cwd: this.paths.backendRoot,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    this.child.stdout?.on('data', (chunk: Buffer) => {
      this.log.debug('backend.stdout', { line: chunk.toString().trim().slice(0, 500) });
    });
    this.child.stderr?.on('data', (chunk: Buffer) => {
      this.log.warn('backend.stderr', { line: chunk.toString().trim().slice(0, 500) });
    });

    this.child.on('exit', (code, signal) => {
      this.log.info('backend.exit', { code, signal });
      this.child = null;
    });

    await new Promise((r) => setTimeout(r, 50));

    if (this.child?.exitCode != null) {
      return { ok: false, error: `BACKEND_EXITED_EARLY: code ${this.child.exitCode}` };
    }

    this.log.info('ProcessRunner.start', { pid: this.child?.pid, nodeExe });
    return { ok: true, pid: this.child?.pid };
  }

  async stop(signal: NodeJS.Signals = 'SIGTERM'): Promise<void> {
    if (!this.child) return;
    this.child.kill(signal);
    this.child = null;
    this.log.info('ProcessRunner.stop', { signal });
  }
}
