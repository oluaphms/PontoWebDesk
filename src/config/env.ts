/**
 * Configuração Supabase via Vite (import.meta.env).
 */

export const getSupabaseConfig = () => {
  const url = String(import.meta.env.VITE_SUPABASE_URL ?? '').trim();
  const key = String(import.meta.env.VITE_SUPABASE_ANON_KEY ?? '').trim();
  return { url, key };
};
