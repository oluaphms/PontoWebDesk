import { observabilityConsole } from '../shared/logger/observabilityConsole';
import { IS_DEV } from '../config/runtimeEnv';

/**
 * Controle central de logs verbosos em desenvolvimento.
 * Por padrão fica desligado para reduzir ruído no console.
 *
 * Ative manualmente no browser:
 *   localStorage.setItem('pw:verbose-logs', '1')
 */
export function isDevVerboseLogsEnabled(): boolean {
  if (!IS_DEV) return false;
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
