import type {
  InstallStateDocument,
  PrecheckResult,
  StructuralRunOptions,
  StructuralRunResult,
} from './types.js';
import type { InstallStateStore } from './InstallState.js';
import type { Validation } from './Validation.js';
import type { ServiceManager } from './ServiceManager.js';
import type { Logger } from './Logger.js';
import type { RecoveryManager } from './RecoveryManager.js';
import type { PostgresInstallOrchestrator } from './postgres/PostgresInstallOrchestrator.js';
import type { BackendInstallPort } from './api/BackendInstallPort.js';
import type { BootstrapPaths } from './types.js';
import type { LayoutManifest } from '@pontowebdesk/api-runtime';
import { INSTALLING_PIPELINE_STEPS } from './installSteps.js';
import type { InstallStepId } from './installSteps.js';
import { InstallPipelineExecutor } from './pipeline/InstallPipelineExecutor.js';
import type { PipelineMode } from './pipeline/pipelineTypes.js';
import type { RollbackCoordinator } from './pipeline/RollbackCoordinator.js';

export interface InstallManagerDeps {
  store: InstallStateStore;
  validation: Validation;
  services: ServiceManager;
  recovery: RecoveryManager;
  log: Logger;
  paths: BootstrapPaths;
  layoutManifest: LayoutManifest;
  pipelineMode: PipelineMode;
  rollback: RollbackCoordinator;
  postgres?: PostgresInstallOrchestrator;
  embeddedPostgres?: boolean;
  postgresStub?: boolean;
  backendInstall?: BackendInstallPort;
  backendInstallStub?: boolean;
}

/**
 * Orquestra instalação RC2.4.2 — pipeline completo Professional.
 */
export class InstallManager {
  private readonly executor: InstallPipelineExecutor;

  constructor(private readonly deps: InstallManagerDeps) {
    this.executor = new InstallPipelineExecutor({
      mode: deps.pipelineMode,
      paths: deps.paths,
      layoutManifest: deps.layoutManifest,
      log: deps.log,
      services: deps.services,
      postgres: deps.postgres,
      postgresStub: deps.postgresStub,
      backendInstall: deps.backendInstall,
      backendInstallStub: deps.backendInstallStub,
      rollback: deps.rollback,
    });
  }

  initState(): InstallStateDocument {
    const doc = this.deps.store.ensureFileExists();
    this.deps.log.info('InstallManager.initState', { state: doc.state, step: doc.currentStep });
    return doc;
  }

  beginPrecheck(doc: InstallStateDocument): InstallStateDocument {
    let current = doc;
    if (current.state === 'NOT_STARTED') {
      current = this.deps.store.transition(current, 'PRECHECK', 'precheck started', undefined, 'precheck');
      this.deps.store.save(current);
    } else if (current.state === 'FAILED') {
      current = this.deps.recovery.retryFromFailed(current);
      current = this.deps.store.transition(current, 'PRECHECK', 'precheck retry', undefined, 'precheck');
      this.deps.store.save(current);
    } else if (current.state !== 'PRECHECK') {
      throw new Error(`PRECHECK_INVALID_STATE: ${current.state}`);
    }
    this.deps.log.info('InstallManager.beginPrecheck', { state: current.state, step: current.currentStep });
    return current;
  }

  runPrecheck(doc: InstallStateDocument): { doc: InstallStateDocument; result: PrecheckResult } {
    const result = this.deps.validation.runPrecheck({
      requirePostgresBinaries:
        this.deps.pipelineMode === 'full' &&
        this.deps.embeddedPostgres === true &&
        this.deps.postgresStub !== true,
    });
    if (!result.ok) {
      const code = result.errors[0]?.code ?? 'PRECHECK_FAILED';
      const message = result.errors.map((e) => e.message).join('; ');
      const failed = this.deps.store.markFailed(doc, code, message, 'precheck');
      this.deps.store.save(failed);
      this.deps.log.error('InstallManager.runPrecheck failed', { code });
      return { doc: failed, result };
    }
    this.deps.store.save(doc);
    return { doc, result };
  }

  private async runInstallingPipeline(
    doc: InstallStateDocument,
    options: StructuralRunOptions,
  ): Promise<InstallStateDocument> {
    let current = this.deps.store.transition(
      doc,
      'INSTALLING',
      'install pipeline started',
      undefined,
      'install_postgresql',
    );
    current = this.deps.store.beginInstalling(current);
    this.deps.store.save(current);

    for (const step of INSTALLING_PIPELINE_STEPS) {
      if (options.simulateFailureAtStep === step) {
        current = await this.failStep(current, step, 'EX002_SIMULATED_STEP_FAILURE', `Simulated failure at ${step}`);
        return current;
      }

      try {
        await this.executor.runStep(step);
        current = this.deps.store.completeStep(current, step, `RC2.4.2 — ${step} OK`);
        this.deps.store.save(current);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        current = await this.failStep(current, step, 'EX003_STEP_FAILED', message);
        return current;
      }
    }

    current = this.deps.store.transition(
      current,
      'INSTALLED',
      'RC2.4.2 pipeline completed',
      undefined,
      'completed',
    );
    current = this.deps.store.markFinished(current, 'install complete');
    this.deps.store.save(current);
    return current;
  }

  private async failStep(
    doc: InstallStateDocument,
    step: InstallStepId,
    code: string,
    message: string,
  ): Promise<InstallStateDocument> {
    await this.deps.rollback.rollbackStartedServices(message);
    let current = this.deps.store.appendStepError(doc, {
      step,
      code,
      message,
      at: new Date().toISOString(),
    });
    current = this.deps.store.markFinished(current, 'install failed');
    this.deps.store.save(current);
    return this.deps.recovery.handleInstallStepFailure(current, step, code, message);
  }

  async runStructuralDryRun(options: StructuralRunOptions = {}): Promise<StructuralRunResult> {
    return this.runInstall(options);
  }

  async runInstall(options: StructuralRunOptions = {}): Promise<StructuralRunResult> {
    let doc = this.initState();
    if (doc.state === 'FAILED' && doc.lastError?.code === 'EX001_INSTALL_STATE_CORRUPT') {
      return {
        ok: false,
        finalState: doc.state,
        finalStep: doc.currentStep,
        message: doc.lastError.message,
      };
    }

    doc = this.beginPrecheck(doc);
    const { doc: afterPrecheck, result } = this.runPrecheck(doc);
    if (!result.ok) {
      return {
        ok: false,
        finalState: afterPrecheck.state,
        finalStep: afterPrecheck.currentStep,
        message: afterPrecheck.lastError?.message ?? 'precheck failed',
      };
    }

    try {
      doc = await this.runInstallingPipeline(afterPrecheck, options);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      doc = await this.failStep(afterPrecheck, afterPrecheck.currentStep, 'EX003_PIPELINE_EXCEPTION', message);
      return {
        ok: false,
        finalState: doc.state,
        finalStep: doc.currentStep,
        message,
      };
    }

    if (doc.state === 'RECOVERY' || doc.state === 'FAILED') {
      return {
        ok: false,
        finalState: doc.state,
        finalStep: doc.currentStep,
        message: doc.lastError?.message ?? 'install failed — recovery entered',
      };
    }

    return {
      ok: true,
      finalState: doc.state,
      finalStep: doc.currentStep,
      message:
        this.deps.pipelineMode === 'full'
          ? 'RC2.4.2 professional pipeline completed'
          : 'RC2.4.2 structural pipeline completed',
    };
  }
}
