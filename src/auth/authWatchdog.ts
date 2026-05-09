/**
 * Dump operacional quando o login ultrapassa limiar — sem mascarar causa com timeout “fake” de UX.
 */

export function logAuthWatchdogDump(payload: Record<string, unknown>): void {
  if (typeof console === 'undefined') return;
  console.warn('[AUTH WATCHDOG DUMP]', payload);
}
