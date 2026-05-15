/**
 * Supabase Configuration and Initialization
 *
 * Cliente sempre via singleton `getSupabaseClient()` — o export `supabase` é um Proxy
 * que encaminha para a instância atual (evita valor congelado no primeiro import).
 */

import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseClient, getSupabaseClientOrThrow, resetSession, resetAuthSession, getSupabase } from '../src/lib/supabaseClient';

export { resetSession, resetAuthSession, getSupabase, getSupabaseClient, getSupabaseClientOrThrow };

/** Encaminha para o singleton; não recria cliente a cada acesso. */
export const supabase: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    if (prop === 'then') return undefined;
    const client = getSupabaseClient();
    if (!client) {
      console.warn('[supabase] acesso sem cliente inicializado:', String(prop));
      return undefined;
    }
    const value = (client as unknown as Record<string | symbol, unknown>)[prop as string];
    return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(client) : value;
  },
}) as SupabaseClient;

/** Verificação em tempo real (não use valor congelado de import). */
export function isSupabaseConfigured(): boolean {
  return !!getSupabaseClient();
}

/** @deprecated Use `isSupabaseConfigured` para manter nomenclatura única. */
export function checkSupabaseConfigured(): boolean {
  return isSupabaseConfigured();
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

export function isOnline(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
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

export async function clearBrokenSession(): Promise<void> {
  if (!checkSupabaseConfigured()) return;
  try {
    const client = getSupabaseClientOrThrow();
    await client.auth.signOut();
  } catch {
    // segue com limpeza local
  } finally {
    await clearLocalAuthSession();
  }
}

/**
 * Corrige sessões órfãs no boot (ex.: refresh token inválido após deploy/troca de projeto).
 * Não derruba sessão válida.
 */
export async function sanitizeAuthSessionOnBoot(): Promise<void> {
  if (!checkSupabaseConfigured()) return;
  try {
    const client = getSupabaseClientOrThrow();
    const { error } = await client.auth.getSession();
    if (!error) return;
    const msg = String(error.message || '').toLowerCase();
    const isInvalidRefresh =
      msg.includes('invalid refresh token') ||
      msg.includes('refresh token not found') ||
      msg.includes('jwt expired');
    if (isInvalidRefresh) {
      await clearBrokenSession();
    }
  } catch (e) {
    const msg = String((e as { message?: string })?.message || e || '').toLowerCase();
    if (
      msg.includes('invalid refresh token') ||
      msg.includes('refresh token not found') ||
      msg.includes('jwt expired')
    ) {
      await clearBrokenSession();
    }
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

  try {
    const { error } = await Promise.race([
      client.from('punches').select('id').limit(1),
      timeoutPromise,
    ]);
    if (!error || error.code === 'PGRST116') {
      console.log('[SmartPonto] Supabase conectado (tabela: punches)');
      return { ok: true };
    }
    return { ok: false, message: 'Não foi possível conectar ao Supabase.' };
  } catch (e: unknown) {
    if (e instanceof Error && e.message === 'timeout') {
      return { ok: false, message: 'Supabase timeout. Projeto pode estar pausado ou rede lenta.' };
    }
    return { ok: false, message: 'Não foi possível conectar ao Supabase.' };
  }
}

/**
 * Executa uma promise do Supabase com timeout
 */
export async function withSupabaseTimeout<T>(
  promise: Promise<{ data: T; error: PostgrestError | null }>,
  ms: number = DEFAULT_CONNECTION_TIMEOUT_MS,
): Promise<{ data: T | null; error: PostgrestError | null | { message: string } }> {
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
