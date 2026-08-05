/**
 * Camada db → API HTTP (VPS). Substitui PostgREST/Supabase no frontend.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { apiDelete, apiGet, apiPatch, apiPost, ApiError, isDataApiWritesDisabled, isApiRateLimited } from './api';
import { getToken } from './authToken';
import { uploadPhotoViaApi } from './uploadPhotoApi';
import { observabilityConsole } from '../shared/logger/observabilityConsole';
import { PlatformService } from '../platform/PlatformService';

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
  | 'not_is'
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

/** RPCs operacionais — permitidas mesmo com DATA_API_WRITES_ENABLED=false na VPS. */
const OPERATIONAL_RPC = new Set([
  'get_my_company_id',
  'insert_time_record_for_user',
  'insert_time_record_for_user_v2',
  'timesheet_is_closed_for_stamp',
  'rep_promote_pending_rep_punch_logs',
  'rep_ingest_punch',
  'rep_match_user_id_for_rep_punch_row',
  'rep_ignore_punch_logs',
]);

/** Escritas operacionais (reconciliação REP, timeline) — backend valida role privilegiada. */
const OPERATIONAL_WRITE_TABLES = new Set([
  'rep_punch_logs',
  'time_attendance_timeline',
  'time_attendance_incident_reviews',
  'time_records',
]);

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
  if (isApiRateLimited()) {
    return [];
  }
  const res = await apiGet<ListResponse>(`/data/${table}${query}`);
  if (res.error) throw new ApiError(res.error, 400, res);
  return Array.isArray(res.data) ? res.data : [];
}

function assertDataWriteAllowed(table?: string): void {
  if (table && OPERATIONAL_WRITE_TABLES.has(table)) return;
  if (isDataApiWritesDisabled()) {
    throw new ApiError('data_api_writes_disabled', 403, { code: 'data_api_writes_disabled' });
  }
}

async function updateDb<T extends DbRow = DbRow>(
  table: string,
  idOrData: string | DbRow,
  dataOrFilters?: DbRow | Filter[],
): Promise<T> {
  assertDataWriteAllowed(table);
  if (typeof idOrData === 'string') {
    const res = await apiPatch<{ ok?: boolean; data?: T; error?: string; message?: string; code?: string }>(
      `/data/${table}/${idOrData}`,
      (dataOrFilters as DbRow) ?? {},
    );
    if (res.error || !res.data) throw new ApiError(res.message || res.error || res.code || 'update_failed', 400, res);
    return res.data;
  }
  const filters = dataOrFilters as Filter[] | undefined;
  const rows = await fetchList(table, listQuery(filters, undefined, 1));
  const id = rows[0]?.id;
  if (!id) throw new ApiError('record_not_found', 404, null);
  return updateDb<T>(table, String(id), idOrData);
}

async function deleteDb(table: string, idOrFilters?: string | Filter[]): Promise<void> {
  assertDataWriteAllowed(table);
  if (typeof idOrFilters === 'string') {
    await apiDelete(`/data/${table}/${idOrFilters}`);
    return;
  }
  const rows = await fetchList(table, listQuery(idOrFilters, undefined, 1000, 'id'));
  const ids = rows.map((row) => row.id).filter((id) => id != null);
  await Promise.all(ids.map((id) => apiDelete(`/data/${table}/${String(id)}`)));
}

/** Polling realtime LOCAL_API — encerrado no bloqueio comercial / logout. */
const activeRealtimeUnsubscribes = new Set<() => void>();
let realtimeSuspended = false;

/**
 * Encerra todos os canais/pollings realtime operacionais.
 * Chamado no bloqueio comercial (licença expirada) e no clearSession.
 */
export function disconnectAllOperationalRealtime(reason = 'session_cleared'): void {
  realtimeSuspended = true;
  const pending = [...activeRealtimeUnsubscribes];
  activeRealtimeUnsubscribes.clear();
  for (const unsub of pending) {
    try {
      unsub();
    } catch {
      /* best-effort */
    }
  }
  observabilityConsole.info('[REALTIME DISCONNECT]', { reason, closed: pending.length });
}

