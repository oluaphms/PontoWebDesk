import { supabase } from './supabaseClient';
import {
  listReadySyncQueueItems,
  markLocalPunchSynced,
  removeSyncQueueItems,
  rescheduleSyncQueueItems,
  updateSyncQueueStatus,
} from './localDb';

const SYNC_MIN_BATCH = 10;
const SYNC_MAX_BATCH = 50;
const SYNC_INTERVAL_MS = 120_000;
const MAX_BACKOFF_MS = 5 * 60 * 1000;
const OFFLINE_WAIT_MS = 120_000;

let running = false;
let timer: number | null = null;

function nextBackoffMs(retryCount: number): number {
  if (retryCount <= 1) return 30_000;
  if (retryCount === 2) return 60_000;
  if (retryCount === 3) return 120_000;
  return MAX_BACKOFF_MS;
}

function schedule(ms: number): void {
  if (!running) return;
  if (timer != null) window.clearTimeout(timer);
  timer = window.setTimeout(() => {
    void syncLoop();
  }, ms);
}

async function syncLoop(): Promise<void> {
  if (!running) return;
  let inflightIds: string[] = [];
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    schedule(OFFLINE_WAIT_MS);
    return;
  }

  try {
    const ready = await listReadySyncQueueItems(SYNC_MAX_BATCH);
    if (ready.length < SYNC_MIN_BATCH) {
      schedule(SYNC_INTERVAL_MS);
      return;
    }

    const ids = ready.map((item) => item.id);
    inflightIds = ids;
    await updateSyncQueueStatus(ids, 'processing');

    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.access_token) {
      await updateSyncQueueStatus(ids, 'pending');
      schedule(SYNC_INTERVAL_MS);
      return;
    }

    const res = await fetch('/api/punches/batch', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        punches: ready.map((item) => ({
          client_id: item.id,
          punch_hash: item.payload.punch_hash,
          ...item.payload,
        })),
      }),
    });

    const data = (await res.json().catch(() => null)) as {
      degraded?: boolean;
      retry_after?: number;
      results?: Array<{ punch_hash?: string; success?: boolean; duplicate?: boolean }>;
    } | null;

    if (data?.degraded) {
      const retryAt = Date.now() + (data.retry_after ?? 60_000);
      await rescheduleSyncQueueItems(ids, retryAt);
      schedule(data.retry_after ?? SYNC_INTERVAL_MS);
      return;
    }

    if (!res.ok || !data) {
      const retryAt = Date.now() + 60_000;
      await rescheduleSyncQueueItems(ids, retryAt);
      schedule(SYNC_INTERVAL_MS);
      return;
    }

    const resultByHash = new Map<string, { success?: boolean; duplicate?: boolean }>();
    for (const result of data.results ?? []) {
      const key = String(result.punch_hash || '').trim();
      if (!key) continue;
      resultByHash.set(key, result);
    }

    const successIds: string[] = [];
    const retryIds: string[] = [];
    for (const item of ready) {
      const r = resultByHash.get(item.payload.punch_hash);
      if (r?.success || r?.duplicate) {
        successIds.push(item.id);
      } else {
        retryIds.push(item.id);
      }
    }

    await markLocalPunchSynced(successIds);
    await removeSyncQueueItems(successIds);

    if (retryIds.length > 0) {
      const baseRetry = Math.max(
        ...ready.filter((item) => retryIds.includes(item.id)).map((item) => item.retry_count + 1),
      );
      const retryAt = Date.now() + nextBackoffMs(baseRetry);
      await rescheduleSyncQueueItems(retryIds, retryAt);
    }

    schedule(SYNC_INTERVAL_MS);
  } catch {
    if (inflightIds.length > 0) {
      const retryAt = Date.now() + 60_000;
      await rescheduleSyncQueueItems(inflightIds, retryAt);
    }
    schedule(SYNC_INTERVAL_MS);
  }
}

export function startSyncEngine(): void {
  if (running || typeof window === 'undefined') return;
  running = true;
  schedule(1_000);
}

export function stopSyncEngine(): void {
  running = false;
  if (timer != null) {
    window.clearTimeout(timer);
    timer = null;
  }
}
