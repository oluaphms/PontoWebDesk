/**
 * Supabase Configuration and Initialization
 * 
 * ETAPA 1 - Inicialização segura e tardia
 * Usa getSupabaseClient() para lazy initialization
 */

import { getSupabaseClient, getSupabaseClientOrThrow, resetSession } from '../src/lib/supabaseClient';

// Re-export resetSession para compatibilidade
export { resetSession };

// Exportar o cliente (será null até estar pronto)
export const supabase = getSupabaseClient();

// Verificar se está configurado (valor do momento do import - para compatibilidade)
export const isSupabaseConfigured = !!supabase;

// Função para verificar se está configurado em tempo de execução (dinâmico)
// Use esta função em vez da constante quando precisar de verificação atualizada
export function checkSupabaseConfigured(): boolean {
  return !!getSupabaseClient();
}

// Storage para autenticação
const authStorageEnv = String(import.meta.env?.VITE_SUPABASE_AUTH_STORAGE || '').toLowerCase();
export const useSessionStorageForAuth = authStorageEnv !== 'local';

export function getUserProfileStorage(): Storage {
  if (typeof window === 'undefined') {
    throw new Error('getUserProfileStorage: apenas no navegador');
  }
  return useSessionStorageForAuth ? window.sessionStorage : window.localStorage;
}

export function clearCurrentUserFromAllStorages(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem('current_user');
    window.sessionStorage.removeItem('current_user');
  } catch {
    // ignora
  }
}

/**
 * Limpa a sessão local de autenticação do Supabase (tokens sb-* no storage).
 * Não faz signOut no servidor — apenas derruba o estado local imediatamente.
 */
export async function clearLocalAuthSession(): Promise<void> {
  if (typeof window === 'undefined') return;
  try {
    const clearSbKeys = (storage: Storage) => {
      const keys: string[] = [];
      for (let i = 0; i < storage.length; i++) {
        const k = storage.key(i);
        if (k && k.startsWith('sb-')) keys.push(k);
      }
      keys.forEach((k) => storage.removeItem(k));
    };
    clearSbKeys(window.sessionStorage);
    clearSbKeys(window.localStorage);
  } catch {
    // ignora falha ao limpar storage
  }
}

// Timeout padrão para operações
export const DEFAULT_CONNECTION_TIMEOUT_MS = 10000;
export const DB_SELECT_TIMEOUT_MS = 28000;

/**
 * Testa se o Supabase está acessível
 */
export async function testSupabaseConnection(
  timeoutMs: number = DEFAULT_CONNECTION_TIMEOUT_MS,
): Promise<{ ok: boolean; message?: string }> {
  const client = getSupabaseClient();
  
  if (!client) {
    return { 
      ok: false, 
      message: 'Supabase não inicializado. Verifique as variáveis de ambiente.' 
    };
  }

  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('timeout')), timeoutMs),
  );

  const tablesToTry = ['users', 'employees', 'companies'] as const;
  
  for (const table of tablesToTry) {
    try {
      const queryPromise = client.from(table).select('*').limit(1);
      const { error } = await Promise.race([queryPromise, timeoutPromise]);
      
      if (error && error.code !== 'PGRST116') {
        continue;
      }
      
      console.log('[SmartPonto] Supabase conectado (tabela:', table, ')');
      return { ok: true };
    } catch (e: any) {
      if (e?.message === 'timeout') {
        return {
          ok: false,
          message: 'Supabase timeout. Projeto pode estar pausado ou rede lenta.',
        };
      }
    }
  }

  return {
    ok: false,
    message: 'Não foi possível conectar ao Supabase.',
  };
}

/**
 * Executa uma promise do Supabase com timeout
 */
export async function withSupabaseTimeout<T>(
  promise: Promise<{ data: T; error: any }>,
  ms: number = DEFAULT_CONNECTION_TIMEOUT_MS,
): Promise<{ data: T; error: any }> {
  return Promise.race([
    promise,
    new Promise<{ data: null; error: { message: string } }>((_, reject) =>
      setTimeout(
        () => reject(new Error(`Supabase timeout (${ms}ms)`)),
        ms,
      ),
    ),
  ]);
}
