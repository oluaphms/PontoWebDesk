import { EnvironmentManager } from './EnvironmentManager.js';
import { HealthServer } from './HealthServer.js';
import { ApiRuntimeLogger } from './Logger.js';
import { defaultApiRuntimePaths } from './paths.js';
import { ProcessRunner } from './ProcessRunner.js';
import { RuntimeValidator } from './RuntimeValidator.js';
import type { ApiRuntimeOptions, ApiRuntimeStatus } from './types.js';

const DEFAULT_HEALTH_PORT = 3011;

export class ApiRuntime {
  readonly paths;
  readonly logger: ApiRuntimeLogger;
  readonly validator: RuntimeValidator;
  readonly environment: EnvironmentManager;
  readonly processRunner: ProcessRunner;
  readonly health: HealthServer;

  private lastValidation = { ok: false, errors: [], warnings: [] } as Awaited<
    ReturnType<RuntimeValidator['validate']>
  >;

  constructor(private readonly options: ApiRuntimeOptions = {}) {
    this.paths = defaultApiRuntimePaths(options.paths);
    this.logger = new ApiRuntimeLogger({ logFile: this.paths.apiRuntimeLogFile });
    this.validator = new RuntimeValidator(this.paths, { checkDatabase: true });
    this.environment = new EnvironmentManager(this.paths);
    this.processRunner = new ProcessRunner(this.paths, this.logger);
    const healthPort = options.healthPort ?? DEFAULT_HEALTH_PORT;
    const productVersion = options.productVersion ?? '0.1.0-rc2.3.1';
    this.health = new HealthServer({
      port: healthPort,
      productVersion,
      getValidation: () => this.lastValidation,
    });
  }

  async validate(): Promise<ApiRuntimeStatus['validation']> {
    this.lastValidation = await this.validator.validate();
    return this.lastValidation;
  }

  async start(): Promise<ApiRuntimeStatus> {
    const validation = await this.validate();
    await this.health.start();
    this.logger.info('ApiRuntime.health.started', { port: this.health.getPort() });

    if (!validation.ok) {
      this.logger.error('ApiRuntime.start aborted — validation failed', {
        errors: validation.errors,
      });
      return {
        running: false,
        healthPort: this.health.getPort(),
        validation,
      };
    }

    if (this.options.dryRun) {
      this.logger.info('ApiRuntime.start dryRun — backend not spawned');
      return {
        running: false,
        healthPort: this.health.getPort(),
        validation,
      };
    }

    const built = this.environment.buildProcessEnvironment();
    if (!built.ok) {
      return {
        running: false,
        healthPort: this.health.getPort(),
        validation: {
          ok: false,
          errors: built.missing.map((k) => ({ code: 'ENV_MISSING', message: k })),
          warnings: [],
        },
      };
    }

    const started = await this.processRunner.start(built.env);
    if (!started.ok) {
      this.logger.error('ApiRuntime ProcessRunner failed', { error: started.error });
      return {
        running: false,
        healthPort: this.health.getPort(),
        validation,
      };
    }

    return {
      running: true,
      backendPid: started.pid,
      healthPort: this.health.getPort(),
      validation,
    };
  }

  async stop(): Promise<void> {
    await this.processRunner.stop();
    await this.health.stop();
    this.logger.info('ApiRuntime.stop');
  }

  getStatus(): ApiRuntimeStatus {
    return {
      running: this.processRunner.isRunning(),
      backendPid: this.processRunner.getPid(),
      healthPort: this.health.getPort(),
      validation: this.lastValidation,
    };
  }
}
