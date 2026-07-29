import { PlatformService } from '../platform/PlatformService';

/**
 * @deprecated Nome legado. Hoje significa "camada remota de dados disponível"
 * (API VPS em LOCAL_API) — i.e. `PlatformService.isDataLayerConfigured()`.
 * Não confundir com `PlatformService.isCloud()` (= DeploymentMode SAAS).
 */
export function isCloudEnabled(): boolean {
  return PlatformService.isDataLayerConfigured();
}
