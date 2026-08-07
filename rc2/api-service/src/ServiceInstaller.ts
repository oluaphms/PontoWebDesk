import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SERVICE_DESCRIPTION,
  SERVICE_DISPLAY_NAME,
  SERVICE_NAME,
  SERVICE_START_TYPE,
  buildServiceBinPath,
  type ApiServicePaths,
} from './ServiceConfig.js';
import type { ScExecutor } from './scExec.js';

export class ServiceInstaller {
  constructor(
    private readonly paths: ApiServicePaths,
    private readonly sc: ScExecutor,
  ) {}

  /** Copia serviceHost.js compilado para Bin\\api-service-host.js */
  writeServiceHostFromDist(): void {
    fs.mkdirSync(this.paths.binDir, { recursive: true });
    const here = path.dirname(fileURLToPath(import.meta.url));
    const bundled = path.join(here, 'serviceHost.js');
    if (!fs.existsSync(bundled)) {
      throw new Error(`SERVICE_HOST_BUNDLE_MISSING: ${bundled}`);
    }
    fs.copyFileSync(bundled, this.paths.serviceHostScript);
  }

  isInstalled(): boolean {
    const r = this.sc(['query', SERVICE_NAME]);
    return r.exitCode === 0 && !/1060/.test(r.stderr + r.stdout);
  }

  install(): { ok: boolean; message: string } {
    if (process.platform !== 'win32') {
      return { ok: false, message: 'PLATFORM_NOT_WIN32' };
    }
    if (this.isInstalled()) {
      return { ok: true, message: 'ALREADY_INSTALLED' };
    }
    this.writeServiceHostFromDist();
    const binPath = buildServiceBinPath(this.paths);
    const create = this.sc([
      'create',
      SERVICE_NAME,
      `binPath= ${binPath}`,
      `DisplayName= ${SERVICE_DISPLAY_NAME}`,
    ]);
    if (create.exitCode !== 0) {
      return { ok: false, message: create.stderr || create.stdout };
    }
    this.sc(['description', SERVICE_NAME, SERVICE_DESCRIPTION]);
    this.sc(['config', SERVICE_NAME, `start= ${SERVICE_START_TYPE}`]);
    return { ok: true, message: 'INSTALLED' };
  }

  uninstall(): { ok: boolean; message: string } {
    if (!this.isInstalled()) {
      return { ok: true, message: 'NOT_INSTALLED' };
    }
    const r = this.sc(['delete', SERVICE_NAME]);
    if (r.exitCode !== 0) {
      return { ok: false, message: r.stderr || r.stdout };
    }
    return { ok: true, message: 'UNINSTALLED' };
  }
}
