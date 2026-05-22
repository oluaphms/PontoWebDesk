/**
 * Configuração Supabase — apenas import.meta.env (Vite).
 */

const supabaseUrl = String(import.meta.env.VITE_SUPABASE_URL ?? '').trim().replace(/\/+$/, '');
const supabaseAnonKey = String(import.meta.env.VITE_SUPABASE_ANON_KEY ?? '').trim();

export const SUPABASE_URL = supabaseUrl;
export const SUPABASE_ANON_KEY = supabaseAnonKey;

export const validateSupabaseConfig = (): void => {
  if (!supabaseUrl || !supabaseAnonKey) {
    console.warn(
      '[Supabase] VITE_SUPABASE_URL ou VITE_SUPABASE_ANON_KEY ausentes — defina no .env e reinicie o Vite.',
    );
    return;
  }

  if (!supabaseUrl.startsWith('https://') || !supabaseUrl.includes('.supabase.co')) {
    console.warn(`[Supabase] VITE_SUPABASE_URL parece inválida: ${supabaseUrl}`);
  }

  console.log('✅ [Supabase] Configuração validada');
  console.log(`   URL: ${supabaseUrl.slice(0, 40)}...`);
};

if (typeof window !== 'undefined' && supabaseUrl && supabaseAnonKey) {
  try {
    validateSupabaseConfig();
  } catch (error) {
    console.error('[Supabase] Erro na validação:', error);
  }
}
