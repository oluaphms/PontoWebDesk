/**
 * IndexedDB para fila de batidas web/mobile (resistente a limpeza de cache vs localStorage).
 */
import type { QueuedWebPunch } from './punchOfflineQueue.types';

const DB_NAME = 'pontoweb_punch_queue';
const DB_VERSION = 1;
const STORE = 'punches';
const META = 'meta';
const LEGACY_LS_KEY = 'pontoweb_punch_queue_v1';

function idbOpen(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error ?? new Error('indexeddb_open_failed'));
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const s = db.createObjectStore(STORE, { keyPath: 'id' });
        s.createIndex('byStatus', 'status');
        s.createIndex('byCreated', 'createdAt');
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

async function metaGet(db: IDBDatabase, key: string): Promise<boolean> {
  const tx = db.transaction(META, 'readonly');
  const row = await idbReq<{ key: string; migratedFromLocalStorage?: boolean } | undefined>(
    tx.objectStore(META).get(key),
  );
  return Boolean(row?.migratedFromLocalStorage);
}

async function metaSet(db: IDBDatabase, key: string, value: Record<string, unknown>): Promise<void> {
  const tx = db.transaction(META, 'readwrite');
  await idbReq(tx.objectStore(META).put({ key, ...value }));
}

/** Migra fila legada do localStorage uma única vez. */
export async function migrateLegacyPunchQueueFromLocalStorage(): Promise<number> {
  if (typeof localStorage === 'undefined') return 0;
  const db = await idbOpen();
  if (!db) return 0;
  if (await metaGet(db, 'ls_migrated')) return 0;

  let migrated = 0;
  try {
    const raw = localStorage.getItem(LEGACY_LS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { items?: QueuedWebPunch[] };
      const items = Array.isArray(parsed?.items) ? parsed.items : [];
      if (items.length > 0) {
        const tx = db.transaction(STORE, 'readwrite');
        const store = tx.objectStore(STORE);
        for (const item of items) {
          if (item?.id) {
            await idbReq(store.put(item));
            migrated += 1;
          }
        }
      }
      localStorage.removeItem(LEGACY_LS_KEY);
    }
  } catch {
    /* ignora migração corrompida */
  }
  await metaSet(db, 'ls_migrated', { migratedFromLocalStorage: true, at: Date.now() });
  return migrated;
}

export async function idbPutPunch(item: QueuedWebPunch): Promise<void> {
  const db = await idbOpen();
  if (!db) throw new Error('IndexedDB indisponível');
  const tx = db.transaction(STORE, 'readwrite');
  await idbReq(tx.objectStore(STORE).put(item));
}

export async function idbGetPunch(id: string): Promise<QueuedWebPunch | undefined> {
  const db = await idbOpen();
  if (!db) return undefined;
  const tx = db.transaction(STORE, 'readonly');
  return idbReq<QueuedWebPunch | undefined>(tx.objectStore(STORE).get(id));
}

export async function idbListPunchesByStatus(status: QueuedWebPunch['status']): Promise<QueuedWebPunch[]> {
  const db = await idbOpen();
  if (!db) return [];
  const tx = db.transaction(STORE, 'readonly');
  const idx = tx.objectStore(STORE).index('byStatus');
  return idbReq<QueuedWebPunch[]>(idx.getAll(status));
}

export async function idbCountPending(): Promise<number> {
  const pending = await idbListPunchesByStatus('pending');
  return pending.length;
}

export async function idbUpdatePunch(item: QueuedWebPunch): Promise<void> {
  await idbPutPunch(item);
}

export async function idbDeletePunch(id: string): Promise<void> {
  const db = await idbOpen();
  if (!db) return;
  const tx = db.transaction(STORE, 'readwrite');
  await idbReq(tx.objectStore(STORE).delete(id));
}

export async function ensurePunchOfflineDbReady(): Promise<void> {
  await migrateLegacyPunchQueueFromLocalStorage();
}
