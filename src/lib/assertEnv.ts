import { showFatalError } from './supabaseInfraGuard';

/**
 * Fonte única: variáveis Vite (prefixo VITE_ obrigatório no .env da raiz).
 */
export function assertEnv(): { url: string; key: string } {
  if (typeof window !== 'undefined' && (window as any).__ENV_FATAL_ERROR) {
    throw new Error(String((window as any).__ENV_FATAL_ERROR));
  }

  const url = String(import.meta.env.VITE_SUPABASE_URL ?? '').trim().replace(/\/+$/, '');
  const key = String(import.meta.env.VITE_SUPABASE_ANON_KEY ?? '').trim();

  if (!url || !key) {
    const message =
      'Variáveis VITE_SUPABASE_URL ou VITE_SUPABASE_ANON_KEY não carregadas. Verifique o arquivo .env na raiz do projeto e reinicie o servidor (npm run dev).';
    console.error('[ENV ERROR]', message);
    showFatalError(message);
    throw new Error(message);
  }

  return { url, key };
}
