import fs from 'node:fs';
import path from 'node:path';
import {
  FRONTEND_SERVICE_DESCRIPTION,
  FRONTEND_SERVICE_DISPLAY_NAME,
  FRONTEND_SERVICE_NAME,
  FRONTEND_SERVICE_START_TYPE,
  FRONTEND_HOST,
  FRONTEND_PORT,
  buildFrontendServiceBinPath,
  writeFrontendServiceHostConfig,
  type FrontendRuntimeConfigDoc,
  type FrontendServicePaths,
} from './FrontendServiceConfig.js';
import { serviceHostExePath } from '../ServiceConfig.js';
import { scCreateArgs, scOpt, type ScExecutor } from '../scExec.js';

export class FrontendServiceInstaller {
  /** Serviço criado nesta sessão de install (para rollback). */
  private installedThisSession = false;

  constructor(
    private readonly paths: FrontendServicePaths,
    private readonly sc: ScExecutor,
  ) {}

  wasInstalledThisSession(): boolean {
    return this.installedThisSession;
  }

  clearInstalledThisSessionFlag(): void {
    this.installedThisSession = false;
  }

  writeRuntimeConfig(): void {
    fs.mkdirSync(this.paths.configDir, { recursive: true });
    fs.mkdirSync(this.paths.logsDir, { recursive: true });
    const doc: FrontendRuntimeConfigDoc = {
      wwwRoot: this.paths.frontendWwwDir,
      host: FRONTEND_HOST,
      port: FRONTEND_PORT,
      logFile: this.paths.frontendServiceLogFile,
    };
    fs.writeFileSync(this.paths.runtimeConfigFile, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
  }

  validateLayoutFiles(): { ok: boolean; message: string } {
    const index = path.join(this.paths.frontendWwwDir, 'index.html');
    if (!fs.existsSync(index)) {
      return { ok: false, message: `FRONTEND_WWW_MISSING: ${index}` };
    }
    if (!fs.existsSync(this.paths.frontendServeScript)) {
      return { ok: false, message: `FRONTEND_SERVE_SCRIPT_MISSING: ${this.paths.frontendServeScript}` };
    }
    if (!fs.existsSync(this.paths.nodeExecutable)) {
      return { ok: false, message: `NODE_EXECUTABLE_MISSING: ${this.paths.nodeExecutable}` };
    }
    return { ok: true, message: 'LAYOUT_OK' };
  }

  isInstalled(): boolean {
    const r = this.sc(['query', FRONTEND_SERVICE_NAME]);
    return r.exitCode === 0 && !/1060/.test(r.stderr + r.stdout);
  }

  install(): { ok: boolean; message: string } {
    if (process.platform !== 'win32') {
      return { ok: false, message: 'PLATFORM_NOT_WIN32' };
    }
    const layout = this.validateLayoutFiles();
    if (!layout.ok) return layout;

    this.writeRuntimeConfig();

    if (this.isInstalled()) {
      return { ok: true, message: 'ALREADY_INSTALLED' };
    }

    const hostExe = serviceHostExePath(this.paths);
    if (!fs.existsSync(hostExe)) {
      return { ok: false, message: `SERVICE_HOST_EXE_MISSING: ${hostExe}` };
    }
    writeFrontendServiceHostConfig(this.paths);

    const binPath = buildFrontendServiceBinPath(this.paths);
    const create = this.sc(
      scCreateArgs(
        FRONTEND_SERVICE_NAME,
        binPath,
        FRONTEND_SERVICE_DISPLAY_NAME,
        FRONTEND_SERVICE_START_TYPE,
      ),
    );
    if (create.exitCode !== 0) {
      return { ok: false, message: create.stderr || create.stdout };
    }
    this.sc(['description', FRONTEND_SERVICE_NAME, FRONTEND_SERVICE_DESCRIPTION]);
    this.sc(['config', FRONTEND_SERVICE_NAME, ...scOpt('start', FRONTEND_SERVICE_START_TYPE)]);
    this.installedThisSession = true;
    return { ok: true, message: 'INSTALLED' };
  }

  uninstall(): { ok: boolean; message: string } {
    if (!this.isInstalled()) {
      this.installedThisSession = false;
      return { ok: true, message: 'NOT_INSTALLED' };
    }
    const r = this.sc(['delete', FRONTEND_SERVICE_NAME]);
    if (r.exitCode !== 0) {
      return { ok: false, message: r.stderr || r.stdout };
    }
    this.installedThisSession = false;
    return { ok: true, message: 'UNINSTALLED' };
  }
}
