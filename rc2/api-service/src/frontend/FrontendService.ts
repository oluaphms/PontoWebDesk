import { defaultScExecutor } from '../scExec.js';
import { FrontendServiceController } from './FrontendServiceController.js';
import { FrontendServiceInstaller } from './FrontendServiceInstaller.js';
import { FrontendServiceRecovery } from './FrontendServiceRecovery.js';
import { FrontendServiceValidator } from './FrontendServiceValidator.js';
import type { FrontendServicePaths } from './FrontendServiceConfig.js';

export class FrontendService {
  readonly installer: FrontendServiceInstaller;
  readonly controller: FrontendServiceController;
  readonly recovery: FrontendServiceRecovery;
  readonly validator: FrontendServiceValidator;

  constructor(
    paths: FrontendServicePaths,
    sc = defaultScExecutor(),
  ) {
    this.installer = new FrontendServiceInstaller(paths, sc);
    this.controller = new FrontendServiceController(sc);
    this.recovery = new FrontendServiceRecovery(sc);
    this.validator = new FrontendServiceValidator(sc, paths);
  }

  async installAndStart(): Promise<{ ok: boolean; message: string }> {
    const layout = this.installer.validateLayoutFiles();
    if (!layout.ok) return layout;

    const installed = this.installer.install();
    if (!installed.ok) return installed;

    const rec = this.recovery.configure();
    if (!rec.ok) {
      await this.rollback('RECOVERY_CONFIGURE_FAILED');
      return rec;
    }

    const started = this.controller.start();
    if (!started.ok) {
      await this.rollback('SERVICE_START_FAILED');
      return started;
    }

    const v = await this.validator.validate();
    if (!v.ok) {
      await this.rollback(`VALIDATION_FAILED: ${v.errors.join('; ')}`);
      return { ok: false, message: v.errors.join('; ') || 'FRONTEND_VALIDATION_FAILED' };
    }

    return { ok: true, message: 'FRONTEND_SERVICE_READY' };
  }

  async rollback(reason: string): Promise<void> {
    this.controller.stop();
    if (this.installer.wasInstalledThisSession()) {
      this.installer.uninstall();
    }
    void reason;
  }

  async validateHealth(): Promise<{ ok: boolean; errors: string[] }> {
    const v = await this.validator.validateOnce();
    return { ok: v.ok, errors: v.errors };
  }
}
