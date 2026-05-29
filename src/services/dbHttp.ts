/**
 * Camada db → API HTTP (VPS). Substitui PostgREST/Supabase no frontend.
 */
import { apiDelete, apiGet, apiPatch, apiPost, ApiError } from './api';
import { uploadPhotoViaApi } from './uploadPhotoApi';

export type FilterOperator =
  | 'eq'
  | 'neq'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'like'
  | 'ilike'
  | 'in'
  | 'is'
  | 'contains';

export type FilterValue =
  | string
  | number
  | boolean
  | null
  | readonly unknown[]
  | Record<string, unknown>;

export interface Filter {
  column: string;
  operator: FilterOperator;
  value: FilterValue;
}

interface OrderBy {
  column: string;
  ascending?: boolean;
}

interface SelectOptions {
  columns?: string;
  limit?: number;
  offset?: number;
  orderBy?: OrderBy;
}

export type DbRow = Record<string, unknown>;

export type DbRealtimePayload = {
  schema?: string;
  table?: string;
  commit_timestamp?: string;
  eventType?: string;
  new?: DbRow | null;
  old?: DbRow | null;
};

const DEFAULT_SELECT_LIMIT = 200;

type ListResponse = { ok?: boolean; data?: DbRow[]; count?: number; error?: string };

function filtersParam(filters?: Filter[]): string {
  return filters?.length ? `filters=${encodeURIComponent(JSON.stringify(filters))}` : '';
}

function listQuery(
  filters?: Filter[],
  orderBy?: OrderBy | SelectOptions,
  limit?: number,
  columns?: string,
): string {
  const parts: string[] = [];
  const fp = filtersParam(filters);
  if (fp) parts.push(fp);

  let finalLimit = limit;
  let offset = 0;
  let finalOrderBy: OrderBy | undefined;
  let cols = columns;

  if (orderBy && 'columns' in orderBy) {
    const opts = orderBy as SelectOptions;
    cols = opts.columns || cols;
    finalLimit = opts.limit ?? finalLimit;
    offset = opts.offset || 0;
    finalOrderBy = opts.orderBy;
  } else {
    finalOrderBy = orderBy as OrderBy | undefined;
  }

  if (cols) parts.push(`columns=${encodeURIComponent(cols)}`);
  if (finalLimit != null) parts.push(`limit=${finalLimit}`);
  if (offset > 0) parts.push(`offset=${offset}`);
  if (finalOrderBy?.column) {
    parts.push(`orderColumn=${encodeURIComponent(finalOrderBy.column)}`);
    parts.push(`orderAsc=${finalOrderBy.ascending !== false}`);
  }
  return parts.length ? `?${parts.join('&')}` : '';
}

async function fetchList(table: string, query: string): Promise<DbRow[]> {
  const res = await apiGet<ListResponse>(`/data/${table}${query}`);
  if (res.error) throw new ApiError(res.error, 400, res);
  return Array.isArray(res.data) ? res.data : [];
}

