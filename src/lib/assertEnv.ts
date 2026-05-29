import { getApiBaseUrl } from '../services/api';
import { isApiConfigured, isDataLayerConfigured } from '../config/system';

/** Valida presença da URL da API (não bloqueia boot se ausente — usa default da VPS). */
export function assertEnv(): { apiUrl: string } {
  return { apiUrl: getApiBaseUrl() };
}

export { isApiConfigured } from '../config/env';

/** Dados utilizáveis conforme o provider mode atual. */
export const isSupabaseConfigured = isDataLayerConfigured;

/** @deprecated Alias de `isApiConfigured`. */
export const checkSupabaseConfigured = isDataLayerConfigured;

/** @deprecated Alias de `isApiConfigured` em modo LOCAL_API. */
export const isSupabaseEnvConfigured = isDataLayerConfigured;
