export type LocalSession = {
  user_id: string;
  name: string;
  company_id: string;
  role: string;
  last_login: number;
};

const DB_NAME = 'pontoweb_local';
const DB_VERSION = 3;
const STORE_AUTH = 'auth_session';
const AUTH_KEY = 'session';
const LOCAL_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function reqToPromise<T>(req: IDBRequest): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result as T);
    req.onerror = () => reject(req.error ?? new Error('idb_request_failed'));
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('idb_tx_failed'));
    tx.onabort = () => reject(tx.error ?? new Error('idb_tx_aborted'));
  });
}

function openAuthDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error ?? new Error('idb_open_failed'));
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_AUTH)) {
        db.createObjectStore(STORE_AUTH, { keyPath: 'key' });
      }
    };
  });
}

export async function saveLocalSession(session: LocalSession): Promise<void> {
  const db = await openAuthDb();
  if (!db) return;
  const tx = db.transaction([STORE_AUTH], 'readwrite');
  tx.objectStore(STORE_AUTH).put({
    key: AUTH_KEY,
    value: {
      ...session,
      last_login: Number(session.last_login || Date.now()),
    },
  });
  await txDone(tx);
}

export async function getLocalSession(): Promise<LocalSession | null> {
  const db = await openAuthDb();
  if (!db) return null;
  const tx = db.transaction([STORE_AUTH], 'readonly');
  const row = await reqToPromise<{ key: string; value?: LocalSession } | undefined>(
    tx.objectStore(STORE_AUTH).get(AUTH_KEY),
  );
  const session = row?.value;
  if (!session) return null;
  const age = Date.now() - Number(session.last_login || 0);
  if (!Number.isFinite(age) || age < 0 || age > LOCAL_SESSION_TTL_MS) {
    await clearLocalSession();
    return null;
  }
  return session;
}

export async function clearLocalSession(): Promise<void> {
  const db = await openAuthDb();
  if (!db) return;
  const tx = db.transaction([STORE_AUTH], 'readwrite');
  tx.objectStore(STORE_AUTH).delete(AUTH_KEY);
  await txDone(tx);
}
