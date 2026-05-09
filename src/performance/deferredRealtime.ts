import { isCriticalLoginPathActive } from '../auth/authBootstrapPriority';
import { isRestrictedBootstrapMode } from './networkMode';

/**
 * Só depois de interativo + visível + idle (e fora do caminho crítico de login), inicia realtime pesado.
 */
export function startDeferredRealtime(run: () => void): () => void {
  let cancelled = false;
  let done = false;

  const iv = setInterval(() => {
    if (cancelled || done) return;
    if (typeof document !== 'undefined') {
      if (document.visibilityState !== 'visible') return;
      if (document.readyState !== 'complete' && document.readyState !== 'interactive') return;
    }
    if (isCriticalLoginPathActive()) return;

    done = true;
    clearInterval(iv);

    const w = window as Window & { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number };
    const timeoutMs = isRestrictedBootstrapMode() ? 5200 : 2600;
    if (w.requestIdleCallback) {
      w.requestIdleCallback(
        () => {
          if (!cancelled) run();
        },
        { timeout: timeoutMs },
      );
    } else {
      window.setTimeout(() => {
        if (!cancelled) run();
      }, Math.min(900, timeoutMs));
    }
  }, 360);

  return () => {
    cancelled = true;
    clearInterval(iv);
  };
}
