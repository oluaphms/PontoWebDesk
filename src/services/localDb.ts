import type { RegisterPunchSecureParams } from '../rep/repEngine';

const DB_NAME = 'pontoweb_local';
const DB_VERSION = 4;

const STORES = {
  punches: 'punches',
  employees: 'employees',
  timeRecords: 'time_records',
  settingsCache: 'settings_cache',
  syncQueue: 'sync_queue',
  syncMetadata: 'sync_metadata',
  deviceState: 'device_state',
} as const;

export type LocalPunchRecord = {
  id: string;
  user_id: string;
  timestamp: string;
  type: string;
  punch_hash: string;
  synced: boolean;
  source: 'web' | 'rep';
  payload: RegisterPunchSecureParams;
  created_at: number;
  updated_at: number;
};

export type LocalSyncQueueItem = {
  id: string;
  payload: RegisterPunchSecureParams & { client_id: string; punch_hash: string };
  retry_count: number;
  next_attempt_at: number;
  status: 'pending' | 'processing';
  created_at: number;
  updated_at: number;
};

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

function openLocalDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error ?? new Error('idb_open_failed'));
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORES.punches)) {
        const store = db.createObjectStore(STORES.punches, { keyPath: 'id' });
        store.createIndex('by_user_timestamp', ['user_id', 'timestamp']);
        store.createIndex('by_synced', 'synced');
        store.createIndex('by_punch_hash', 'punch_hash', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORES.employees)) {
        db.createObjectStore(STORES.employees, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORES.timeRecords)) {
        const tr = db.createObjectStore(STORES.timeRecords, { keyPath: 'id' });
        tr.createIndex('by_user_timestamp', ['user_id', 'timestamp']);
      }
      if (!db.objectStoreNames.contains(STORES.settingsCache)) {
        db.createObjectStore(STORES.settingsCache, { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains(STORES.syncQueue)) {
        const queue = db.createObjectStore(STORES.syncQueue, { keyPath: 'id' });
        queue.createIndex('by_next_attempt', 'next_attempt_at');
        queue.createIndex('by_status', 'status');
      }
      if (!db.objectStoreNames.contains(STORES.syncMetadata)) {
        db.createObjectStore(STORES.syncMetadata, { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains(STORES.deviceState)) {
        db.createObjectStore(STORES.deviceState, { keyPath: 'key' });
      }
    };
  });
}

function toHashInput(params: RegisterPunchSecureParams): string {
  return [
    params.userId,
    params.companyId,
    params.type,
    params.method,
    params.source ?? 'web',
    params.latitude ?? '',
    params.longitude ?? '',
    params.recordId ?? '',
    Date.now(),
    Math.random().toString(36).slice(2, 10),
  ].join('|');
}

