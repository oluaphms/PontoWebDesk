import { observabilityConsole } from '../../shared/logger/observabilityConsole';
/**
 * Buffer offline-first de amostras GEO operacionais (IndexedDB).
 * Replay ordenado, monotónico e com descarte de amostras stale após reconexão.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { upsertLiveEmployeeLocation } from '../liveEmployeeLocation.service';
import { operationalClockMs } from '../../utils/operationalClock';
import { OperationalIncidentCenter } from '../../domain/operational/geo/operationalGeoIncidentCenter';
import { isOperationalTemporalConfidenceLow } from '../serverOperationalClock.service';
import { operationalPerformanceProfiler } from '../../performance/operationalPerformanceProfiler';
import { operationalReliabilitySLO } from '../../domain/operational/reliability/operationalReliabilitySLO';
import { reportDeviceOperationalReputationEvent } from '../deviceOperationalReputation.service';
import { reportGeoCircuitSignal } from '../../domain/operational/geo/geoOperationalCircuitBreaker';
import { isOperationalReplayEnabled } from '../../domain/operational/governance/operationalFeatureFlags';

const DB_NAME = 'smartponto_offline_geo_ops';
const DB_VERSION = 1;
const STORE = 'geo_ops_buffer';
const META = 'geo_ops_meta';

export type OfflineGeoOperationalRecord = {
  id?: number;
  companyId: string;
  employeeId: string;
  latitude: number;
  longitude: number;
  accuracy: number | null;
  capturedAtMs: number;
  operationalStatus: string | null;
  queuedAtMs: number;
};

function idbOpen(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error ?? new Error('indexeddb_open_failed'));
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const s = db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
        s.createIndex('byEmployee', 'employeeId');
        s.createIndex('byCaptured', 'capturedAtMs');
      }
      if (!db.objectStoreNames.contains(META)) {
        db.createObjectStore(META, { keyPath: 'key' });
      }
    };
  });
}

function idbReq<T>(req: IDBRequest): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result as T);
    req.onerror = () => reject(req.error ?? new Error('idb_request_failed'));
  });
}

function metaKeyLastReplay(employeeId: string): string {
  return `last_replay_captured_ms:${employeeId}`;
}

async function metaGetNumber(db: IDBDatabase, key: string): Promise<number | null> {
  const tx = db.transaction(META, 'readonly');
  const row = await idbReq<{ key: string; value: number } | undefined>(tx.objectStore(META).get(key));
  return row?.value ?? null;
}

async function metaSetNumber(db: IDBDatabase, key: string, value: number): Promise<void> {
  const tx = db.transaction(META, 'readwrite');
  await idbReq(tx.objectStore(META).put({ key, value }));
}

/**
 * Enfileira amostra quando offline ou quando o upsert direto não é possível.
 */
export async function enqueueOfflineGeoOperationalSample(rec: Omit<OfflineGeoOperationalRecord, 'id' | 'queuedAtMs'>): Promise<void> {
  const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
  const db = await idbOpen();
  if (typeof performance !== 'undefined') {
    operationalPerformanceProfiler.recordIndexedDbMs(performance.now() - t0);
  }
  if (!db) return;
  const row: OfflineGeoOperationalRecord = {
    ...rec,
    queuedAtMs: operationalClockMs(),
  };
  const tx = db.transaction(STORE, 'readwrite');
  await idbReq(tx.objectStore(STORE).add(row));
  observabilityConsole.info('[OFFLINE GEO BUFFERED]', {
    company_id: rec.companyId,
    employee_id: rec.employeeId,
    captured_at_ms: rec.capturedAtMs,
  });
}

async function listPendingSorted(db: IDBDatabase, employeeId: string): Promise<OfflineGeoOperationalRecord[]> {
  const tx = db.transaction(STORE, 'readonly');
  const store = tx.objectStore(STORE);
  const idx = store.index('byEmployee');
  const all: OfflineGeoOperationalRecord[] = [];
  await new Promise<void>((resolve, reject) => {
    const cur = idx.openCursor(IDBKeyRange.only(employeeId));
    cur.onerror = () => reject(cur.error);
    cur.onsuccess = () => {
      const c = cur.result;
      if (!c) {
        resolve();
        return;
      }
      all.push(c.value as OfflineGeoOperationalRecord);
      c.continue();
    };
  });
  all.sort((a, b) => a.capturedAtMs - b.capturedAtMs);
  return all;
}

async function deleteIds(db: IDBDatabase, ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  const tx = db.transaction(STORE, 'readwrite');
  const store = tx.objectStore(STORE);
  await Promise.all(ids.map((id) => idbReq(store.delete(id))));
}

const DEFAULT_STALE_AGE_MS = 10 * 60 * 1000;

let replayExcessWindowStart = 0;
let replayExcessInWindow = 0;

/**
 * Reproduz buffer local: ordenado, monotónico em capturedAtMs, descarta stale.
 */
