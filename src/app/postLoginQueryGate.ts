/**
 * Cooldown pós-login: reduz tempestade de invalidação/refetch e foco na aba.
 */
import { devVerboseInfo } from '../utils/devVerboseLogs';

export const POST_LOGIN_QUERY_COOLDOWN_MS = 12_000;

let cooldownUntil = 0;

export function beginPostLoginQueryCooldown(reason?: string): void {
  cooldownUntil = Date.now() + POST_LOGIN_QUERY_COOLDOWN_MS;
  devVerboseInfo('[POST LOGIN QUERY COOLDOWN]', { reason: reason ?? 'unspecified', ms: POST_LOGIN_QUERY_COOLDOWN_MS });
}

export function isPostLoginQueryCooldownActive(): boolean {
  return Date.now() < cooldownUntil;
}

/** Prefixos de queryKey que podem invalidar/refetch durante o cooldown. */
const CRITICAL_QUERY_HEADS = new Set(['records']);

export function isCriticalReactQueryKey(queryKey: readonly unknown[] | undefined): boolean {
  if (!queryKey?.length) return false;
  const head = queryKey[0];
  return typeof head === 'string' && CRITICAL_QUERY_HEADS.has(head);
}
