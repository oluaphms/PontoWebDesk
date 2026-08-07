import {
  ApiRuntime,
  defaultApiRuntimePaths,
  type ApiRuntimePaths,
} from '@pontowebdesk/api-runtime';
import { ServiceController } from './ServiceController.js';
import { ServiceInstaller } from './ServiceInstaller.js';
import { ServiceRecovery } from './ServiceRecovery.js';
import { ServiceValidator } from './ServiceValidator.js';
import { defaultApiServicePaths, type ApiServicePaths } from './ServiceConfig.js';
import { defaultScExecutor } from './scExec.js';

const DEFAULT_HEALTH_PORT = 3011;

export class ApiService {
  private readonly paths: ApiServicePaths;
  private readonly sc = defaultScExecutor();
  readonly installer: ServiceInstaller;
  readonly controller: ServiceController;
  readonly recovery: ServiceRecovery;
  readonly validator: ServiceValidator;

  constructor(options: { paths?: Partial<ApiServicePaths>; healthPort?: number } = {}) {
    this.paths = defaultApiServicePaths(options.paths);
    this.installer = new ServiceInstaller(this.paths, this.sc);
    this.controller = new ServiceController(this.sc);
    this.recovery = new ServiceRecovery(this.sc);
    this.validator = new ServiceValidator(this.sc, this.paths, options.healthPort ?? DEFAULT_HEALTH_PORT);
  }

  toApiRuntimePaths(): ApiRuntimePaths {
    const p = this.paths;
    return defaultApiRuntimePaths({
      programFilesRoot: p.programFilesRoot,
      programDataRoot: p.programDataRoot,
      backendRoot: p.backendRoot,
      backendEntry: p.backendEntry,
      nodeExecutable: p.nodeExecutable,
      backendEnvFile: p.backendEnvFile,
      configDir: p.configDir,
      storageDir: p.storageDir,
      logsDir: p.logsDir,
      apiRuntimeLogFile: p.apiRuntimeLogFile,
    });
  }

  async install(): Promise<{ ok: boolean; message: string }> {
    const inst = this.installer.install();
    if (!inst.ok) return inst;
    const rec = this.recovery.configure();
    if (!rec.ok) return rec;
    return { ok: true, message: 'INSTALL_COMPLETE' };
  }

  uninstall(): { ok: boolean; message: string } {
    return this.installer.uninstall();
  }

  start(): { ok: boolean; message: string } {
    return this.controller.start();
  }

  stop(): { ok: boolean; message: string } {
    return this.controller.stop();
  }

  restart(): { ok: boolean; message: string } {
    return this.controller.restart();
  }

  status() {
    return this.controller.query();
  }

  /** Bootstrap install_backend: instala SCM, inicia serviço, sobe health sidecar local. */
  async installAndStart(): Promise<{ ok: boolean; message: string }> {
    const installed = await this.install();
    if (!installed.ok) return installed;

    const runtime = new ApiRuntime({
      paths: this.toApiRuntimePaths(),
      dryRun: true,
      healthPort: DEFAULT_HEALTH_PORT,
    });
    await runtime.validate();
    await runtime.start();

    const started = this.start();
    if (!started.ok) return started;
    return { ok: true, message: 'SERVICE_STARTED' };
  }

  async validateHealth(): Promise<{ ok: boolean; errors: string[] }> {
    const v = await this.validator.validate();
    return { ok: v.ok, errors: v.errors };
  }
}
