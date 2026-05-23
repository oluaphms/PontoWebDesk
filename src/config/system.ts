/** Frontend opera 100% via API Node na VPS. */
export const API_VPS_BASE =
  (import.meta.env.VITE_API_URL as string | undefined)?.trim()?.replace(/\/+$/, '') ||
  (import.meta.env.VITE_LOCAL_API_BASE_URL as string | undefined)?.trim()?.replace(/\/+$/, '') ||
  'http://177.7.51.209/api';

/** @deprecated Use API_VPS_BASE — mantido para imports legados. */
export const SYSTEM_CONFIG = {
  DATA_PROVIDER_MODE: 'LOCAL_API' as const,
} as const;
