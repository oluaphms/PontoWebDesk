import { observabilityConsole } from '../shared/logger/observabilityConsole';
/**
 * Dump operacional quando o login ultrapassa limiar — sem mascarar causa com timeout “fake” de UX.
 */

export function logAuthWatchdogDump(payload: Record<string, unknown>): void {
  if (typeof console === 'undefined') return;
  observabilityConsole.warn('[AUTH WATCHDOG DUMP]', payload);
}
