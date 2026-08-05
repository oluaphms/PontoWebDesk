/**
 * Época da sessão autenticada no cliente.
 *
 * Incrementada quando um token/sessão novo é gravado ou quando a sessão é limpa.
 * Requests HTTP capturam a época no início; 401/403 de época antiga NÃO podem
 * derrubar a sessão atual (corrida boot /auth/me × login).
 */
import { observabilityConsole } from '../shared/logger/observabilityConsole';

let authSessionEpoch = 0;

type EpochListener = (epoch: number, reason: string) => void;
const epochListeners = new Set<EpochListener>();

export function getAuthSessionEpoch(): number {
  return authSessionEpoch;
}

export function onAuthSessionEpochBump(listener: EpochListener): () => void {
  epochListeners.add(listener);
  return () => {
    epochListeners.delete(listener);
  };
}

export function bumpAuthSessionEpoch(reason: string): number {
  authSessionEpoch += 1;
  observabilityConsole.info('[AUTH-FLOW] SESSION_EPOCH', {
    epoch: authSessionEpoch,
    reason,
    at: new Date().toISOString(),
  });
  for (const listener of epochListeners) {
    try {
      listener(authSessionEpoch, reason);
    } catch {
      // listener não pode quebrar auth
    }
  }
  return authSessionEpoch;
}

/** True quando a request começou antes da sessão atual (login/logout intercalar). */
export function isStaleAuthSessionEpoch(requestEpoch: number): boolean {
  return requestEpoch !== authSessionEpoch;
}
