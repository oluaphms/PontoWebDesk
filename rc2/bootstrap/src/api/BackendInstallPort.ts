/** Contrato RC2.3.2 — install_backend → serviço PontoWebDeskApi */
export interface BackendInstallPort {
  installBackend(): Promise<void>;
  validateHealth(): Promise<void>;
}
