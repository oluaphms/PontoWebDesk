import type { InstallStateDocument } from './types.js';
import type { InstallStateStore } from './InstallState.js';
import type { Logger } from './Logger.js';
import type { ServiceManager } from './ServiceManager.js';
import type { InstallStepId } from './installSteps.js';

/**
 * Recuperação estrutural (transição RECOVERY + rollback stub).
 * RC2.1: sem restore de arquivos ou banco; integrado ao fluxo oficial do InstallManager.
 */
export class RecoveryManager {
  constructor(
    private readonly store: InstallStateStore,
    private readonly log: Logger,
    private readonly services: ServiceManager,
  ) {}

  enterRecovery(doc: InstallStateDocument, reason: string): InstallStateDocument {
    this.log.warn('RecoveryManager.enterRecovery', { reason, from: doc.state, step: doc.currentStep });
    let current = doc;
    if (current.state !== 'RECOVERY') {
      if (current.state === 'INSTALLING') {
        current = this.store.transition(current, 'RECOVERY', reason, 'RECOVERY_ENTER', current.currentStep);
      } else if (current.state === 'FAILED') {
        current = this.store.transition(current, 'RECOVERY', reason, 'RECOVERY_FROM_FAILED', current.currentStep);
      } else {
        throw new Error(`RECOVERY_NOT_ALLOWED_FROM_${current.state}`);
      }
    }
    this.store.save(current);
    return current;
  }

  /**
   * Rollback parcial (stub RC2.1): para serviços registrados, log auditável, estado RECOVERY.
   * RC2.2+: remoção real de artefatos ProgramData/Program Files.
   */
  async rollbackPartialInstall(doc: InstallStateDocument, reason: string): Promise<InstallStateDocument> {
    this.log.warn('RecoveryManager.rollbackPartialInstall', {
      reason,
      step: doc.currentStep,
    });
    const kinds = ['api', 'postgresql', 'repAgent', 'updater', 'web'] as const;
    for (const kind of kinds) {
      await this.services.stopService(kind);
    }
    let current = doc;
    if (current.state === 'INSTALLING' || current.state === 'FAILED') {
      current = this.enterRecovery(current, reason);
    } else if (current.state !== 'RECOVERY') {
      throw new Error(`ROLLBACK_NOT_ALLOWED_FROM_${current.state}`);
    }
    current = this.store.advanceStep(current, 'precheck', 'rollback partial complete (stub)');
    this.store.save(current);
    return current;
  }

  /** FAILED → RECOVERY → NOT_STARTED (retentativa oficial; substitui FAILED→PRECHECK). */
  retryFromFailed(doc: InstallStateDocument): InstallStateDocument {
    if (doc.state !== 'FAILED' && doc.state !== 'RECOVERY') {
      throw new Error(`RETRY_NOT_ALLOWED_FROM_${doc.state}`);
    }
    let current = doc;
    if (current.state === 'FAILED') {
      current = this.enterRecovery(current, 'retry after failure');
    }
    current = this.resetToNotStarted(current);
    return current;
  }

  /** Reset lógico para nova tentativa (sem apagar dados de runtime). */
  resetToNotStarted(doc: InstallStateDocument): InstallStateDocument {
    this.log.info('RecoveryManager.resetToNotStarted');
    const next = this.store.transition(doc, 'NOT_STARTED', 'recovery reset', undefined, 'idle');
    this.store.save(next);
    return next;
  }

  handleInstallStepFailure(
    doc: InstallStateDocument,
    step: InstallStepId,
    code: string,
    message: string,
  ): Promise<InstallStateDocument> {
    const failed = this.store.markFailed(doc, code, message, step);
    this.store.save(failed);
    return this.rollbackPartialInstall(failed, message);
  }
}
