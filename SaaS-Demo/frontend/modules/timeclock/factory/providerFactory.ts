import { TimeClockError } from '../errors/TimeClockError';
import type { TimeClockProvider, TimeClockProviderKey } from '../interfaces/TimeClockProvider';

type FactoryFn = () => TimeClockProvider;

const registry = new Map<TimeClockProviderKey, FactoryFn>();

export function registerTimeClockProvider(key: TimeClockProviderKey, factory: FactoryFn): void {
  registry.set(key, factory);
}

export function hasTimeClockProvider(key: TimeClockProviderKey): boolean {
  return registry.has(key);
}

/** Factory pública — único ponto de criação de provider (sem switch/if por marca fora daqui). */
export function getProvider(type: string): TimeClockProvider {
  const k = type.trim().toLowerCase() as TimeClockProviderKey;
  const fn = registry.get(k);
  if (!fn) {
    throw new TimeClockError(`Provider de relógio não suportado: ${type}`, 'UNKNOWN_PROVIDER', undefined, undefined, k);
  }
  return fn();
}

/** @deprecated Use `getProvider` */
export function getTimeClockProvider(type: string): TimeClockProvider {
  return getProvider(type);
}
