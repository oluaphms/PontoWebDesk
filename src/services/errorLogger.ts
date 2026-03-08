/**
 * Logger centralizado para erros Supabase: rede, timeout e auth.
 */

export type ErrorCategory = 'network' | 'timeout' | 'auth' | 'unknown';

export interface LoggedError {
  category: ErrorCategory;
  message: string;
  detail?: unknown;
  timestamp: string;
}

const log: LoggedError[] = [];
const maxLogSize = 100;

function normalizeError(error: unknown): { message: string; category: ErrorCategory } {
  const msg = error instanceof Error ? error.message : String(error);
  const lower = msg.toLowerCase();

  if (lower.includes('timeout') || lower.includes('tempo esgotado')) {
    return { message: msg, category: 'timeout' };
  }
  if (
    lower.includes('failed to fetch') ||
    lower.includes('network') ||
    lower.includes('load failed')
  ) {
    return { message: msg, category: 'network' };
  }
  if (
    lower.includes('auth') ||
    lower.includes('session') ||
    lower.includes('token') ||
    lower.includes('jwt')
  ) {
    return { message: msg, category: 'auth' };
  }
  return { message: msg, category: 'unknown' };
}

/**
 * Registra um erro (network, timeout, auth) para diagnóstico.
 */
export function logSupabaseError(error: unknown, detail?: unknown): void {
  const { message, category } = normalizeError(error);
  const entry: LoggedError = {
    category,
    message,
    detail,
    timestamp: new Date().toISOString(),
  };
  log.push(entry);
  if (log.length > maxLogSize) log.shift();

  if (typeof console !== 'undefined') {
    console.warn('[SmartPonto]', category, message, detail ?? '');
  }
}

/**
 * Retorna as últimas entradas do log (para debug ou UI).
 */
export function getErrorLog(limit: number = 20): LoggedError[] {
  return log.slice(-limit);
}

/**
 * Limpa o log em memória.
 */
export function clearErrorLog(): void {
  log.length = 0;
}
