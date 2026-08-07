import type { ResolvedRuntimePaths } from '@pontowebdesk/api-runtime';
import { ApiService } from './ApiService.js';
import { apiServicePathsFromResolved } from './ServiceConfig.js';

export interface BackendInstallPort {
  installBackend(): Promise<void>;
  validateHealth(): Promise<void>;
}

export function createBootstrapBackendInstall(paths: ResolvedRuntimePaths): BackendInstallPort {
  const svc = new ApiService({
    paths: apiServicePathsFromResolved(paths),
  });

  return {
    async installBackend(): Promise<void> {
      const r = await svc.installAndStart();
      if (!r.ok) throw new Error(`API_SERVICE_INSTALL_FAILED: ${r.message}`);
    },
    async validateHealth(): Promise<void> {
      const v = await svc.validateHealth();
      if (!v.ok) throw new Error(`API_SERVICE_HEALTH_FAILED: ${v.errors.join('; ')}`);
    },
  };
}

/** @deprecated use ResolvedRuntimePaths */
export type BootstrapPathsLike = ResolvedRuntimePaths;

export { pathsFromInstallationContext } from '@pontowebdesk/api-runtime';
