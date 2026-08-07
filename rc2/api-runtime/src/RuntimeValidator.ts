import fs from 'node:fs';
import net from 'node:net';
import type { ApiRuntimePaths, RuntimeValidationResult, ValidationIssue } from './types.js';
import { ConfigLoader } from './ConfigLoader.js';
import { EnvironmentManager } from './EnvironmentManager.js';
import { backendJsPath } from './paths.js';

export interface RuntimeValidatorOptions {
  checkDatabase?: boolean;
  databaseTimeoutMs?: number;
}

export class RuntimeValidator {
  constructor(
    private readonly paths: ApiRuntimePaths,
    private readonly options: RuntimeValidatorOptions = {},
  ) {}

  async validate(): Promise<RuntimeValidationResult> {
    const errors: ValidationIssue[] = [];
    const warnings: ValidationIssue[] = [];

    const entry = backendJsPath(this.paths);
    if (!fs.existsSync(entry)) {
      errors.push({
        code: 'BACKEND_ENTRY_MISSING',
        message: `Backend entry not found: ${entry} (RC2 layout server/dist/server.js)`,
      });
    }

    const nodeExe = this.paths.nodeExecutable;
    if (!fs.existsSync(nodeExe)) {
      warnings.push({
        code: 'NODE_REDIST_MISSING',
        message: `Embedded node not found at ${nodeExe}; ProcessRunner may use process.execPath`,
      });
    }

    if (!fs.existsSync(this.paths.configDir)) {
      errors.push({ code: 'CONFIG_DIR_MISSING', message: this.paths.configDir });
    }

    const loader = ConfigLoader.fromPaths(this.paths);
    if (!loader.exists()) {
      errors.push({ code: 'BACKEND_ENV_MISSING', message: this.paths.backendEnvFile });
    } else {
      const envMgr = new EnvironmentManager(this.paths);
      try {
        const built = envMgr.buildProcessEnvironment();
        if (!built.ok) {
          errors.push({
            code: 'BACKEND_ENV_INCOMPLETE',
            message: `Missing keys: ${built.missing.join(', ')}`,
          });
        }
      } catch (e) {
        errors.push({
          code: 'BACKEND_ENV_READ_FAILED',
          message: e instanceof Error ? e.message : String(e),
        });
      }
    }

    if (!fs.existsSync(this.paths.storageDir)) {
      warnings.push({ code: 'STORAGE_DIR_MISSING', message: this.paths.storageDir });
    } else {
      const uploads = `${this.paths.storageDir.replace(/[/\\]$/, '')}\\uploads`;
      if (!fs.existsSync(uploads)) {
        warnings.push({ code: 'STORAGE_UPLOADS_MISSING', message: uploads });
      }
    }

    if (!fs.existsSync(this.paths.logsDir)) {
      warnings.push({ code: 'LOGS_DIR_MISSING', message: this.paths.logsDir });
    }

    if (this.options.checkDatabase !== false && loader.exists()) {
      const env = loader.loadIfPresent();
      if (env?.PGHOST && env?.PGPORT) {
        const reachable = await probeTcp(env.PGHOST, env.PGPORT, this.options.databaseTimeoutMs ?? 2000);
        if (!reachable) {
          errors.push({
            code: 'DATABASE_UNREACHABLE',
            message: `Cannot reach ${env.PGHOST}:${env.PGPORT}`,
          });
        }
      }
    }

    return { ok: errors.length === 0, errors, warnings };
  }
}

function probeTcp(host: string, port: string, timeoutMs: number): Promise<boolean> {
  const portNum = Number(port);
  if (!Number.isFinite(portNum)) return Promise.resolve(false);

  return new Promise((resolve) => {
    const socket = net.connect({ host, port: portNum });
    const done = (ok: boolean) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.on('connect', () => done(true));
    socket.on('timeout', () => done(false));
    socket.on('error', () => done(false));
  });
}
