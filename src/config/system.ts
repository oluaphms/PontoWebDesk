import { getApiBaseUrl } from '../services/api';

/** Frontend opera 100% via API Node na VPS (`VITE_API_URL`, sufixo `/api`). */
export const API_VPS_BASE = getApiBaseUrl();

/** @deprecated Use API_VPS_BASE — mantido para imports legados. */
export const SYSTEM_CONFIG = {
  DATA_PROVIDER_MODE: 'LOCAL_API' as const,
} as const;

export function isLocalApiDataProvider(): boolean {
  return SYSTEM_CONFIG.DATA_PROVIDER_MODE === 'LOCAL_API';
}
