declare module '@pontowebdesk/api-service' {
  import type { ResolvedRuntimePaths } from '@pontowebdesk/api-runtime';

  export function createBootstrapBackendInstall(paths: ResolvedRuntimePaths): {
    installBackend(): Promise<void>;
    validateHealth(): Promise<void>;
  };
}