async function sha256(input: string): Promise<string> {
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const data = new TextEncoder().encode(input);
    const digest = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
  return `local-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

export async function putLocalPunch(params: {
  id: string;
  timestamp: string;
  synced?: boolean;
  punch_hash?: string;
  source?: 'web' | 'rep';
  payload: RegisterPunchSecureParams;
}): Promise<LocalPunchRecord | null> {
  const db = await openLocalDb();
  if (!db) return null;
  const now = Date.now();
  const punchHash = params.punch_hash || (await sha256(toHashInput(params.payload)));
  const record: LocalPunchRecord = {
    id: params.id,
    user_id: params.payload.userId,
    timestamp: params.timestamp,
    type: params.payload.type,
    punch_hash: punchHash,
    synced: params.synced ?? false,
    source: params.source ?? 'web',
    payload: params.payload,
    created_at: now,
    updated_at: now,
  };
  const tx = db.transaction([STORES.punches], 'readwrite');
  tx.objectStore(STORES.punches).put(record);
  await txDone(tx);
  return record;
}

export async function enqueueLocalSyncPunch(
  item: Pick<LocalSyncQueueItem, 'id' | 'payload'> & Partial<LocalSyncQueueItem>,
): Promise<void> {
  const db = await openLocalDb();
  if (!db) return;
  const now = Date.now();
  const tx = db.transaction([STORES.syncQueue], 'readwrite');
  tx.objectStore(STORES.syncQueue).put({
    id: item.id,
    payload: item.payload,
    retry_count: item.retry_count ?? 0,
    next_attempt_at: item.next_attempt_at ?? now,
    status: item.status ?? 'pending',
    created_at: item.created_at ?? now,
    updated_at: now,
  } satisfies LocalSyncQueueItem);
  await txDone(tx);
}

export async function listLocalPunchesForDay(userId: string, dayYmd: string): Promise<LocalPunchRecord[]> {
  const db = await openLocalDb();
  if (!db) return [];
  const tx = db.transaction([STORES.punches], 'readonly');
  const all = await reqToPromise<LocalPunchRecord[]>(tx.objectStore(STORES.punches).getAll());
  return all
    .filter((p) => p.user_id === userId && p.timestamp.slice(0, 10) === dayYmd)
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
}

export async function markLocalPunchSynced(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const db = await openLocalDb();
  if (!db) return;
  const tx = db.transaction([STORES.punches], 'readwrite');
  const store = tx.objectStore(STORES.punches);
  for (const id of ids) {
    const row = await reqToPromise<LocalPunchRecord | undefined>(store.get(id));
    if (!row) continue;
    row.synced = true;
    row.updated_at = Date.now();
    store.put(row);
  }
  await txDone(tx);
}

export async function listReadySyncQueueItems(limit: number): Promise<LocalSyncQueueItem[]> {
  const db = await openLocalDb();
  if (!db) return [];
  const tx = db.transaction([STORES.syncQueue], 'readonly');
  const all = await reqToPromise<LocalSyncQueueItem[]>(tx.objectStore(STORES.syncQueue).getAll());
  const now = Date.now();
  return all
    .filter((item) => item.status === 'pending' && item.next_attempt_at <= now)
    .sort((a, b) => a.next_attempt_at - b.next_attempt_at)
    .slice(0, Math.max(1, limit));
}

export async function updateSyncQueueStatus(ids: string[], status: LocalSyncQueueItem['status']): Promise<void> {
  if (ids.length === 0) return;
  const db = await openLocalDb();
  if (!db) return;
  const tx = db.transaction([STORES.syncQueue], 'readwrite');
  const store = tx.objectStore(STORES.syncQueue);
  for (const id of ids) {
    const row = await reqToPromise<LocalSyncQueueItem | undefined>(store.get(id));
    if (!row) continue;
    store.put({ ...row, status, updated_at: Date.now() } satisfies LocalSyncQueueItem);
  }
  await txDone(tx);
}

export async function removeSyncQueueItems(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const db = await openLocalDb();
  if (!db) return;
  const tx = db.transaction([STORES.syncQueue], 'readwrite');
  const store = tx.objectStore(STORES.syncQueue);
  for (const id of ids) {
    store.delete(id);
  }
  await txDone(tx);
}

export async function rescheduleSyncQueueItems(ids: string[], retryAt: number): Promise<void> {
  if (ids.length === 0) return;
  const db = await openLocalDb();
  if (!db) return;
  const tx = db.transaction([STORES.syncQueue], 'readwrite');
  const store = tx.objectStore(STORES.syncQueue);
  for (const id of ids) {
    const row = await reqToPromise<LocalSyncQueueItem | undefined>(store.get(id));
    if (!row) continue;
    store.put({
      ...row,
      retry_count: row.retry_count + 1,
      status: 'pending',
      next_attempt_at: retryAt,
      updated_at: Date.now(),
    } satisfies LocalSyncQueueItem);
  }
  await txDone(tx);
}

export async function cacheEmployees(rows: Array<Record<string, unknown>>): Promise<void> {
  const db = await openLocalDb();
  if (!db || rows.length === 0) return;
  const tx = db.transaction([STORES.employees], 'readwrite');
  const store = tx.objectStore(STORES.employees);
  for (const row of rows) {
    const id = String(row.id || '').trim();
    if (!id) continue;
    store.put({ ...row, id });
  }
  await txDone(tx);
}

export async function listCachedEmployeesByCompany(companyId: string): Promise<Array<Record<string, unknown>>> {
  const db = await openLocalDb();
  if (!db) return [];
  const tx = db.transaction([STORES.employees], 'readonly');
  const all = await reqToPromise<Array<Record<string, unknown>>>(tx.objectStore(STORES.employees).getAll());
  return all.filter((row) => String(row.company_id || '') === companyId);
}

export async function cacheSettings(settings: Record<string, unknown>): Promise<void> {
  const db = await openLocalDb();
  if (!db) return;
  const tx = db.transaction([STORES.settingsCache], 'readwrite');
  tx.objectStore(STORES.settingsCache).put({
    key: 'global_settings',
    value: settings,
    updated_at: Date.now(),
  });
  await txDone(tx);
}

export async function getCachedSettings<T extends Record<string, unknown>>(): Promise<T | null> {
  const db = await openLocalDb();
  if (!db) return null;
  const tx = db.transaction([STORES.settingsCache], 'readonly');
  const row = await reqToPromise<{ key: string; value?: T } | undefined>(
    tx.objectStore(STORES.settingsCache).get('global_settings'),
  );
  return row?.value ?? null;
}

/** Todas as batidas locais (store `punches`). */
export async function getLocalTimeRecords(): Promise<LocalPunchRecord[]> {
  const db = await openLocalDb();
  if (!db) return [];
  const tx = db.transaction([STORES.punches], 'readonly');
  return reqToPromise<LocalPunchRecord[]>(tx.objectStore(STORES.punches).getAll());
}

export type LocalDashboardCards = {
  totalEmployees: number;
  activeEmployees: number;
  recordsToday: number;
  absentToday: number;
};

function todayYmdLocal(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export async function getLocalAdminDashboardCards(companyId: string): Promise<LocalDashboardCards> {
  const employees = await listCachedEmployeesByCompany(companyId);
  const punches = await getLocalTimeRecords();
  const today = todayYmdLocal();
  const todayPunches = punches.filter((p) => p.timestamp.slice(0, 10) === today);
  const activeIds = new Set(todayPunches.map((p) => p.user_id));
  const staff = employees.filter((u) => {
    const role = String(u.role || '').toLowerCase();
    return role !== 'admin' && role !== 'hr';
  });
  const expected = staff.length;
  return {
    totalEmployees: employees.length,
    activeEmployees: employees.filter((u) => String(u.status || 'active') !== 'inactive').length,
    recordsToday: todayPunches.length,
    absentToday: Math.max(0, expected - activeIds.size),
  };
}

export type LocalDashboardLastRecord = {
  id: string;
  userId: string;
  employeeName: string;
  type: string;
  typeLabel: string;
  date: string;
  time: string;
  location: string;
  originLabel: string;
};

export async function getLocalAdminLastRecords(companyId: string, limit = 8): Promise<LocalDashboardLastRecord[]> {
  const employees = await listCachedEmployeesByCompany(companyId);
  const nameById = new Map(employees.map((u) => [String(u.id), String(u.nome || u.name || u.id)]));
  const today = todayYmdLocal();
  const punches = (await getLocalTimeRecords())
    .filter((p) => p.timestamp.slice(0, 10) === today)
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, limit);

  return punches.map((p) => {
    const d = new Date(p.timestamp);
    const date = d.toLocaleDateString('pt-BR');
    const time = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    const typeLabel =
      p.type === 'entrada' ? 'Entrada' : p.type === 'saída' || p.type === 'saida' ? 'Saída' : 'Batida';
    return {
      id: p.id,
      userId: p.user_id,
      employeeName: nameById.get(p.user_id) ?? p.user_id.slice(0, 8),
      type: p.type,
      typeLabel,
      date,
      time,
      location: '—',
      originLabel: p.source === 'rep' ? 'REP' : 'App',
    };
  });
}