export async function replayOfflineGeoOperationalBuffer(opts: {
  companyId: string;
  employeeId: string;
  client?: SupabaseClient | null;
  nowMs?: number;
  staleMaxAgeMs?: number;
}): Promise<{ replayed: number; droppedStale: number; droppedMonotonic: number }> {
  if (!isOperationalReplayEnabled()) {
    observabilityConsole.info('[OFFLINE GEO REPLAY]', { action: 'disabled_feature_flag' });
    operationalReliabilitySLO.recordReplaySuccess(true);
    return { replayed: 0, droppedStale: 0, droppedMonotonic: 0 };
  }
  if (isOperationalTemporalConfidenceLow()) {
    observabilityConsole.warn('[OFFLINE GEO REPLAY]', { action: 'skipped_low_temporal_confidence' });
    operationalReliabilitySLO.recordReplaySuccess(false);
    return { replayed: 0, droppedStale: 0, droppedMonotonic: 0 };
  }

  const tIdb = typeof performance !== 'undefined' ? performance.now() : 0;
  const db = await idbOpen();
  if (typeof performance !== 'undefined') {
    operationalPerformanceProfiler.recordIndexedDbMs(performance.now() - tIdb);
  }
  if (!db) return { replayed: 0, droppedStale: 0, droppedMonotonic: 0 };
  const nowMs = opts.nowMs ?? operationalClockMs();
  const staleMax = opts.staleMaxAgeMs ?? DEFAULT_STALE_AGE_MS;
  const pending = await listPendingSorted(db, opts.employeeId);
  if (pending.length === 0) {
    operationalReliabilitySLO.recordReplaySuccess(true);
    return { replayed: 0, droppedStale: 0, droppedMonotonic: 0 };
  }

  let lastReplay =
    (await metaGetNumber(db, metaKeyLastReplay(opts.employeeId))) ??
    pending[0]!.capturedAtMs - 1;

  const toDelete: number[] = [];
  let replayed = 0;
  let droppedStale = 0;
  let droppedMonotonic = 0;
  let replayCompleted = true;

  observabilityConsole.info('[OFFLINE GEO REPLAY]', {
    company_id: opts.companyId,
    employee_id: opts.employeeId,
    pending: pending.length,
  });

  for (const row of pending) {
    const id = row.id;
    if (id == null) continue;

    if (nowMs - row.capturedAtMs > staleMax) {
      toDelete.push(id);
      droppedStale++;
      observabilityConsole.info('[OFFLINE GEO DROPPED]', {
        reason: 'stale',
        employee_id: opts.employeeId,
        captured_at_ms: row.capturedAtMs,
        age_ms: nowMs - row.capturedAtMs,
      });
      continue;
    }

    if (row.capturedAtMs <= lastReplay) {
      toDelete.push(id);
      droppedMonotonic++;
      observabilityConsole.info('[OFFLINE GEO DROPPED]', {
        reason: 'non_monotonic',
        employee_id: opts.employeeId,
        captured_at_ms: row.capturedAtMs,
        last_replay_ms: lastReplay,
      });
      continue;
    }

    const res = await upsertLiveEmployeeLocation(
      {
        companyId: opts.companyId,
        employeeId: opts.employeeId,
        latitude: row.latitude,
        longitude: row.longitude,
        accuracy: row.accuracy,
        capturedAtMs: row.capturedAtMs,
        provider: null,
        correlationId: 'offline-geo-replay',
      },
      opts.client ?? null,
    );

    if (!res.ok) {
      observabilityConsole.warn('[OFFLINE GEO REPLAY]', {
        reason: 'upsert_failed_retained',
        employee_id: opts.employeeId,
        error: res.error ?? null,
      });
      OperationalIncidentCenter.record({
        code: 'offline_geo_replay_transient_failure',
        severity: 'WARNING',
        companyId: opts.companyId,
        employeeId: opts.employeeId,
        detail: { error: res.error },
      });
      replayCompleted = false;
      break;
    }

    if (res.skipped) {
      observabilityConsole.info('[OFFLINE GEO DROPPED]', {
        reason: 'server_skipped_invalid',
        employee_id: opts.employeeId,
      });
      toDelete.push(id);
      continue;
    }

    lastReplay = row.capturedAtMs;
    await metaSetNumber(db, metaKeyLastReplay(opts.employeeId), lastReplay);
    toDelete.push(id);
    replayed++;
  }

  await deleteIds(db, toDelete);
  operationalReliabilitySLO.recordReplaySuccess(replayCompleted);

  const w = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const wall = Date.now();
  if (wall - replayExcessWindowStart > 60_000) {
    replayExcessWindowStart = wall;
    replayExcessInWindow = 0;
  }
  replayExcessInWindow += replayed;
  if (replayExcessInWindow >= 12) {
    replayExcessInWindow = 0;
    reportGeoCircuitSignal('stream_congestion');
    void reportDeviceOperationalReputationEvent({
      companyId: opts.companyId,
      employeeId: opts.employeeId,
      event: 'offline_geo_replay_excess',
    });
  }

  return { replayed, droppedStale, droppedMonotonic };
}
