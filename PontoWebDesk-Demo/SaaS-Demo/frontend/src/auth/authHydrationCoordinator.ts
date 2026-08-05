import { observabilityConsole } from '../shared/logger/observabilityConsole';
/**
 * Propriedade única de hidratação: um owner ativo; novos owners invalidam os anteriores.
 */

let activeOwner: string | null = null;

export function createHydrationOwner(prefix: string): string {
  return `${prefix}:${Date.now()}:${Math.random().toString(36).slice(2, 9)}`;
}

/** Para watchdog / telemetria (não usar para lógica de negócio). */
export function getActiveHydrationOwnerToken(): string | null {
  return activeOwner;
}

/**
 * Assume ownership. Se já havia outro owner, o anterior fica stale (callbacks devem checar isHydrationOwnerActive).
 */
export function beginHydration(ownerToken: string): void {
  const previous = activeOwner;
  activeOwner = ownerToken;
  if (typeof console !== 'undefined') {
    observabilityConsole.info('[AUTH HYDRATION OWNERSHIP]', { token: ownerToken, previous });
  }
  if (previous && previous !== ownerToken) {
    if (typeof console !== 'undefined') {
      observabilityConsole.info('[AUTH HYDRATION CANCELLED]', { previous, supersededBy: ownerToken });
    }
  }
}

export function isHydrationOwnerActive(ownerToken: string): boolean {
  return activeOwner === ownerToken;
}

export function endHydration(ownerToken: string): void {
  if (activeOwner === ownerToken) {
    if (typeof console !== 'undefined') {
      observabilityConsole.info('[AUTH HYDRATION COMPLETED]', { token: ownerToken });
    }
    activeOwner = null;
  } else {
    if (typeof console !== 'undefined') {
      observabilityConsole.info('[AUTH HYDRATION STALE]', { token: ownerToken, current: activeOwner });
    }
  }
}

export async function withHydrationTimeout<T>(
  ownerToken: string,
  ms: number,
  fn: () => Promise<T>,
): Promise<T | 'hydration_timeout'> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<'hydration_timeout'>((resolve) => {
    timeoutId = setTimeout(() => resolve('hydration_timeout'), ms);
  });
  try {
    const result = await Promise.race([fn(), timeoutPromise]);
    return result;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}
