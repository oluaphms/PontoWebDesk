/**
 * Inicialização do cliente Supabase.
 *
 * Modo degradado: falhas de rede/DNS são registradas em console.warn mas NUNCA bloqueiam
 * chamadas — especialmente auth/login. O fetch passa sempre pelo interceptor sem throw.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { LockFunc } from '@supabase/auth-js';
import { isDnsError, markSupabaseAsDown } from '../services/supabaseCircuitBreaker';
import { getSupabaseInfraFatal } from './supabaseInfraGuard';
import { assertEnv } from './assertEnv';

let supabaseInstance: SupabaseClient | null = null;
/** Só true após falha “permanente” (URL inválida / createClient falhou). assertEnv falhar ainda permite nova tentativa. */
let initFailedPermanent = false;

function sanitizeSupabaseUrl(rawUrl: string): string {
  return String(rawUrl || '').trim().replace(/\/+$/, '');
}

/**
 * Fila única para operações internas do GoTrue (getSession, refresh, persistência).
 * Evita `NavigatorLockAcquireTimeoutError` quando muitos componentes chamam auth em paralelo
 * (o padrão usa Web Locks API e “rouba” o lock entre si).
 */
function createInProcessAuthLock(): LockFunc {
  let tail: Promise<unknown> = Promise.resolve();
  return (_name, _acquireTimeout, fn) => {
    const run = tail.then(() => fn());
    tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };
}

/**
 * Obter cliente Supabase (lazy init).
 * Retorna null apenas se as variáveis de ambiente estiverem ausentes/inválidas.
 * Falhas de rede não impedem a criação nem o uso do cliente.
 */
export function getSupabaseClient(): SupabaseClient | null {
  if (typeof window !== 'undefined' && (window as any).__ENV_FATAL_ERROR) {
    return null;
  }
  if (getSupabaseInfraFatal()) {
    return null;
  }
  if (supabaseInstance) return supabaseInstance;
  if (initFailedPermanent) return null;

  let env: { url: string; key: string };
  try {
    env = assertEnv();
  } catch {
    return null;
  }

  const url = sanitizeSupabaseUrl(env.url);
  const key = env.key;

  if (!url.startsWith('https://') || !url.includes('.supabase.co')) {
    console.error('[SUPABASE] URL inválida');
    initFailedPermanent = true;
    return null;
  }

  try {
    supabaseInstance = createClient(url, key, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
        lock: createInProcessAuthLock(),
      },
      global: {
        fetch: async (input, init) => {
          if (typeof navigator !== 'undefined' && navigator.onLine === false) {
            console.warn('[SUPABASE] modo degradado ativo — navigator.onLine=false; tentando mesmo assim...');
          }
          try {
            return await fetch(input, init);
          } catch (error) {
            if (isDnsError(error)) {
              console.warn('[SUPABASE] modo degradado ativo — falha de DNS:', (error as Error).message);
              markSupabaseAsDown();
            } else if (String((error as any)?.message || '').toLowerCase().includes('timeout')) {
              console.warn('[SUPABASE] modo degradado ativo — timeout de rede');
            } else {
              console.warn('[SUPABASE] modo degradado ativo — falha de rede:', (error as Error).message);
            }
            throw error;
          }
        },
      },
    });

    console.log('[SUPABASE] Cliente inicializado');
    return supabaseInstance;
  } catch (error) {
    console.error('[SUPABASE] Erro ao criar cliente:', error);
    initFailedPermanent = true;
    return null;
  }
}

/** Alias pedido pelo padrão do projeto — sempre retorna o singleton atual. */
export const getSupabase = getSupabaseClient;

/**
 * Obter cliente Supabase com garantia (lança erro se variáveis ausentes).
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

export function resetSupabaseClient(): void {
  supabaseInstance = null;
  initFailedPermanent = false;
}

export async function resetSession(): Promise<void> {
  const client = getSupabaseClient();
  if (client) {
    await client.auth.signOut();
  }
}

export const DEFAULT_CONNECTION_TIMEOUT_MS = 10000;
export const DB_SELECT_TIMEOUT_MS = 28000;

/**
 * Diagnóstico não bloqueante: verifica se o Supabase está acessível.
 * Nunca deve ser chamada no caminho crítico de login/autenticação.
 */
export async function testSupabaseConnection(
  timeoutMs: number = DEFAULT_CONNECTION_TIMEOUT_MS,
): Promise<{ ok: boolean; message?: string }> {
  const client = getSupabaseClient();
  if (!client) {
    return { ok: false, message: 'Supabase não inicializado. Verifique as variáveis de ambiente.' };
  }
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('timeout')), timeoutMs),
  );
  try {
    const { error } = await Promise.race([
      client.from('punches').select('id').limit(1),
      timeoutPromise,
    ]);
    if (!error || error.code === 'PGRST116') return { ok: true };
    return { ok: false, message: 'Não foi possível conectar ao Supabase.' };
  } catch (e: any) {
    if (e?.message === 'timeout') {
      return { ok: false, message: 'Supabase timeout. Projeto pode estar pausado ou rede lenta.' };
    }
    return { ok: false, message: 'Não foi possível conectar ao Supabase.' };
  }
}

/**
 * Executa uma promise do Supabase com timeout.
 */
export async function withSupabaseTimeout<T>(
  promise: Promise<{ data: T; error: any }>,
  ms: number = DEFAULT_CONNECTION_TIMEOUT_MS,
): Promise<{ data: T; error: any }> {
  return Promise.race([
    promise,
    new Promise<{ data: null; error: { message: string } }>((_, reject) =>
      setTimeout(() => reject(new Error(`Supabase timeout (${ms}ms)`)), ms),
    ),
  ]);
}
