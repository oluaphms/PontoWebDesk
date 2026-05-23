/**
 * Utilitários de sessão local — Supabase Auth removido do frontend.
 */

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
    // ignora
  }
}

export async function clearBrokenSession(): Promise<void> {
  await clearLocalAuthSession();
}

export async function sanitizeAuthSessionOnBoot(): Promise<void> {
  await clearLocalAuthSession();
}

export function isSupabaseConfigured(): boolean {
  return false;
}

export const checkSupabaseConfigured = isSupabaseConfigured;

export function isSupabaseEnvConfigured(): boolean {
  return false;
}

export function getSupabaseEnvOrNull(): null {
  return null;
}

export async function resetSession(): Promise<void> {
  await clearLocalAuthSession();
}

export async function resetAuthSession(): Promise<void> {
  await clearLocalAuthSession();
}

export function clearStaleSupabaseAuthTokens(): void {
  void clearLocalAuthSession();
}

export function getSupabaseClient(): null {
  return null;
}

export function getSupabaseClientOrThrow(): never {
  throw new Error('Supabase removido — use src/services/api.ts');
}

export const getSupabase = getSupabaseClient;

export const DEFAULT_CONNECTION_TIMEOUT_MS = 10000;
export const DB_SELECT_TIMEOUT_MS = 28000;

export async function testSupabaseConnection(): Promise<{ ok: boolean; message?: string }> {
  return { ok: false, message: 'Supabase removido' };
}

export async function withSupabaseTimeout<T>(
  promise: Promise<{ data: T; error: unknown }>,
): Promise<{ data: T | null; error: unknown }> {
  return promise;
}

export { setSupabaseServiceRoleOverride } from '../src/lib/supabaseClient';

/** Re-export do stub em supabaseClient — compatibilidade com imports legados. */
export { supabase } from './supabaseClient';
