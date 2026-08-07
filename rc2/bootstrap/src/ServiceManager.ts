import type { Logger } from './Logger.js';
import { netStopService, WINDOWS_SERVICE_NAMES } from './services/windowsSc.js';

export type ServiceKind = 'postgresql' | 'api' | 'web' | 'repAgent' | 'updater' | 'monitor';

/**
 * Registro e controle SCM (RC2.4.2).
 */
export class ServiceManager {
  private readonly registered = new Set<ServiceKind>();

  constructor(private readonly log: Logger) {}

  async registerService(kind: ServiceKind, displayName: string): Promise<void> {
    this.registered.add(kind);
    this.log.info('ServiceManager.registerService', { kind, displayName });
  }

  async startService(kind: ServiceKind): Promise<void> {
    this.log.info('ServiceManager.startService', { kind });
  }

  async stopService(kind: ServiceKind): Promise<void> {
    const name = WINDOWS_SERVICE_NAMES[kind as keyof typeof WINDOWS_SERVICE_NAMES];
    if (!name) {
      this.log.info('ServiceManager.stopService skipped', { kind });
      return;
    }
    const r = netStopService(name);
    this.log.info('ServiceManager.stopService', { kind, service: name, ...r });
  }

  getRegisteredKinds(): ServiceKind[] {
    return [...this.registered];
  }
}
