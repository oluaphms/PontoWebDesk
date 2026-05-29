import { getApiBaseUrl } from '../services/api';
import {
  isApiConfigured,
  isSupabaseCloudEnvConfigured,
  parseDataProviderMode,
  readDataProviderEnv,
  runDevEnvWarnings,
} from './env';
import { DEFAULT_PROVIDER, type DataProviderMode } from './providers';

/** Frontend opera via API Node na VPS (`VITE_API_URL`, sufixo `/api`). */
export const API_VPS_BASE = getApiBaseUrl();

let cachedMode: DataProviderMode | null = null;

export function getDataProviderMode(): DataProviderMode {
  if (!cachedMode) {
    cachedMode = parseDataProviderMode(readDataProviderEnv());
    runDevEnvWarnings(cachedMode);
  }
  return cachedMode;
}

export function isLocalApiMode(): boolean {
  return getDataProviderMode() === 'LOCAL_API';
}

export function isSupabaseMode(): boolean {
  return getDataProviderMode() === 'SUPABASE';
}

/** @deprecated Preferir `isLocalApiMode()`. */
export function isLocalApiDataProvider(): boolean {
  return isLocalApiMode();
}

/**
 * Camada de dados utilizável no browser.
 * Em LOCAL_API: API VPS configurada. Em SUPABASE (futuro): credenciais Supabase.
 */
export function isDataLayerConfigured(): boolean {
  if (isLocalApiMode()) return isApiConfigured();
  return isSupabaseCloudEnvConfigured();
}

/** @deprecated Use API_VPS_BASE — mantido para imports legados. */
export const SYSTEM_CONFIG = {
  get DATA_PROVIDER_MODE(): DataProviderMode {
    return getDataProviderMode();
  },
} as const;

export { DEFAULT_PROVIDER };