export const db = {
  select: async <T extends DbRow = DbRow>(
    table: string,
    filters?: Filter[],
    orderBy?: OrderBy | SelectOptions,
    limit?: number,
  ): Promise<T[]> => {
    const q = listQuery(filters, orderBy, limit ?? DEFAULT_SELECT_LIMIT);
    return (await fetchList(table, q)) as T[];
  },

  insert: async <T extends DbRow = DbRow>(table: string, data: DbRow): Promise<T> => {
    const res = await apiPost<{ ok?: boolean; data?: T; error?: string }>(`/data/${table}`, data);
    if (res.error || !res.data) throw new ApiError(res.error || 'insert_failed', 400, res);
    return res.data as T;
  },

  upsert: async (table: string, data: DbRow, _onConflict: string): Promise<void> => {
    try {
      await apiPost(`/data/${table}`, data);
    } catch (e) {
      if (data.id) {
        await apiPatch(`/data/${table}/${String(data.id)}`, data);
        return;
      }
      throw e;
    }
  },

  rpc: async <T = unknown>(fn: string, args?: DbRow): Promise<{ data: T | null; error: { message: string } | null }> => {
    try {
      const res = await apiPost<{ ok?: boolean; data?: T; error?: string | null }>(
        `/data/rpc/${fn}`,
        args ?? {},
      );
      if (res.error) return { data: null, error: { message: String(res.error) } };
      return { data: (res.data as T) ?? null, error: null };
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : 'rpc_failed';
      return { data: null, error: { message: msg } };
    }
  },

  update: (async <T extends DbRow = DbRow>(
    table: string,
    idOrData: string | DbRow,
    dataOrFilters?: DbRow | Filter[],
  ): Promise<T> => {
    if (typeof idOrData === 'string') {
      const res = await apiPatch<{ ok?: boolean; data?: T; error?: string }>(
        `/data/${table}/${idOrData}`,
        (dataOrFilters as DbRow) ?? {},
      );
      if (res.error || !res.data) throw new ApiError(res.error || 'update_failed', 400, res);
      return res.data as T;
    }
    const filters = dataOrFilters as Filter[] | undefined;
    const rows = await fetchList(table, listQuery(filters, undefined, 1));
    const id = rows[0]?.id;
    if (!id) throw new ApiError('record_not_found', 404, null);
    return db.update<T>(table, String(id), idOrData);
  }) as DbInterface['update'],

  delete: (async (table: string, idOrFilters?: string | Filter[]): Promise<void> => {
    if (typeof idOrFilters === 'string') {
      await apiDelete(`/data/${table}/${idOrFilters}`);
      return;
    }
    const rows = await fetchList(table, listQuery(idOrFilters, undefined, 1));
    const id = rows[0]?.id;
    if (id) await apiDelete(`/data/${table}/${String(id)}`);
  }) as DbInterface['delete'],

  findById: async <T extends DbRow = DbRow>(table: string, id: string, columns?: string): Promise<T | null> => {
    const q = listQuery([{ column: 'id', operator: 'eq', value: id }], undefined, 1, columns);
    const rows = await fetchList(table, q);
    return (rows[0] as T) ?? null;
  },

  selectPaginated: async <T extends DbRow = DbRow>(
    table: string,
    options: {
      columns?: string;
      filters?: Filter[];
      orderBy?: OrderBy;
      limit?: number;
      offset?: number;
      count?: boolean;
    },
  ): Promise<{ data: T[]; count: number | null }> => {
    const q = listQuery(options.filters, {
      columns: options.columns,
      limit: options.limit ?? 50,
      offset: options.offset ?? 0,
      orderBy: options.orderBy,
    });
    const data = (await fetchList(table, q)) as T[];
    let count: number | null = null;
    if (options.count) {
      const fp = filtersParam(options.filters);
      const cRes = await apiGet<{ count?: number }>(`/data/${table}/count${fp ? `?${fp}` : ''}`);
      count = cRes.count ?? data.length;
    }
    return { data, count };
  },

  count: async (table: string, filters?: Filter[]): Promise<number> => {
    const fp = filtersParam(filters);
    const res = await apiGet<{ count?: number }>(`/data/${table}/count${fp ? `?${fp}` : ''}`);
    return res.count ?? 0;
  },

  subscribe: (_table: string, _callback: (payload: DbRealtimePayload) => void, _filter?: string): (() => void) => {
    return () => {};
  },
};

type DbInterface = typeof db;

const uploadedPhotoUrls = new Map<string, string>();

function photoUploadKey(bucket: string, path: string): string {
  return `${bucket}/${path}`;
}

async function uploadToPhotosApi(
  bucket: string,
  path: string,
  file: File | Blob,
): Promise<string> {
  if (bucket !== 'photos') {
    throw new ApiError('bucket_not_supported', 400, null);
  }
  const kind = path.includes('avatar') ? 'avatar' : 'punch';
  const f = file instanceof File ? file : new File([file], path.split('/').pop() || 'photo.jpg', { type: 'image/jpeg' });
  const result = await uploadPhotoViaApi({ file: f, kind });
  if (!result.ok) {
    throw new ApiError(result.error, 400, null);
  }
  uploadedPhotoUrls.set(photoUploadKey(bucket, path), result.url);
  return result.url;
}

