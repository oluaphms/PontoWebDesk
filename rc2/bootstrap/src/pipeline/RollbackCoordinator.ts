import type { ServiceKind } from '../ServiceManager.js';
import type { Logger } from '../Logger.js';
import { netStopService, WINDOWS_SERVICE_NAMES } from '../services/windowsSc.js';

/**
 * Rastreia serviços iniciados durante o pipeline e executa stop básico em falha.
 */
export class RollbackCoordinator {
  private readonly started = new Set<ServiceKind>();

  constructor(private readonly log: Logger) {}

  trackStarted(kind: ServiceKind): void {
    this.started.add(kind);
  }

  async rollbackStartedServices(reason: string): Promise<void> {
    this.log.warn('RollbackCoordinator.rollback', { reason, started: [...this.started] });
    const order: ServiceKind[] = ['api', 'repAgent', 'web', 'updater', 'postgresql'];
    for (const kind of order) {
      if (!this.started.has(kind)) continue;
      await this.stopKind(kind);
    }
  }

  private async stopKind(kind: ServiceKind): Promise<void> {
    const name = WINDOWS_SERVICE_NAMES[kind as keyof typeof WINDOWS_SERVICE_NAMES];
    if (!name) {
      this.log.info('RollbackCoordinator.stop skipped (no SCM name)', { kind });
      return;
    }
    const r = netStopService(name);
    this.log.info('RollbackCoordinator.stop', { kind, service: name, ...r });
  }
}
