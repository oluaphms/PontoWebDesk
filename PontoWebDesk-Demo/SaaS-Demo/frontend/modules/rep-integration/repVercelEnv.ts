/**
 * Lê URL/keys do Supabase no handler Vercel (Vite dev injeta VITE_* em import.meta.env).
 */

function viteEnv(): Record<string, string | undefined> | undefined {
  if (typeof import.meta === 'undefined') return undefined;
  return (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
}

export function getSupabaseUrlResolved(): string {
  const im = viteEnv();
  const raw =
    (typeof process.env.SUPABASE_URL === 'string' && process.env.SUPABASE_URL) ||
    (typeof process.env.URL_SUPABASE === 'string' && process.env.URL_SUPABASE) ||
    (typeof process.env.VITE_SUPABASE_URL === 'string' && process.env.VITE_SUPABASE_URL) ||
    im?.VITE_SUPABASE_URL ||
    '';
  return String(raw).trim().replace(/\/$/, '');
}

export function getSupabaseAnonKeyResolved(): string {
  const im = viteEnv();
  const raw =
    (typeof process.env.SUPABASE_ANON_KEY === 'string' && process.env.SUPABASE_ANON_KEY) ||
    (typeof process.env.VITE_SUPABASE_ANON_KEY === 'string' && process.env.VITE_SUPABASE_ANON_KEY) ||
    im?.VITE_SUPABASE_ANON_KEY ||
    '';
  return String(raw).trim();
}

export function getServiceRoleKeyResolved(): string {
  return (typeof process.env.SUPABASE_SERVICE_ROLE_KEY === 'string' ? process.env.SUPABASE_SERVICE_ROLE_KEY : '').trim();
}
