import type { ResolvedRuntimePaths } from '@pontowebdesk/api-runtime';
import { FrontendService } from './FrontendService.js';
import { frontendServicePathsFromResolved } from './FrontendServiceConfig.js';

export interface FrontendInstallPort {
  installFrontend(): Promise<void>;
  validateFrontend(): Promise<void>;
  rollbackFrontend(reason: string): Promise<void>;
}

export function createBootstrapFrontendInstall(
  paths: ResolvedRuntimePaths,
): FrontendInstallPort {
  const svc = new FrontendService(frontendServicePathsFromResolved(paths));

  return {
    async installFrontend(): Promise<void> {
      const r = await svc.installAndStart();
      if (!r.ok) throw new Error(`FRONTEND_SERVICE_INSTALL_FAILED: ${r.message}`);
    },
    async validateFrontend(): Promise<void> {
      const v = await svc.validateHealth();
      if (!v.ok) throw new Error(`FRONTEND_SERVICE_HEALTH_FAILED: ${v.errors.join('; ')}`);
    },
    async rollbackFrontend(reason: string): Promise<void> {
      await svc.rollback(reason);
    },
  };
}
