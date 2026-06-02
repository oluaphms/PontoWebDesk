import { isDataLayerConfigured } from '../config/system';

/** @deprecated Nome legado. Hoje significa "camada remota de dados disponível" (API VPS em LOCAL_API). */
export function isCloudEnabled(): boolean {
  return isDataLayerConfigured();
}
