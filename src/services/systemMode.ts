import { isSupabaseBlocked } from '../utils/supabaseGuard';

let degraded =
  typeof sessionStorage !== 'undefined' && sessionStorage.getItem('pontoweb:degraded_mode') === '1';

export function enableDegradedMode(): void {
  if (degraded) return;
  degraded = true;
  if (typeof sessionStorage !== 'undefined') {
    try {
      sessionStorage.setItem('pontoweb:degraded_mode', '1');
    } catch {
      /* ignore */
    }
  }
  console.warn('[SYSTEM] Modo degradado ativo (sem cloud)');
}

export function isDegradedMode(): boolean {
  if (degraded) return true;
  if (typeof sessionStorage !== 'undefined') {
    try {
      return sessionStorage.getItem('pontoweb:degraded_mode') === '1';
    } catch {
      return false;
    }
  }
  return false;
}

export function clearDegradedMode(): void {
  degraded = false;
  if (typeof sessionStorage !== 'undefined') {
    try {
      sessionStorage.removeItem('pontoweb:degraded_mode');
    } catch {
      /* ignore */
    }
  }
}

/** @deprecated Use `isSupabaseBlocked` de `@/utils/supabaseGuard`. */
export { isSupabaseBlocked };
