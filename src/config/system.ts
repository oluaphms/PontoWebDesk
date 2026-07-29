import { getApiBaseUrl } from '../services/api';
import { PlatformService } from '../platform/PlatformService';
import { runDevEnvWarnings } from './env';
import { DEFAULT_PROVIDER, type DataProviderMode } from './providers';

/** Frontend opera via API Node na VPS (`VITE_API_URL`, sufixo `/api`). */
export const API_VPS_BASE = getApiBaseUrl();

let cachedMode: DataProviderMode | null = null;
let warningsDone = false;

/**
 * Data Provider atual (LOCAL_API | SUPABASE).
 * Conceito separado de DeploymentMode (SAAS | LOCAL | HYBRID).
 */
export function getDataProviderMode(): DataProviderMode {
  if (!cachedMode) {
    cachedMode = PlatformService.getDataProvider();
    if (!warningsDone) {
      warningsDone = true;
      runDevEnvWarnings(cachedMode);
    }
  }
  return cachedMode;
}

export function isLocalApiMode(): boolean {
  return PlatformService.isLocalApiProvider();
}

export function isSupabaseMode(): boolean {
  return PlatformService.isSupabaseProvider();
}

/** @deprecated Preferir `isLocalApiMode()`. */
export function isLocalApiDataProvider(): boolean {
  return isLocalApiMode();
}

/**
 * Camada de dados utilizável no browser.
 * Em LOCAL_API: API VPS configurada. Em SUPABASE (futuro): credenciais Supabase.
 * Não usa DeploymentMode.
 */
export function isDataLayerConfigured(): boolean {
  return PlatformService.isDataLayerConfigured();
}

/** API URL bruta configurada (via PlatformService). */
export function isApiConfigured(): boolean {
  return PlatformService.isApiConfigured();
}

/** @deprecated Use API_VPS_BASE — mantido para imports legados. */
export const SYSTEM_CONFIG = {
  get DATA_PROVIDER_MODE(): DataProviderMode {
    return getDataProviderMode();
  },
} as const;

export { DEFAULT_PROVIDER };
