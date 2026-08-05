/** Modo de dados do app (build-time via `VITE_DATA_PROVIDER`). */
export type DataProviderMode = 'LOCAL_API' | 'SUPABASE';

/** Padrão de produção: API Node na VPS. */
export const DEFAULT_PROVIDER: DataProviderMode = 'LOCAL_API';
