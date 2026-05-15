/**
 * Configuração de variáveis de ambiente
 * Lê as variáveis em tempo de execução (não em build time)
 */

export const getSupabaseConfig = () => {
  const url = import.meta.env.VITE_SUPABASE_URL || window.__VITE_SUPABASE_URL || '';
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY || window.__VITE_SUPABASE_ANON_KEY || '';
  
  return { url, key };
};

// Declarar tipos globais
declare global {
  interface Window {
    __VITE_SUPABASE_URL?: string;
    __VITE_SUPABASE_ANON_KEY?: string;
  }
}
