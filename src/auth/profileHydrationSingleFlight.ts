/**
 * Um único fetch de perfil por authUserId por vez; concorrentes reutilizam a mesma Promise.
 */

import { getAuthDuplicateDiagnostics } from './authDuplicateRequestAudit';

const inflight = new Map<string, Promise<unknown>>();

export type ProfileFlightMeta = {
  reason: string;
  pipelineId?: number | null;
  attemptId?: number | null;
};

/**
 * Executa factory uma vez por `authUserId` até concluir; chamadas paralelas recebem a mesma Promise.
 */
export function runProfileHydrationSingleFlight<T>(
  authUserId: string,
  factory: () => Promise<T>,
  meta: ProfileFlightMeta,
): Promise<T> {
  const dup = getAuthDuplicateDiagnostics();
  const existing = inflight.get(authUserId) as Promise<T> | undefined;
  if (existing) {
    if (typeof console !== 'undefined') {
      console.info('[PROFILE SINGLE FLIGHT REUSED]', { authUserId, ...meta, ...dup });
    }
    return existing;
  }
  if (typeof console !== 'undefined') {
    console.info('[PROFILE SINGLE FLIGHT CREATED]', { authUserId, ...meta, ...dup });
  }
  const p = factory().finally(() => {
    if (inflight.get(authUserId) === p) {
      inflight.delete(authUserId);
      if (typeof console !== 'undefined') {
        console.info('[PROFILE SINGLE FLIGHT RELEASED]', { authUserId, ...meta, ...dup });
      }
    }
  }) as Promise<T>;
  inflight.set(authUserId, p);
  return p;
}

export function clearProfileHydrationInflight(): void {
  inflight.clear();
}
