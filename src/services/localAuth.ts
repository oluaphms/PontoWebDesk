export type LocalSession = {
  user_id: string;
  name: string;
  company_id: string;
  role: string;
  last_login: number;
};

export type LocalUser = {
  id: string;
  identifier: string;
  name: string;
  company_id: string;
  role: string;
  password_hash: string;
  pin_hash?: string;
  created_at: number;
  updated_at: number;
};

const DB_NAME = 'pontoweb_local';
const DB_VERSION = 3;
const STORE_AUTH = 'auth_session';
const STORE_USERS = 'users_local';
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
      if (!db.objectStoreNames.contains(STORE_USERS)) {
        const users = db.createObjectStore(STORE_USERS, { keyPath: 'id' });
        users.createIndex('by_identifier', 'identifier', { unique: true });
      }
    };
  });
}

async function sha256(text: string): Promise<string> {
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const bytes = new TextEncoder().encode(text);
    const hash = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(hash))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
  return `hash-${text}`;
}

export async function saveLocalUser(input: {
  identifier: string;
  name: string;
  company_id: string;
  role: string;
  password: string;
  pin?: string;
}): Promise<LocalUser | null> {
  const db = await openAuthDb();
  if (!db) return null;
  const now = Date.now();
  const identifier = String(input.identifier || '').trim().toLowerCase();
  if (!identifier) return null;
  const tx = db.transaction([STORE_USERS], 'readwrite');
  const store = tx.objectStore(STORE_USERS);
  const existing = await reqToPromise<LocalUser | undefined>(store.index('by_identifier').get(identifier));
  const id = existing?.id || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `lu-${now}`);
  const row: LocalUser = {
    id,
    identifier,
    name: input.name,
    company_id: input.company_id,
    role: input.role,
    password_hash: await sha256(input.password),
    pin_hash: input.pin ? await sha256(input.pin) : existing?.pin_hash,
    created_at: existing?.created_at ?? now,
    updated_at: now,
  };
  store.put(row);
  await txDone(tx);
  return row;
}

export async function getLocalUserByIdentifier(identifier: string): Promise<LocalUser | null> {
  const db = await openAuthDb();
  if (!db) return null;
  const tx = db.transaction([STORE_USERS], 'readonly');
  const row = await reqToPromise<LocalUser | undefined>(
    tx.objectStore(STORE_USERS).index('by_identifier').get(String(identifier || '').trim().toLowerCase()),
  );
  return row ?? null;
}

export async function verifyLocalCredentials(identifier: string, secret: string): Promise<LocalUser | null> {
  const row = await getLocalUserByIdentifier(identifier);
  if (!row) return null;
  const hash = await sha256(secret);
  if (hash === row.password_hash || hash === row.pin_hash) {
    return row;
  }
  return null;
}

export async function ensureDefaultLocalAdmin(): Promise<void> {
  const existing = await getLocalUserByIdentifier('admin');
  if (existing) return;
  await saveLocalUser({
    identifier: 'admin',
    name: 'Administrador Local',
    company_id: 'offline-company',
    role: 'admin',
    password: 'offline123',
    pin: '1234',
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
