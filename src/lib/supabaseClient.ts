/**
 * ETAPA 1 - Inicialização Segura e Tardia do Supabase
 * Lazy initialization - só cria o client quando as variáveis estão disponíveis
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';

let supabaseInstance: SupabaseClient | null = null;
let initializationAttempted = false;

/**
 * Obter cliente Supabase com inicialização segura
 * Retorna null se as variáveis não estiverem disponíveis
 */
export function getSupabaseClient(): SupabaseClient | null {
  // Se já foi criado, retornar a instância
  if (supabaseInstance) {
    return supabaseInstance;
  }

  // Se já tentou e falhou, não tentar novamente
  if (initializationAttempted) {
    return null;
  }

  // Marcar que tentou
  initializationAttempted = true;

  // Tentar ler as variáveis de múltiplas fontes
  const url =
    (import.meta.env.VITE_SUPABASE_URL as string | undefined) ||
    (typeof window !== 'undefined' && (window as any).__VITE_SUPABASE_URL) ||
    (typeof window !== 'undefined' && (window as any).ENV?.SUPABASE_URL) ||
    '';

  const key =
    (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ||
    (typeof window !== 'undefined' && (window as any).__VITE_SUPABASE_ANON_KEY) ||
    (typeof window !== 'undefined' && (window as any).ENV?.SUPABASE_ANON_KEY) ||
    '';

  // Validar se as variáveis estão disponíveis
  if (!url || !key) {
    console.error(
      '❌ [Supabase] Variáveis de ambiente não carregadas ainda.',
      { url: !!url, key: !!key }
    );
    return null;
  }

  // Validar formato da URL
  if (!url.startsWith('https://') || !url.includes('.supabase.co')) {
    console.error('❌ [Supabase] URL inválida:', url);
    return null;
  }

  try {
    // Criar a instância com configuração padrão (compatível com sessões existentes)
    supabaseInstance = createClient(url, key, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });

    console.log('✅ [Supabase] Cliente inicializado com sucesso');
    console.log(`   URL: ${url.slice(0, 40)}...`);
    console.log(`   Key: ${key.slice(0, 20)}...`);

    return supabaseInstance;
  } catch (error) {
    console.error('❌ [Supabase] Erro ao criar cliente:', error);
    return null;
  }
}

/**
 * Obter cliente Supabase com garantia (lança erro se não conseguir)
 */
export function getSupabaseClientOrThrow(): SupabaseClient {
  const client = getSupabaseClient();
  if (!client) {
    throw new Error(
      'Supabase não inicializado. Verifique se VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY estão definidas.'
    );
  }
  return client;
}

/**
 * Resetar a instância (útil para testes)
 */
export function resetSupabaseClient(): void {
  supabaseInstance = null;
  initializationAttempted = false;
}

/**
 * Resetar a sessão de autenticação
 */
export async function resetSession(): Promise<void> {
  const client = getSupabaseClient();
  if (client) {
    await client.auth.signOut();
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