/** Reabilita novas subscriptions após login (sessão válida). */
export function resumeOperationalRealtime(): void {
  realtimeSuspended = false;
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
    assertDataWriteAllowed(table);
    const res = await apiPost<{ ok?: boolean; data?: T; error?: string; message?: string; code?: string }>(`/data/${table}`, data);
    if (res.error || !res.data) throw new ApiError(res.message || res.error || res.code || 'insert_failed', 400, res);
    return res.data as T;
  },

  upsert: async (table: string, data: DbRow, onConflict: string): Promise<void> => {
    if (isDataApiWritesDisabled()) return;
    const conflictColumns = onConflict
      .split(',')
      .map((c) => c.trim())
      .filter(Boolean);
    const conflictFilters =
      conflictColumns.length > 0 && conflictColumns.every((c) => data[c] !== undefined)
        ? conflictColumns.map((column) => ({ column, operator: 'eq' as const, value: data[column] as FilterValue }))
        : [];

    async function patchExistingByConflict(): Promise<boolean> {
      if (!conflictFilters.length) return false;
      const rows = await fetchList(table, listQuery(conflictFilters, { columns: 'id', limit: 1 }));
      const id = rows[0]?.id;
      if (!id) return false;
      await apiPatch(`/data/${table}/${String(id)}`, data);
      return true;
    }

    try {
      if (await patchExistingByConflict()) return;
      await apiPost(`/data/${table}`, data);
    } catch (e) {
      if (await patchExistingByConflict()) return;
      if (data.id) {
        await apiPatch(`/data/${table}/${String(data.id)}`, data);
        return;
      }
      throw e;
    }
  },

  rpc: async <T = unknown>(
    fn: string,
    args?: DbRow,
  ): Promise<{ data: T | null; error: { message: string; code?: string; details?: unknown } | null }> => {
    if (fn.startsWith('rep_')) {
      observabilityConsole.debug('[REP RPC]', fn, args ?? {});
    }
    if (fn === 'rep_promote_pending_rep_punch_logs') {
      try {
        const res = await apiPost<{ ok?: boolean; data?: T; error?: string | null; code?: string; details?: unknown }>(
          '/rep/promote-pending',
          args ?? {},
        );
        if (res.error) {
          return { data: null, error: { message: String(res.error), code: res.code, details: res.details } };
        }
        return { data: (res.data as T) ?? null, error: null };
      } catch (e) {
        const msg = e instanceof ApiError ? e.message : 'rpc_failed';
        return {
          data: null,
          error: {
            message: msg,
            code:
              e instanceof ApiError
                ? String((e.body as Record<string, unknown> | null)?.code ?? '') || undefined
                : undefined,
            details: e instanceof ApiError ? (e.body as Record<string, unknown> | null)?.details : undefined,
          },
        };
      }
    }
    if (!OPERATIONAL_RPC.has(fn) && isDataApiWritesDisabled()) {
      return {
        data: null,
        error: { message: 'data_api_writes_disabled', code: 'data_api_writes_disabled' },
      };
    }
    try {
      const res = await apiPost<{ ok?: boolean; data?: T; error?: string | null; code?: string; details?: unknown }>(
        `/data/rpc/${fn}`,
        args ?? {},
      );
      if (res.error) {
        return { data: null, error: { message: String(res.error), code: res.code, details: res.details } };
      }
      return { data: (res.data as T) ?? null, error: null };
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : 'rpc_failed';
      return {
        data: null,
        error: {
          message: msg,
          code: e instanceof ApiError ? String((e.body as Record<string, unknown> | null)?.code ?? '') || undefined : undefined,
          details: e instanceof ApiError ? (e.body as Record<string, unknown> | null)?.details : undefined,
        },
      };
    }
  },

  update: updateDb,

  delete: deleteDb,

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
    if (isApiRateLimited()) return 0;
    const fp = filtersParam(filters);
    const res = await apiGet<{ count?: number }>(`/data/${table}/count${fp ? `?${fp}` : ''}`);
    return res.count ?? 0;
  },

  /**
   * LOCAL_API: sem WebSocket/Supabase Realtime — polling HTTP aciona o callback
   * para invalidar caches (ex.: useRecords). Intervalo via VITE_LOCAL_REALTIME_POLL_MS.
   * Registro global permite encerrar todos os canais no bloqueio comercial.
   */
  subscribe: (table: string, callback: (payload: DbRealtimePayload) => void, filter?: string): (() => void) => {
    if (realtimeSuspended) {
      return () => undefined;
    }
    const intervalMs = PlatformService.getLocalRealtimePollMs(12_000);

    const tick = () => {
      if (realtimeSuspended) return;
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      try {
        callback({
          schema: 'public',
          table,
          eventType: '*',
          new: null,
          old: null,
          commit_timestamp: new Date().toISOString(),
        });
      } catch (e) {
        observabilityConsole.warn('[db.subscribe] poll callback error', { table, filter, error: e });
      }
    };

    const id = setInterval(tick, intervalMs);
    const unsubscribe = () => {
      clearInterval(id);
      activeRealtimeUnsubscribes.delete(unsubscribe);
    };
    activeRealtimeUnsubscribes.add(unsubscribe);
    return unsubscribe;
  },
};

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
  if (result.ok === false) {
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

type CompatAuth = {
  signUp: (_payload?: unknown) => Promise<{ data: null; error: { message: string } }>;
  signIn?: (_payload?: unknown) => Promise<{ data: null; error: { message: string } }>;
  signInWithPassword: (_payload?: unknown) => Promise<{ data: null; error: { message: string } }>;
  signInWithOAuth: (_payload?: unknown) => Promise<{ data: null; error: { message: string } }>;
  signOut: (_opts?: unknown) => Promise<{ error: null }>;
  getSession: () => Promise<{
    data: { session: { access_token: string; refresh_token: null; user?: unknown } | null };
    error: null;
  }>;
  getUser: () => Promise<{ data: { user: null }; error: null }>;
  refreshSession: (_payload?: unknown) => Promise<{
    data: { session: null };
    error: null;
  }>;
  updateUser: (_attrs: unknown) => Promise<{ data: null; error: null }>;
  updatePassword?: (_payload?: unknown) => Promise<{ data: null; error: { message: string } }>;
  resetPassword?: (_payload?: unknown) => Promise<{ data: null; error: { message: string } }>;
  resetPasswordForEmail: (
    _email: string,
    _options?: unknown,
  ) => Promise<{ data: null; error: null }>;
  setSession: (_payload: unknown) => Promise<{
    data: { session: { access_token: string; refresh_token: null; user?: unknown } | null; user: unknown };
    error: null;
  }>;
  verifyOtp: (_payload: unknown) => Promise<{
    data: { session: { access_token: string; refresh_token: null; user?: unknown } | null; user: unknown };
    error: null;
  }>;
  initialize: () => Promise<void>;
  onAuthStateChange: (
    _cb: (event: string, session: { user?: unknown } | null) => void,
  ) => { data: { subscription: { unsubscribe: () => void } } };
};

export const auth: CompatAuth = {
  signUp: async (_payload?: unknown): Promise<{ data: null; error: { message: string } }> => {
    throw new ApiError('auth_use_api_login', 400, null);
  },
  signIn: async (_payload?: unknown): Promise<{ data: null; error: { message: string } }> => {
    throw new ApiError('auth_use_api_login', 400, null);
  },
  signInWithPassword: async (
    _payload?: unknown,
  ): Promise<{ data: null; error: { message: string } }> => {
    throw new ApiError('auth_use_api_login', 400, null);
  },
  signInWithOAuth: async (
    _payload?: unknown,
  ): Promise<{ data: null; error: { message: string } }> => {
    throw new ApiError('auth_use_api_login', 400, null);
  },
  signOut: async (_opts?: unknown) => ({ error: null }),
  getSession: async () => {
    const token = getToken();
    if (!token) return { data: { session: null }, error: null };
    return {
      data: {
        session: {
          access_token: token,
          refresh_token: null,
          user: null,
        },
      },
      error: null,
    };
  },
  getUser: async () => ({ data: { user: null }, error: null }),
  refreshSession: async (_payload?: unknown) => ({
    data: { session: null },
    error: null,
  }),
  updateUser: async (_attrs: unknown) => ({ data: null, error: null }),
  updatePassword: async (
    _payload?: unknown,
  ): Promise<{ data: null; error: { message: string } }> => {
    throw new ApiError('auth_use_api_login', 400, null);
  },
  resetPassword: async (
    _payload?: unknown,
  ): Promise<{ data: null; error: { message: string } }> => {
    throw new ApiError('auth_use_api_login', 400, null);
  },
  resetPasswordForEmail: async (_email: string, _options?: unknown) => ({
    data: null,
    error: null,
  }),
  setSession: async (_payload: unknown) => ({
    data: { session: null, user: null },
    error: null,
  }),
  verifyOtp: async (_payload: unknown) => ({
    data: { session: null, user: null },
    error: null,
  }),
  initialize: async () => undefined,
  onAuthStateChange: (_cb) => ({
    data: { subscription: { unsubscribe: () => {} } },
  }),
};

type QueryState = {
  table: string;
  columns?: string;
  filters: Filter[];
  order?: OrderBy;
  limit?: number;
  offset?: number;
  countOnly?: boolean;
};

type TableQueryResult = {
  data: DbRow[] | null;
  error: { message: string; code?: string } | null;
  count?: number | null;
};

type TableQueryBuilder = {
  select: (columns?: string, options?: { count?: 'exact'; head?: boolean }) => TableQueryBuilder;
  eq: (column: string, value: FilterValue) => TableQueryBuilder;
  neq: (column: string, value: FilterValue) => TableQueryBuilder;
  not: (column: string, operator: 'is', value: null) => TableQueryBuilder;
  is: (column: string, value: FilterValue) => TableQueryBuilder;
  gte: (column: string, value: FilterValue) => TableQueryBuilder;
  lte: (column: string, value: FilterValue) => TableQueryBuilder;
  gt: (column: string, value: FilterValue) => TableQueryBuilder;
  lt: (column: string, value: FilterValue) => TableQueryBuilder;
  in: (column: string, value: readonly unknown[]) => TableQueryBuilder;
  order: (column: string, options?: { ascending?: boolean }) => TableQueryBuilder;
  range: (from: number, to: number) => TableQueryBuilder;
  abortSignal: (signal: AbortSignal) => TableQueryBuilder;
  limit: (n: number) => TableQueryBuilder;
  maybeSingle: () => Promise<{ data: DbRow | null; error: { message: string; code?: string } | null }>;
  single: () => Promise<{ data: DbRow | null; error: { message: string; code?: string } | null }>;
  then: <TResult1 = TableQueryResult, TResult2 = never>(
    onfulfilled?: ((value: TableQueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ) => Promise<TResult1 | TResult2>;
};

function createTableQuery(table: string): TableQueryBuilder {
  const state: QueryState = { table, filters: [] };

  const runSelect = async (): Promise<TableQueryResult> => {
    try {
      if (state.countOnly) {
        const count = await db.count(state.table, state.filters);
        return { data: null, count, error: null };
      }
      const rows = await db.select(
        state.table,
        state.filters,
        {
          columns: state.columns,
          limit: state.limit,
          offset: state.offset,
          orderBy: state.order,
        },
      );
      return { data: rows, error: null };
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'query_failed';
      return { data: null, error: { message: msg } };
    }
  };

  const builder: TableQueryBuilder = {
    select(columns?: string, options?: { count?: 'exact'; head?: boolean }) {
      if (options?.count === 'exact' && options?.head) {
        state.countOnly = true;
      } else if (typeof columns === 'string') {
        state.columns = columns;
      }
      return builder;
    },
    eq(column: string, value: FilterValue) {
      state.filters.push({ column, operator: 'eq', value });
      return builder;
    },
    neq(column: string, value: FilterValue) {
      state.filters.push({ column, operator: 'neq', value });
      return builder;
    },
    not(column: string, operator: 'is', value: null) {
      if (operator === 'is' && value === null) {
        state.filters.push({ column, operator: 'not_is', value: null });
      }
      return builder;
    },
    is(column: string, value: FilterValue) {
      if (value === null) {
        state.filters.push({ column, operator: 'is', value: null });
      }
      return builder;
    },
    gte(column: string, value: FilterValue) {
      state.filters.push({ column, operator: 'gte', value });
      return builder;
    },
    lte(column: string, value: FilterValue) {
      state.filters.push({ column, operator: 'lte', value });
      return builder;
    },
    gt(column: string, value: FilterValue) {
      state.filters.push({ column, operator: 'gt', value });
      return builder;
    },
    lt(column: string, value: FilterValue) {
      state.filters.push({ column, operator: 'lt', value });
      return builder;
    },
    in(column: string, value: readonly unknown[]) {
      state.filters.push({ column, operator: 'in', value });
      return builder;
    },
    order(column: string, options?: { ascending?: boolean }) {
      state.order = { column, ascending: options?.ascending !== false };
      return builder;
    },
    range(from: number, to: number) {
      state.offset = from;
      state.limit = Math.max(0, to - from + 1);
      return builder;
    },
    abortSignal(_signal: AbortSignal) {
      // Compatibilidade fluente: apiGet ainda não encaminha AbortSignal ao fetch.
      return builder;
    },
    limit(n: number) {
      state.limit = n;
      return builder;
    },
    async maybeSingle() {
      state.limit = 1;
      const res = await runSelect();
      if (res.error) return { data: null, error: res.error };
      return { data: res.data?.[0] ?? null, error: null };
    },
    async single() {
      state.limit = 1;
      const res = await runSelect();
      if (res.error) return { data: null, error: res.error };
      const row = res.data?.[0] ?? null;
      if (!row) return { data: null, error: { message: 'PGRST116' } };
      return { data: row, error: null };
    },
    then(onfulfilled, onrejected) {
      return runSelect().then(onfulfilled, onrejected);
    },
  };

  return builder;
}

type UpdateResult = { data: DbRow[] | null; error: { message: string; code?: string } | null };

function createTableUpdate(table: string, data: DbRow): {
  eq: (column: string, value: FilterValue) => ReturnType<typeof createTableUpdate>;
  neq: (column: string, value: FilterValue) => ReturnType<typeof createTableUpdate>;
  is: (column: string, value: FilterValue) => ReturnType<typeof createTableUpdate>;
  in: (column: string, value: readonly unknown[]) => ReturnType<typeof createTableUpdate>;
  then: (
    onfulfilled?: (value: UpdateResult) => unknown,
    onrejected?: (reason: unknown) => unknown,
  ) => Promise<unknown>;
} {
  const state: { filters: Filter[] } = { filters: [] };

  const runUpdate = async (): Promise<UpdateResult> => {
    try {
      const rows = await db.select(table, state.filters, undefined, 2);
      if (!rows.length) return { data: null, error: { message: 'not_found' } };
      if (rows.length > 1) return { data: null, error: { message: 'multiple_rows' } };
      const id = rows[0]?.id;
      if (!id) return { data: null, error: { message: 'not_found' } };
      const row = await db.update(table, String(id), data);
      return { data: [row], error: null };
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'update_failed';
      return { data: null, error: { message: msg } };
    }
  };

  const builder = {
    eq(column: string, value: FilterValue) {
      state.filters.push({ column, operator: 'eq', value });
      return builder;
    },
    neq(column: string, value: FilterValue) {
      state.filters.push({ column, operator: 'neq', value });
      return builder;
    },
    is(column: string, value: FilterValue) {
      if (value === null) {
        state.filters.push({ column, operator: 'is', value: null });
      }
      return builder;
    },
    in(column: string, value: readonly unknown[]) {
      state.filters.push({ column, operator: 'in', value });
      return builder;
    },
    then(
      onfulfilled?: (value: UpdateResult) => unknown,
      onrejected?: (reason: unknown) => unknown,
    ) {
      return runUpdate().then(onfulfilled, onrejected);
    },
  };

  return builder;
}

type DeleteResult = { data: DbRow[] | null; error: { message: string; code?: string } | null };

function createTableDelete(table: string): {
  eq: (column: string, value: FilterValue) => ReturnType<typeof createTableDelete>;
  neq: (column: string, value: FilterValue) => ReturnType<typeof createTableDelete>;
  is: (column: string, value: FilterValue) => ReturnType<typeof createTableDelete>;
  in: (column: string, value: readonly unknown[]) => ReturnType<typeof createTableDelete>;
  then: (
    onfulfilled?: (value: DeleteResult) => unknown,
    onrejected?: (reason: unknown) => unknown,
  ) => Promise<unknown>;
} {
  const state: { filters: Filter[] } = { filters: [] };

  const runDelete = async (): Promise<DeleteResult> => {
    try {
      await db.delete(table, state.filters);
      return { data: null, error: null };
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'delete_failed';
      return { data: null, error: { message: msg } };
    }
  };

  const builder = {
    eq(column: string, value: FilterValue) {
      state.filters.push({ column, operator: 'eq', value });
      return builder;
    },
    neq(column: string, value: FilterValue) {
      state.filters.push({ column, operator: 'neq', value });
      return builder;
    },
    is(column: string, value: FilterValue) {
      if (value === null) {
        state.filters.push({ column, operator: 'is', value: null });
      }
      return builder;
    },
    in(column: string, value: readonly unknown[]) {
      state.filters.push({ column, operator: 'in', value });
      return builder;
    },
    then(
      onfulfilled?: (value: DeleteResult) => unknown,
      onrejected?: (reason: unknown) => unknown,
    ) {
      return runDelete().then(onfulfilled, onrejected);
    },
  };

  return builder;
}

export const supabase: SupabaseClient = {
  auth,
  storage,
  from: (table: string) => ({
    select: (columns?: string, options?: { count?: 'exact'; head?: boolean }) =>
      createTableQuery(table).select(columns, options),
    insert: (data: DbRow) => {
      const runInsert = async (): Promise<{
        data: DbRow | null;
        error: { message: string; code?: string } | null;
      }> => {
        try {
          const row = await db.insert(table, data);
          return { data: row, error: null };
        } catch (e) {
          const msg = e instanceof ApiError ? e.message : 'insert_failed';
          const code =
            e instanceof ApiError
              ? String((e.body as Record<string, unknown> | null)?.code ?? '') || undefined
              : undefined;
          return { data: null, error: { message: msg, code } };
        }
      };
      return {
        select: (_columns?: string) => ({
          single: () => runInsert(),
          maybeSingle: () => runInsert(),
          then(
            onfulfilled?: (value: {
              data: DbRow | null;
              error: { message: string; code?: string } | null;
            }) => unknown,
            onrejected?: (reason: unknown) => unknown,
          ) {
            return runInsert().then(onfulfilled, onrejected);
          },
        }),
        then(
          onfulfilled?: (value: {
            data: DbRow | null;
            error: { message: string; code?: string } | null;
          }) => unknown,
          onrejected?: (reason: unknown) => unknown,
        ) {
          return runInsert().then(onfulfilled, onrejected);
        },
      };
    },
    upsert: async (
      data: DbRow | DbRow[],
      options?: { onConflict?: string; ignoreDuplicates?: boolean },
    ) => {
      try {
        const onConflict = String(options?.onConflict || 'id');
        const rows = Array.isArray(data) ? data : [data];
        await Promise.all(rows.map((row) => db.upsert(table, row, onConflict)));
        return { data: Array.isArray(data) ? rows : rows[0] ?? null, error: null };
      } catch (e) {
        const msg = e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'upsert_failed';
        if (options?.ignoreDuplicates && msg.toLowerCase().includes('duplicate')) {
          return { data, error: null };
        }
        return { data: null, error: { message: msg } };
      }
    },
    update: (data: DbRow) => createTableUpdate(table, data),
    delete: () => createTableDelete(table),
  }),
  rpc: (fn: string, args?: DbRow) => db.rpc(fn, args),
} as unknown as SupabaseClient;

export { isApiConfigured, isSupabaseCloudEnvConfigured } from '../config/env';

/**
 * Camada de dados disponível (legado: nome “Supabase”).
 * LOCAL_API → API VPS; SUPABASE → credenciais cloud (futuro).
 */
export function isSupabaseConfigured(): boolean {
  return PlatformService.isDataLayerConfigured();
}

export const checkSupabaseConfigured = isSupabaseConfigured;

/** Cliente compatível com código legado Supabase (API VPS via dbHttp). */
export function getSupabaseClient(): typeof supabase | null {
  if (!PlatformService.isDataLayerConfigured()) return null;
  return supabase;
}

export const getSupabase = getSupabaseClient;

export function getSupabaseClientOrThrow(): typeof supabase {
  const client = getSupabaseClient();
  if (!client) {
    throw new Error('Camada de dados não configurada — defina VITE_API_URL.');
  }
  return client;
}

export const DB_SELECT_TIMEOUT_MS = 28000;
export const DEFAULT_CONNECTION_TIMEOUT_MS = 10000;

export async function testSupabaseConnection(): Promise<{ ok: boolean; message?: string }> {
  return { ok: false, message: 'Use GET /api/health na VPS' };
}

export function resetSessionAuthWarmup(): void {}

/** Compatível com Supabase real (serverless REP) e shim dbHttp (frontend LOCAL_API). */
export async function safeUserSelectColumns(
  _client: SupabaseClient | null,
  requested?: string[],
): Promise<string[]> {
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
