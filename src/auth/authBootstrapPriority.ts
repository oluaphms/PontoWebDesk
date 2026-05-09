/**
 * Separa bootstrap crítico (login) de trabalho diferido (dashboard, GEO, métricas, etc.).
 * Durante o caminho crítico, serviços podem consultar `isCriticalLoginPathActive()` e adiar trabalho pesado.
 */

let criticalDepth = 0;

export function pushCriticalLoginPath(): void {
  criticalDepth++;
}

export function popCriticalLoginPath(): void {
  criticalDepth = Math.max(0, criticalDepth - 1);
}

export function isCriticalLoginPathActive(): boolean {
  return criticalDepth > 0;
}

type DeferredFn = () => void | Promise<void>;

/**
 * Executa após o login crítico: se ainda estiver em caminho crítico, agenda em idle / macrotask.
 */
export function scheduleDeferredBootstrap(label: string, fn: DeferredFn): void {
  const run = () => {
    void Promise.resolve()
      .then(fn)
      .catch((e) => {
        if (typeof console !== 'undefined') {
          console.warn('[AUTH DEFERRED BOOTSTRAP]', { label, error: e instanceof Error ? e.message : String(e) });
        }
      });
  };

  if (!isCriticalLoginPathActive()) {
    run();
    return;
  }

  const w = typeof window !== 'undefined' ? window : undefined;
  if (w && 'requestIdleCallback' in w) {
    (w as Window & { requestIdleCallback: (cb: () => void, opts?: { timeout: number }) => void }).requestIdleCallback(
      run,
      { timeout: 4000 },
    );
  } else {
    globalThis.setTimeout(run, 0);
  }
}
