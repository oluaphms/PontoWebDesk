const hasViteSupabase =
  Boolean(String(import.meta.env.VITE_SUPABASE_URL ?? '').trim()) &&
  Boolean(String(import.meta.env.VITE_SUPABASE_ANON_KEY ?? '').trim());

/** Com VITE_SUPABASE_* no .env → cloud + provider Supabase; senão → API local. */
export const SYSTEM_CONFIG = {
  CLOUD_ENABLED: hasViteSupabase,
  DATA_PROVIDER_MODE: hasViteSupabase ? ('SUPABASE' as const) : ('LOCAL_API' as const),
} as const;
