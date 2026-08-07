import { ConfigManager } from './ConfigManager.js';
import type { ConfigManagerOptions } from './ConfigManager.js';
import { InstallStateStore } from './InstallState.js';
import { Logger } from './Logger.js';
import { Validation } from './Validation.js';
import { ServiceManager } from './ServiceManager.js';
import { RecoveryManager } from './RecoveryManager.js';
import { InstallManager } from './InstallManager.js';
import { PostgresInstallOrchestrator } from './postgres/PostgresInstallOrchestrator.js';
import { loadBackendInstallPort } from './api/loadBackendInstall.js';
import { RollbackCoordinator } from './pipeline/RollbackCoordinator.js';
import type { StructuralRunResult } from './types.js';
import type { InstallStepId } from './installSteps.js';
import { isInstallStepId } from './installSteps.js';

export interface BootstrapOptions extends ConfigManagerOptions {
  simulateFailureAtStep?: InstallStepId;
  /** RC2.2: pipeline PostgreSQL real */
  embeddedPostgres?: boolean;
  /** Não executar binários PG (testes) */
  postgresStub?: boolean;
  /** RC2.3.2: serviço API via api-service quando disponível */
  apiService?: boolean;
  apiServiceStub?: boolean;
}

function resolveEmbedded(options: BootstrapOptions): boolean {
  if (options.embeddedPostgres === true) return true;
  if (options.embeddedPostgres === false) return false;
  if (process.env['RC2_BOOTSTRAP_MODE'] === 'embedded') return true;
  return false;
}

function resolvePostgresStub(options: BootstrapOptions): boolean {
  if (options.postgresStub === true) return true;
  return process.env['RC2_BOOTSTRAP_PG_STUB'] === '1';
}

function resolveApiService(options: BootstrapOptions, embedded: boolean): boolean {
  if (options.apiService === false) return false;
  if (options.apiService === true) return true;
  if (process.env['RC2_BOOTSTRAP_API_SERVICE'] === '0') return false;
  if (process.env['RC2_BOOTSTRAP_API_SERVICE'] === '1') return true;
  return embedded && process.platform === 'win32';
}

function resolveApiServiceStub(options: BootstrapOptions): boolean {
  if (options.apiServiceStub === true) return true;
  return process.env['RC2_BOOTSTRAP_API_SERVICE_STUB'] === '1';
}

/**
 * Ponto de entrada do Bootstrap RC2 (Setup.exe engine futuro).
 */
export class Bootstrap {
  readonly config: ConfigManager;
  readonly logger: Logger;
  readonly installState: InstallStateStore;
  readonly validation: Validation;
  readonly services: ServiceManager;
  readonly recovery: RecoveryManager;
  readonly postgres: PostgresInstallOrchestrator;
  readonly rollback: RollbackCoordinator;

  private readonly simulateFailureAtStep?: InstallStepId;
  private readonly embeddedPostgres: boolean;
  private readonly postgresStub: boolean;
  private readonly bootstrapOptions: BootstrapOptions;

  constructor(options: BootstrapOptions = {}) {
    this.bootstrapOptions = options;
    const envFail = process.env['RC2_BOOTSTRAP_FAIL_STEP'];
    const simulateFailureAtStep =
      options.simulateFailureAtStep ??
      (envFail && isInstallStepId(envFail) ? envFail : undefined);

    this.simulateFailureAtStep = simulateFailureAtStep;
    this.embeddedPostgres = resolveEmbedded(options);
    this.postgresStub = resolvePostgresStub(options);
    this.config = new ConfigManager(options);
    const paths = this.config.getPaths();
    this.logger = new Logger({ logDir: paths.logsDir, component: 'Bootstrap' });
    this.installState = new InstallStateStore(paths.installStateFile);
    this.validation = new Validation(paths, this.logger, this.config.getPgBinOverride());
    this.services = new ServiceManager(this.logger);
    this.recovery = new RecoveryManager(this.installState, this.logger, this.services);
    this.rollback = new RollbackCoordinator(this.logger);
    this.postgres = new PostgresInstallOrchestrator(paths, this.logger, {
      pgBinOverride: options.pgBinOverride ?? this.config.getPgBinOverride(),
      stub: resolvePostgresStub(options),
    });
  }

  async runStructuralDryRun(): Promise<StructuralRunResult> {
    return this.runInstall({ structuralOnly: true });
  }

  async runEmbeddedInstall(): Promise<StructuralRunResult> {
    return this.runInstall();
  }

  async runInstall(options?: { structuralOnly?: boolean }): Promise<StructuralRunResult> {
    const embedded = options?.structuralOnly ? false : this.embeddedPostgres;
    const pipelineMode = embedded ? 'full' : 'structural';
    const paths = this.config.getPaths();
    const wantApi = embedded && resolveApiService(this.bootstrapOptions, embedded);
    const backendInstall =
      wantApi && !resolveApiServiceStub(this.bootstrapOptions)
        ? await loadBackendInstallPort(paths)
        : undefined;

    this.logger.info('Bootstrap.runInstall start', {
      architectureVersion: 'RC2-ARCH-1.0.0',
      phase: pipelineMode === 'full' ? 'rc2.4.2-full' : 'rc2.4.2-structural',
      embeddedPostgres: embedded,
      apiService: Boolean(backendInstall),
      simulateFailureAtStep: this.simulateFailureAtStep,
    });

    const mgr = new InstallManager({
      store: this.installState,
      validation: this.validation,
      services: this.services,
      recovery: this.recovery,
      log: this.logger,
      paths,
      layoutManifest: this.config.installation.layoutManifest,
      pipelineMode,
      rollback: this.rollback,
      postgres: this.postgres,
      embeddedPostgres: embedded,
      postgresStub: this.postgresStub,
      backendInstall,
      backendInstallStub: resolveApiServiceStub(this.bootstrapOptions),
    });

    return mgr.runInstall({
      simulateFailureAtStep: this.simulateFailureAtStep,
    });
  }
}
