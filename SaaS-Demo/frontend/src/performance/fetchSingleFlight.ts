import { observabilityConsole } from '../shared/logger/observabilityConsole';
/**
 * Single-flight global: mesma chave lógica → uma promise em voo (dedupe paralelo).
 */
const inflight = new Map<string, Promise<unknown>>();

export function runSingleFlight<T>(key: string, factory: () => Promise<T>): Promise<T> {
  const existing = inflight.get(key) as Promise<T> | undefined;
  if (existing) {
    if (typeof console !== 'undefined') {
      observabilityConsole.info('[FETCH SINGLE-FLIGHT]', { key, reused: true });
    }
    return existing;
  }

  const promise = factory().finally(() => {
    inflight.delete(key);
  }) as Promise<T>;

  inflight.set(key, promise);
  return promise;
}
