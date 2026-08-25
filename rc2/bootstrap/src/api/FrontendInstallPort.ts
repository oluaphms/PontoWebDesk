import type { BootstrapPaths } from '../types.js';

/** Contrato RC2.4.3.1 — install_frontend → serviço PontoWebDeskFrontend */
export interface FrontendInstallPort {
  installFrontend(): Promise<void>;
  validateFrontend(): Promise<void>;
  rollbackFrontend(reason: string): Promise<void>;
}

export type { BootstrapPaths };
