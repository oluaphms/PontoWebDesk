import { openPontowebLocalDb } from './localDb';

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

async function sha256(text: string): Promise<string> {
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const bytes = new TextEncoder().encode(text);
    const hash = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(hash))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
  throw new Error('crypto.subtle_unavailable');
}

export async function saveLocalUser(input: {
  identifier: string;
  name: string;
  company_id: string;
  role: string;
  password: string;
  pin?: string;
}): Promise<LocalUser | null> {
  const db = await openPontowebLocalDb();
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
  const db = await openPontowebLocalDb();
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
  // RC produção: nunca seedar senha/PIN padrão.
  if (import.meta.env.PROD) return;
  const allowSeed = String(import.meta.env.VITE_ALLOW_OFFLINE_ADMIN_SEED || '')
    .trim()
    .toLowerCase();
  if (allowSeed !== '1' && allowSeed !== 'true' && allowSeed !== 'yes') return;

  const existing = await getLocalUserByIdentifier('admin');
  if (existing) return;
  const password = String(import.meta.env.VITE_OFFLINE_ADMIN_PASSWORD || '').trim();
  const pin = String(import.meta.env.VITE_OFFLINE_ADMIN_PIN || '').trim();
  if (password.length < 10 || pin.length < 4) return;
  await saveLocalUser({
    identifier: 'admin',
    name: 'Administrador Local',
    company_id: 'offline-company',
    role: 'admin',
    password,
    pin,
  });
}

export async function saveLocalSession(session: LocalSession): Promise<void> {
  const db = await openPontowebLocalDb();
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
  const db = await openPontowebLocalDb();
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
  const db = await openPontowebLocalDb();
  if (!db) return;
  const tx = db.transaction([STORE_AUTH], 'readwrite');
  tx.objectStore(STORE_AUTH).delete(AUTH_KEY);
  await txDone(tx);
}
