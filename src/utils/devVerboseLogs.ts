import { observabilityConsole } from '../shared/logger/observabilityConsole';
/**
 * Controle central de logs verbosos em desenvolvimento.
 * Por padrão fica desligado para reduzir ruído no console.
 *
 * Ative manualmente no browser:
 *   localStorage.setItem('pw:verbose-logs', '1')
 */
export function isDevVerboseLogsEnabled(): boolean {
  if (typeof import.meta !== 'undefined' && !import.meta.env.DEV) return false;
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem('pw:verbose-logs') === '1';
  } catch {
    return false;
  }
}

export function devVerboseInfo(tag: string, payload?: unknown): void {
  if (!isDevVerboseLogsEnabled()) return;
  if (payload === undefined) observabilityConsole.info(tag);
  else observabilityConsole.info(tag, payload);
}
