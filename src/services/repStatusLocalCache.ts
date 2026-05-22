/**
 * Cache local do sync-status REP (evita GET a cada abertura de tela).
 */
import type { DeviceSyncStatusSnapshot } from '../pages/admin/repDevices/types';

const CACHE_KEY = 'rep_status_cache_v1';
const TTL_MS = 10 * 60 * 1000;

type CacheEntry = {
  at: number;
  companyId: string;
  byDevice: Record<string, DeviceSyncStatusSnapshot>;
};

function readRaw(): CacheEntry | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as CacheEntry;
  } catch {
    return null;
  }
}

export function isRepStatusCacheExpired(entry: CacheEntry | null): boolean {
  if (!entry) return true;
  return Date.now() - entry.at > TTL_MS;
}

export function getRepStatusCache(companyId: string): Record<string, DeviceSyncStatusSnapshot> | null {
  const entry = readRaw();
  if (!entry || entry.companyId !== companyId || isRepStatusCacheExpired(entry)) {
    return null;
  }
  return entry.byDevice;
}

export function setRepStatusCache(companyId: string, byDevice: Record<string, DeviceSyncStatusSnapshot>): void {
  const payload: CacheEntry = {
    at: Date.now(),
    companyId,
    byDevice,
  };
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(payload));
  } catch {
    /* quota */
  }
}

export function bustRepStatusCache(): void {
  try {
    localStorage.removeItem(CACHE_KEY);
  } catch {
    /* ignora */
  }
}
