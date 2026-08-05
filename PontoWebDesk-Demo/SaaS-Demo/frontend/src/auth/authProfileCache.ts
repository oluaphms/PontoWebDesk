/**
 * Cache em memória de perfil app (tenant-aware), curta duração — evita refetch em hidratação duplicada / foreground.
 */

import type { User } from '../../types';

type Entry = { user: User; expiresAt: number };

const DEFAULT_TTL_MS = 45_000;
const store = new Map<string, Entry>();

function key(userId: string, tenantId: string): string {
  return `${userId}::${tenantId || '_'}`;
}

export function getCachedAuthProfile(userId: string, tenantId: string): User | null {
  const k = key(userId, tenantId);
  const e = store.get(k);
  if (!e) return null;
  if (Date.now() > e.expiresAt) {
    store.delete(k);
    return null;
  }
  return e.user;
}

export function setCachedAuthProfile(userId: string, tenantId: string, user: User, ttlMs = DEFAULT_TTL_MS): void {
  store.set(key(userId, tenantId), { user, expiresAt: Date.now() + ttlMs });
}

export function invalidateAuthProfileCacheForUser(userId: string): void {
  for (const k of store.keys()) {
    if (k.startsWith(`${userId}::`)) store.delete(k);
  }
}

export function clearAuthProfileCache(): void {
  store.clear();
}
