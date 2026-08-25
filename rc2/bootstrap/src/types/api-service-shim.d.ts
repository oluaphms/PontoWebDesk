declare module '@pontowebdesk/api-service' {
  import type { ResolvedRuntimePaths } from '@pontowebdesk/api-runtime';

  export function createBootstrapBackendInstall(paths: ResolvedRuntimePaths): {
    installBackend(): Promise<void>;
    validateHealth(): Promise<void>;
  };

  export function createBootstrapFrontendInstall(paths: ResolvedRuntimePaths): {
    installFrontend(): Promise<void>;
    validateFrontend(): Promise<void>;
    rollbackFrontend(reason: string): Promise<void>;
  };
}
