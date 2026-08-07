/**
 * Pontes futuras RC2 — sem acoplamento de implementação nesta fase.
 */

export interface BootstrapApiRuntimeHook {
  /** Invocado quando InstallManager entrar em `install_backend` (RC2.3.2+) */
  onInstallBackend?(ctx: { programFilesRoot: string; programDataRoot: string }): Promise<void>;
  /** Precheck estendido antes de subir API */
  validateBeforeStart?(): Promise<{ ok: boolean; errors: string[] }>;
}

export interface InstallManagerApiRuntimeDelegate {
  stepId: 'install_backend';
  runInstallBackend(ctx: { dryRun: boolean }): Promise<{ ok: boolean; message: string }>;
}

export interface UpdaterApiRuntimeDelegate {
  /** Swap de Backend\binários sem alterar Config/pgdata */
  prepareApiRuntimeAfterUpdate?(ctx: { version: string }): Promise<void>;
}

export const API_RUNTIME_SERVICE_NAME = 'PontoWebDeskApi' as const;
