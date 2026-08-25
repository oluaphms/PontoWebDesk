import {
  FRONTEND_SERVICE_NAME,
  RECOVERY_ACTIONS,
  RECOVERY_RESET_SECONDS,
} from './FrontendServiceConfig.js';
import { scOpt, type ScExecutor } from '../scExec.js';

export class FrontendServiceRecovery {
  constructor(private readonly sc: ScExecutor) {}

  configure(): { ok: boolean; message: string } {
    if (process.platform !== 'win32') {
      return { ok: false, message: 'PLATFORM_NOT_WIN32' };
    }
    const actions = RECOVERY_ACTIONS.map((a) => `${a.action}/${a.delayMs}`).join('/');
    const r = this.sc([
      'failure',
      FRONTEND_SERVICE_NAME,
      ...scOpt('reset', String(RECOVERY_RESET_SECONDS)),
      ...scOpt('actions', actions),
    ]);
    if (r.exitCode !== 0) {
      return { ok: false, message: r.stderr || r.stdout };
    }
    return { ok: true, message: 'RECOVERY_CONFIGURED' };
  }
}