export const storage = {
  from: (bucket: string) => ({
    upload: async (path: string, file: File | Blob) => {
      await uploadToPhotosApi(bucket, path, file);
    },
    getPublicUrl: (path: string) => ({
      data: {
        publicUrl:
          uploadedPhotoUrls.get(photoUploadKey(bucket, path)) ||
          (path.startsWith('http') ? path : ''),
      },
    }),
  }),
  upload: async (bucket: string, path: string, file: File | Blob) => {
    await uploadToPhotosApi(bucket, path, file);
  },
  getPublicUrl: (bucket: string, path: string) =>
    uploadedPhotoUrls.get(photoUploadKey(bucket, path)) || (path.startsWith('http') ? path : ''),
};

export const auth = {
  signUp: async () => {
    throw new ApiError('auth_use_api_login', 400, null);
  },
  signIn: async () => {
    throw new ApiError('auth_use_api_login', 400, null);
  },
  signInWithPassword: async () => {
    throw new ApiError('auth_use_api_login', 400, null);
  },
  signInWithOAuth: async () => {
    throw new ApiError('auth_use_api_login', 400, null);
  },
  signOut: async () => ({ error: null }),
  getSession: async () => ({ data: { session: null }, error: null }),
  getUser: async () => ({ data: { user: null }, error: null }),
  updatePassword: async () => {
    throw new ApiError('auth_use_api_login', 400, null);
  },
  resetPassword: async () => {
    throw new ApiError('auth_use_api_login', 400, null);
  },
  onAuthStateChange: () => ({
    data: { subscription: { unsubscribe: () => {} } },
  }),
};

export const supabase = {
  auth,
  storage,
  from: (table: string) => ({
    select: () => ({
      eq: () => ({
        limit: async () => ({ data: await db.select(table), error: null }),
      }),
    }),
    insert: () => ({
      select: () => ({
        single: async () => {
          throw new ApiError('use_db_insert', 400, null);
        },
      }),
    }),
    update: () => ({
      eq: async () => ({ data: null, error: null }),
    }),
    delete: () => ({
      eq: async () => ({ data: null, error: null }),
    }),
  }),
  rpc: (fn: string, args?: DbRow) => db.rpc(fn, args),
};

import { isDataLayerConfigured } from '../config/system';

export { isApiConfigured, isSupabaseCloudEnvConfigured } from '../config/env';

/**
 * Camada de dados disponível (legado: nome “Supabase”).
 * LOCAL_API → API VPS; SUPABASE → credenciais cloud (futuro).
 */
export function isSupabaseConfigured(): boolean {
  return isDataLayerConfigured();
}

export const checkSupabaseConfigured = isSupabaseConfigured;

export function getSupabaseClient(): never {
  throw new Error('Supabase removido. Use apiClient, dbHttp ou services dedicados (employeesApi, punchesApi).');
}

export const getSupabase = getSupabaseClient;

export function getSupabaseClientOrThrow(): never {
  throw new Error('Supabase removido — use src/services/api.ts');
}

export const DB_SELECT_TIMEOUT_MS = 28000;
export const DEFAULT_CONNECTION_TIMEOUT_MS = 10000;

export async function testSupabaseConnection(): Promise<{ ok: boolean; message?: string }> {
  return { ok: false, message: 'Use GET /api/health na VPS' };
}

export function resetSessionAuthWarmup(): void {}

export async function safeUserSelectColumns(_client: null, requested?: string[]): Promise<string[]> {
  return requested?.length ? requested : ['id', 'company_id', 'nome', 'email', 'role'];
}

export function resetUsersSafeSelectCache(): void {}

export {
  clearCurrentUserFromAllStorages,
  getUserProfileStorage,
  useSessionStorageForAuth,
  clearLocalAuthSession,
  clearBrokenSession,
  isOnline,
  resetSession,
  resetAuthSession,
  clearStaleSupabaseAuthTokens,
  sanitizeAuthSessionOnBoot,
} from '../../services/supabase';
