import { observabilityConsole } from '../shared/logger/observabilityConsole';
import { useEffect, useRef, type DependencyList } from 'react';

const DEFAULT_WINDOW_MS = 200;
const DEFAULT_STORM_THRESHOLD = 4;

/**
 * Detecta execuções repetidas do mesmo efeito em janela curta (deps instáveis ou loops).
 * Para janela 5s + diff de deps + duração, usar `useTracedEffect` em `reactEffectTrace.ts`.
 */
export function useEffectStormProbe(
  name: string,
  deps: DependencyList,
  opts?: { windowMs?: number; threshold?: number },
): void {
  const windowMs = opts?.windowMs ?? DEFAULT_WINDOW_MS;
  const threshold = opts?.threshold ?? DEFAULT_STORM_THRESHOLD;
  const runsRef = useRef<number[]>([]);

  useEffect(() => {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const buf = runsRef.current;
    buf.push(now);
    while (buf.length && now - (buf[0] as number) > windowMs) {
      buf.shift();
    }
    if (buf.length >= threshold && typeof console !== 'undefined') {
      observabilityConsole.warn('[REACT EFFECT STORM]', {
        name,
        runsInWindow: buf.length,
        windowMs,
        depsLength: deps.length,
      });
    }
  }, deps);
}
