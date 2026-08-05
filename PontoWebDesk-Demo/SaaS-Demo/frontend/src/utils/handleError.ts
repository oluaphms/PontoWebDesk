import { observabilityConsole } from '../shared/logger/observabilityConsole';
function isAuthLockContention(error: unknown): boolean {
  const name = (error as { name?: string })?.name ?? '';
  const msg = String((error as { message?: string })?.message ?? error ?? '');
  return (
    name === 'NavigatorLockAcquireTimeoutError' ||
    /lock:sb-.*auth-token|another request stole it|LockAcquireTimeout/i.test(msg)
  );
}

/**
 * Log centralizado de erros (evita catch vazio e falha silenciosa).
 */
export function handleError(error: unknown, context?: string): void {
  const prefix = context ? `[${context}] ` : '';
  if (isAuthLockContention(error)) {
    if (import.meta.env?.DEV) {
      observabilityConsole.debug(prefix + 'contenção de lock legado ignorada.', error);
    }
    return;
  }
  observabilityConsole.error(prefix, error);
}
