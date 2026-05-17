/**
 * Re-export de supabase para compatibilidade com código existente
 * Todos os imports devem vir daqui
 */

export { 
  supabase, 
  isSupabaseConfigured, 
  checkSupabaseConfigured,
  getUserProfileStorage, 
  clearCurrentUserFromAllStorages, 
  useSessionStorageForAuth,
  DB_SELECT_TIMEOUT_MS,
  DEFAULT_CONNECTION_TIMEOUT_MS,
  clearLocalAuthSession,
  clearBrokenSession,
  isOnline
} from './supabase';
export {
  getSupabaseClient,
  getSupabaseClientOrThrow,
  getSupabase,
  testSupabaseConnection,
  withSupabaseTimeout,
  resetSession,
  resetAuthSession,
  clearStaleSupabaseAuthTokens,
  setSupabaseServiceRoleOverride,
} from '../src/lib/supabaseClient';

// Criar aliases para db e storage (compatibilidade com código antigo)
import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseClient } from '../src/lib/supabaseClient';
import { withTimeout } from '../src/utils/withTimeout';
import { DB_SELECT_TIMEOUT_MS } from './supabase';

/** Evita REST com JWT ainda não hidratado do storage (sintoma: dados vazios até relogar). */
/** Sessão lenta (IndexedDB / lock do GoTrue) — evitar timeout prematuro antes do primeiro REST. */
const GET_SESSION_BEFORE_DB_MS = 20000;

/**
 * Uma única promessa de “aquecimento” por sessão de página.
 * Vários `db.select` em paralelo (ex.: Promise.all no Espelho de Ponto) não devem cada um
 * chamar `getSession` ao mesmo tempo — isso pode travar IndexedDB / auth e deixar a UI em loading infinito.
 */
let sessionAuthWarmup: Promise<void> | null = null;

/** Após logout, permite novo `getSession` antes das queries (evita reuso da promessa antiga). */
export function resetSessionAuthWarmup(): void {
  sessionAuthWarmup = null;
}

async function ensureSupabaseAuthSessionReady(client: SupabaseClient): Promise<void> {
  if (!sessionAuthWarmup) {
    sessionAuthWarmup = (async () => {
      try {
        await withTimeout(client.auth.getSession(), GET_SESSION_BEFORE_DB_MS, 'auth.getSession (db)');
      } catch {
        // segue: sem sessão o RLS pode retornar vazio
      }
    })();
  }
  await sessionAuthWarmup;
}

// Tipos para filtros (exportados para uso em páginas/serviços com db.select)
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

/** Valores aceitos em filtros PostgREST no wrapper legado `db`. */
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

type AuthOnChangeCallback = Parameters<SupabaseClient['auth']['onAuthStateChange']>[0];

// Limite padrão para evitar carregamento de dados excessivos
const DEFAULT_SELECT_LIMIT = 200;

// ---------------------------------------------------------------------------
// HARD LOCK produção: safe select (evita 400 por colunas inexistentes)
// ---------------------------------------------------------------------------

/** Base estável para match / RLS — expandir só após probe bem-sucedido. */
const USERS_SELECT_MINIMAL = ['id', 'cpf', 'company_id'] as const;

/** Quando nenhuma lista é pedida, tenta estes extras (REP / auto-fix). */
const USERS_SELECT_DEFAULT_EXTRAS = ['pis', 'pis_pasep', 'status', 'invisivel', 'demissao'] as const;

/** Colunas já validadas por probe nesta sessão (cresce conforme novos selects). */
let userSelectCapabilityCache: string[] | null = null;

/** Momento em que o cache foi populado ou estendido com sucesso (TTL de revalidação). */
let userSelectCapabilityCacheAtMs: number | null = null;

const USERS_SAFE_SELECT_CACHE_TTL_MS = 5 * 60 * 1000;

/** HTTP 400 / coluna inexistente no PostgREST — lista cacheada de colunas pode estar obsoleta. */
function shouldResetUsersSafeSelectCacheOnError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const e = error as Record<string, unknown>;
  const status = Number(e.status ?? e.statusCode);
  if (status === 400) return true;
  const code = String(e.code ?? '');
  if (code === '42703') return true;
  return false;
}

export function resetUsersSafeSelectCache(): void {
  userSelectCapabilityCache = null;
  userSelectCapabilityCacheAtMs = null;
}

function uniqueColumns(cols: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const c of cols) {
    const k = String(c || '').trim();
    if (!k) continue;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(k);
  }
  return out;
}

function pickUserColumnsForRequest(available: readonly string[], requested?: string[]): string[] {
  const avail = new Set(available.map((c) => String(c).trim()).filter(Boolean));
  if (!requested?.length) return uniqueColumns([...available]);
  const out: string[] = [];
  for (const c of requested) {
    const k = String(c || '').trim();
    if (k && avail.has(k)) out.push(k);
  }
  for (const must of ['id', 'company_id'] as const) {
    if (avail.has(must) && !out.includes(must)) out.unshift(must);
  }
  return uniqueColumns(out);
}

/**
 * Colunas seguras para `users.select(...)`: probe com `id,cpf,company_id`, depois adiciona
 * cada coluna pedida (ou extras padrão) só se o SELECT passar. Capacidade é cacheada e vai
 * crescendo entre chamadas (REP + Employees + admin).
 */
export async function safeUserSelectColumns(
  client: SupabaseClient,
  requested?: string[],
): Promise<string[]> {
  async function probe(columns: string[]): Promise<boolean> {
    const sel = uniqueColumns(columns).join(',');
    const { error } = await client.from('users').select(sel).limit(1);
    if (error) {
      console.error('[USERS QUERY ERROR]', error);
      // Não chamar reset aqui: coluna opcional inválida geraria loop com re-tentativa da mesma coluna.
      return false;
    }
    return true;
  }

  if (
    userSelectCapabilityCache &&
    userSelectCapabilityCacheAtMs != null &&
    Date.now() - userSelectCapabilityCacheAtMs > USERS_SAFE_SELECT_CACHE_TTL_MS
  ) {
    resetUsersSafeSelectCache();
  }

  if (!userSelectCapabilityCache) {
    if (await probe([...USERS_SELECT_MINIMAL])) {
      userSelectCapabilityCache = [...USERS_SELECT_MINIMAL];
      userSelectCapabilityCacheAtMs = Date.now();
    } else if (await probe(['id', 'company_id'])) {
      userSelectCapabilityCache = ['id', 'company_id'];
      userSelectCapabilityCacheAtMs = Date.now();
    } else {
      console.error('[USERS QUERY ERROR]', new Error('Probe users (id, company_id) falhou'));
      userSelectCapabilityCache = ['id', 'company_id'];
      userSelectCapabilityCacheAtMs = Date.now();
    }
    if (import.meta.env?.DEV) {
      console.info('[SUPABASE SAFE SELECT]', { columns: userSelectCapabilityCache, phase: 'base' });
    }
  }

  const tryAdd = uniqueColumns(
    (requested?.length
      ? requested.filter((c) => !userSelectCapabilityCache!.includes(String(c).trim()))
      : [...USERS_SELECT_DEFAULT_EXTRAS].filter((c) => !userSelectCapabilityCache!.includes(c))
    ).map((c) => String(c).trim()),
  );

  let grown = false;
  for (const col of tryAdd) {
    if (!col || userSelectCapabilityCache.includes(col)) continue;
    const next = [...userSelectCapabilityCache, col];
    if (await probe(next)) {
      userSelectCapabilityCache = next;
      userSelectCapabilityCacheAtMs = Date.now();
      grown = true;
    }
  }
  if (grown) {
    if (import.meta.env?.DEV) {
      console.info('[SUPABASE SAFE SELECT]', { columns: userSelectCapabilityCache, phase: 'extended' });
    }
  }

  return pickUserColumnsForRequest(userSelectCapabilityCache, requested);
}

/** Linha genérica retornada por `db.select` / PostgREST até haver tipos gerados. */
export type DbRow = Record<string, unknown>;

/** Payload mínimo entregue pelo Realtime em `postgres_changes` (sem tipagem gerada). */
export type DbRealtimePayload = {
  schema?: string;
  table?: string;
  commit_timestamp?: string;
  eventType?: string;
  new?: DbRow | null;
  old?: DbRow | null;
};

// Interface do db com sobrecargas para compatibilidade
interface DbInterface {
  select: <T extends DbRow = DbRow>(
    table: string,
    filters?: Filter[],
    orderBy?: OrderBy | SelectOptions,
    limit?: number,
  ) => Promise<T[]>;
  insert: <T extends DbRow = DbRow>(table: string, data: DbRow) => Promise<T>;
  /** PostgREST upsert; onConflict ex.: 'company_id,snapshot_date' */
  upsert: (table: string, data: DbRow, onConflict: string) => Promise<void>;
  rpc: <T = unknown>(
    fn: string,
    args?: DbRow,
  ) => Promise<{ data: T | null; error: PostgrestError | null }>;
  // Sobrecargas para update: (table, id, data) ou (table, data, filters)
  update: (<T extends DbRow = DbRow>(table: string, id: string, data: DbRow) => Promise<T>) &
    (<T extends DbRow = DbRow>(table: string, data: DbRow, filters?: Filter[]) => Promise<T>);
  // Sobrecargas para delete: (table, id) ou (table, filters)
  delete: ((table: string, id: string) => Promise<void>) & ((table: string, filters?: Filter[]) => Promise<void>);
  findById: <T extends DbRow = DbRow>(table: string, id: string, columns?: string) => Promise<T | null>;
  selectPaginated: <T extends DbRow = DbRow>(
    table: string,
    options: {
      columns?: string;
      filters?: Filter[];
      orderBy?: OrderBy;
      limit?: number;
      offset?: number;
      count?: boolean;
    },
  ) => Promise<{ data: T[]; count: number | null }>;
  count: (table: string, filters?: Filter[]) => Promise<number>;
  subscribe: (table: string, callback: (payload: DbRealtimePayload) => void, filter?: string) => () => void;
}

// Implementação completa do db com suporte a filtros, ordenação e limite
export const db: DbInterface = {
  select: async <T extends DbRow = DbRow>(
    table: string,
    filters?: Filter[],
    orderBy?: OrderBy | SelectOptions,
    limit?: number
  ): Promise<T[]> => {
    const client = getSupabaseClient();
    if (!client) throw new Error('Supabase não inicializado');
    await ensureSupabaseAuthSessionReady(client);

    // Suporte a nova API com options object
    let columns = '*';
    let finalLimit = limit;
    let finalOrderBy: OrderBy | undefined;
    let offset = 0;

    if (orderBy && 'columns' in orderBy) {
      // Nova API: orderBy é SelectOptions
      const options = orderBy as SelectOptions;
      columns = options.columns || '*';
      finalLimit = options.limit;
      offset = options.offset || 0;
      finalOrderBy = options.orderBy;
    } else {
      finalOrderBy = orderBy as OrderBy | undefined;
    }

    // HARD LOCK: evitar 400 por colunas inexistentes em produção
    if (table === 'users' && columns && columns !== '*' && columns.trim() !== '') {
      const req = columns.split(',').map((c) => c.trim()).filter(Boolean);
      const safe = await safeUserSelectColumns(client, req);
      columns = safe.join(',');
    }

    // Aplicar limite padrão se não especificado (evita carregar tabelas inteiras)
    if (finalLimit === undefined) {
      finalLimit = DEFAULT_SELECT_LIMIT;
    }

    let query = client.from(table).select(columns);

    // Aplicar filtros
    if (filters && filters.length > 0) {
      for (const filter of filters) {
        const { column, operator, value } = filter;
        switch (operator) {
          case 'eq':
            query = query.eq(column, value as never);
            break;
          case 'neq':
            query = query.neq(column, value as never);
            break;
          case 'gt':
            query = query.gt(column, value as never);
            break;
          case 'gte':
            query = query.gte(column, value as never);
            break;
          case 'lt':
            query = query.lt(column, value as never);
            break;
          case 'lte':
            query = query.lte(column, value as never);
            break;
          case 'like':
            query = query.like(column, String(value));
            break;
          case 'ilike':
            query = query.ilike(column, String(value));
            break;
          case 'in':
            query = query.in(column, Array.isArray(value) ? value : [value]);
            break;
          case 'is':
            query = query.is(column, value as null | boolean);
            break;
          case 'contains':
            query = query.contains(column, value as string | readonly unknown[] | Record<string, unknown>);
            break;
          default:
            query = query.eq(column, value as never);
        }
      }
    }

    // Aplicar ordenação
    if (finalOrderBy) {
      query = query.order(finalOrderBy.column, { ascending: finalOrderBy.ascending ?? true });
    }

    // Aplicar paginação (range) ou limite
    if (offset > 0 && finalLimit && finalLimit > 0) {
      query = query.range(offset, offset + finalLimit - 1);
    } else if (finalLimit && finalLimit > 0) {
      query = query.limit(finalLimit);
    }

    // PostgREST builder é thenable; await explícito evita edge cases com Promise.resolve.
    const { data, error } = await withTimeout(
      query as unknown as Promise<{ data: T[] | null; error: PostgrestError | null }>,
      DB_SELECT_TIMEOUT_MS,
      `db.select(${table})`,
    );

    if (error) {
      if (table === 'users') {
        console.error('[USERS QUERY ERROR]', error);
        if (shouldResetUsersSafeSelectCacheOnError(error)) {
          resetUsersSafeSelectCache();
        }
      }
      throw new Error(`Erro ao buscar dados de ${table}: ${error.message}`);
    }

    return (data || []) as T[];
  },

  insert: async <T extends DbRow = DbRow>(table: string, data: DbRow): Promise<T> => {
    const client = getSupabaseClient();
    if (!client) throw new Error('Supabase não inicializado');
    await ensureSupabaseAuthSessionReady(client);

    const { data: result, error } = await client.from(table).insert(data).select().single();

    if (error) {
      throw new Error(`Erro ao inserir em ${table}: ${error.message}`);
    }

    return result as T;
  },

  upsert: async (table: string, data: DbRow, onConflict: string): Promise<void> => {
    const client = getSupabaseClient();
    if (!client) throw new Error('Supabase não inicializado');
    await ensureSupabaseAuthSessionReady(client);

    const { error } = await client.from(table).upsert(data, { onConflict });

    if (error) {
      throw new Error(`Erro ao upsert em ${table}: ${error.message}`);
    }
  },

  rpc: async <T = unknown>(fn: string, args?: DbRow): Promise<{ data: T | null; error: PostgrestError | null }> => {
    const client = getSupabaseClient();
    if (!client) throw new Error('Supabase não inicializado');
    await ensureSupabaseAuthSessionReady(client);
    return client.rpc(fn, args ?? {});
  },

  update: async <T extends DbRow = DbRow>(
    table: string,
    idOrData: string | DbRow,
    dataOrFilters?: DbRow | Filter[],
  ): Promise<T> => {
    const client = getSupabaseClient();
    if (!client) throw new Error('Supabase não inicializado');
    await ensureSupabaseAuthSessionReady(client);

    // Suporte a duas sintaxes:
    // 1. update(table, id, data) - atualiza por ID
    // 2. update(table, data, filters) - atualiza com filtros
    let data: DbRow;
    let filters: Filter[] | undefined;

    if (typeof idOrData === 'string') {
      // Sintaxe: update(table, id, data)
      data = dataOrFilters as DbRow;
      filters = [{ column: 'id', operator: 'eq', value: idOrData }];
    } else {
      // Sintaxe: update(table, data, filters)
      data = idOrData;
      filters = dataOrFilters as Filter[] | undefined;
    }

    let query = client.from(table).update(data);

    // Aplicar filtros para update
    if (filters && filters.length > 0) {
      for (const filter of filters) {
        const { column, operator, value } = filter;
        switch (operator) {
          case 'eq':
            query = query.eq(column, value as never);
            break;
          case 'neq':
            query = query.neq(column, value as never);
            break;
          default:
            query = query.eq(column, value as never);
        }
      }
    }

    const { data: result, error } = await query.select().single();

    if (error) {
      throw new Error(`Erro ao atualizar em ${table}: ${error.message}`);
    }

    return result as T;
  },

  delete: async (table: string, idOrFilters?: string | Filter[]): Promise<void> => {
    const client = getSupabaseClient();
    if (!client) throw new Error('Supabase não inicializado');
    await ensureSupabaseAuthSessionReady(client);

    let query = client.from(table).delete();

    // Suporte a duas sintaxes:
    // 1. delete(table, id) - deleta por ID
    // 2. delete(table, filters) - deleta com filtros
    let filters: Filter[] | undefined;
    
    if (typeof idOrFilters === 'string') {
      // Sintaxe: delete(table, id)
      filters = [{ column: 'id', operator: 'eq', value: idOrFilters }];
    } else {
      // Sintaxe: delete(table, filters)
      filters = idOrFilters;
    }

    // Aplicar filtros para delete
    if (filters && filters.length > 0) {
      for (const filter of filters) {
        const { column, operator, value } = filter;
        switch (operator) {
          case 'eq':
            query = query.eq(column, value as never);
            break;
          default:
            query = query.eq(column, value as never);
        }
      }
    }

    const { error } = await query;

    if (error) {
      throw new Error(`Erro ao deletar de ${table}: ${error.message}`);
    }
  },

  // Método auxiliar para buscar um único registro por ID
  findById: async <T extends DbRow = DbRow>(table: string, id: string, columns?: string): Promise<T | null> => {
    const client = getSupabaseClient();
    if (!client) throw new Error('Supabase não inicializado');
    await ensureSupabaseAuthSessionReady(client);

    const { data, error } = await client
      .from(table)
      .select(columns || '*')
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return null; // Não encontrado
      }
      throw new Error(`Erro ao buscar ${table} por ID: ${error.message}`);
    }

    return data as unknown as T;
  },

  // Método otimizado com colunas específicas, paginação e contagem
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
    const client = getSupabaseClient();
    if (!client) throw new Error('Supabase não inicializado');
    await ensureSupabaseAuthSessionReady(client);

    const { columns = '*', filters, orderBy, limit = 50, offset = 0, count = false } = options;

    let query = client.from(table).select(columns, count ? { count: 'exact' } : undefined);

    // Aplicar filtros
    if (filters && filters.length > 0) {
      for (const filter of filters) {
        const { column, operator, value } = filter;
        switch (operator) {
          case 'eq': query = query.eq(column, value as never); break;
          case 'neq': query = query.neq(column, value as never); break;
          case 'gt': query = query.gt(column, value as never); break;
          case 'gte': query = query.gte(column, value as never); break;
          case 'lt': query = query.lt(column, value as never); break;
          case 'lte': query = query.lte(column, value as never); break;
          case 'like': query = query.like(column, String(value)); break;
          case 'ilike': query = query.ilike(column, String(value)); break;
          case 'in': query = query.in(column, Array.isArray(value) ? value : [value]); break;
          case 'is': query = query.is(column, value as null | boolean); break;
          case 'contains': query = query.contains(column, value as string | readonly unknown[] | Record<string, unknown>); break;
          default: query = query.eq(column, value as never);
        }
      }
    }

    if (orderBy) {
      query = query.order(orderBy.column, { ascending: orderBy.ascending ?? true });
    }

    query = query.range(offset, offset + limit - 1);

    const { data, error, count: totalCount } = await query;

    if (error) {
      throw new Error(`Erro ao buscar dados de ${table}: ${error.message}`);
    }

    return { data: (data || []) as unknown as T[], count: totalCount };
  },

  // Contagem rápida sem carregar dados
  count: async (table: string, filters?: Filter[]): Promise<number> => {
    const client = getSupabaseClient();
    if (!client) throw new Error('Supabase não inicializado');
    await ensureSupabaseAuthSessionReady(client);

    let query = client.from(table).select('id', { count: 'exact', head: true });

    if (filters && filters.length > 0) {
      for (const filter of filters) {
        const { column, operator, value } = filter;
        switch (operator) {
          case 'eq': query = query.eq(column, value as never); break;
          case 'neq': query = query.neq(column, value as never); break;
          case 'in': query = query.in(column, Array.isArray(value) ? value : [value]); break;
          default: query = query.eq(column, value as never);
        }
      }
    }

    const { count, error } = await query;

    if (error) {
      throw new Error(`Erro ao contar ${table}: ${error.message}`);
    }

    return count || 0;
  },

  // Método para subscribe em tempo real (Realtime API)
  subscribe: (
    table: string,
    callback: (payload: DbRealtimePayload) => void,
    filter?: string
  ): (() => void) => {
    const client = getSupabaseClient();
    if (!client) {
      console.warn('[db.subscribe] Supabase não inicializado');
      return () => {};
    }

    // HARD LOCK egress: subscription sem filtro tenant dispara eventos de toda a tabela.
    if (!filter?.trim()) {
      if (import.meta.env?.PROD) {
        console.error('[db.subscribe] BLOQUEADO: filtro company_id/user_id obrigatório', { table });
        return () => {};
      }
      console.warn('[db.subscribe] DEV: subscription sem filtro — alto egress em produção', { table });
    }

    const channel = client
      .channel(`db-changes-${table}${filter ? `:${filter.slice(0, 48)}` : ''}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: table,
          filter: filter,
        },
        (payload: DbRealtimePayload) => {
          callback(payload);
        }
      )
      .subscribe();

    // Retornar função para cancelar subscription
    return () => {
      channel.unsubscribe();
    };
  },
};

export const storage = {
  from: (bucket: string) => {
    const client = getSupabaseClient();
    if (!client) throw new Error('Supabase não inicializado');
    return client.storage.from(bucket);
  },
  upload: (bucket: string, path: string, body: Blob | File | ArrayBuffer | FormData, options?: Record<string, unknown>) => {
    const client = getSupabaseClient();
    if (!client) throw new Error('Supabase não inicializado');
    return client.storage.from(bucket).upload(
      path,
      body,
      options as Record<string, unknown> | undefined,
    );
  },
  getPublicUrl: (bucket: string, path: string) => {
    const client = getSupabaseClient();
    if (!client) throw new Error('Supabase não inicializado');
    return client.storage.from(bucket).getPublicUrl(path).data.publicUrl;
  },
};

export const auth = {
  signUp: async (email: string, password: string, options?: Record<string, unknown>) => {
    const client = getSupabaseClient();
    if (!client) throw new Error('Supabase não inicializado');
    const { data, error } = await client.auth.signUp({ email, password, options });
    if (error) throw error;
    return data;
  },
  /** Alias de signInWithPassword para compatibilidade com authService */
  signIn: async (email: string, password: string) => {
    const client = getSupabaseClient();
    if (!client) throw new Error('Supabase não inicializado');
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
  },
  signInWithPassword: async (email: string, password: string) => {
    const client = getSupabaseClient();
    if (!client) throw new Error('Supabase não inicializado');
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
  },
  signInWithOAuth: async (provider: string, options?: Record<string, unknown>) => {
    const client = getSupabaseClient();
    if (!client) throw new Error('Supabase não inicializado');
    const { data, error } = await client.auth.signInWithOAuth({
      provider: provider as never,
      ...(options ?? {}),
    });
    if (error) throw error;
    return data;
  },
  signOut: async (options?: { scope?: 'global' | 'local' | 'others' }) => {
    const client = getSupabaseClient();
    if (!client) throw new Error('Supabase não inicializado');
    resetSessionAuthWarmup();
    return client.auth.signOut(options);
  },
  getSession: async () => {
    const client = getSupabaseClient();
    if (!client) throw new Error('Supabase não inicializado');
    return client.auth.getSession();
  },
  getUser: async () => {
    const client = getSupabaseClient();
    if (!client) throw new Error('Supabase não inicializado');
    return client.auth.getUser();
  },
  updatePassword: async (newPassword: string) => {
    const client = getSupabaseClient();
    if (!client) throw new Error('Supabase não inicializado');
    const { error } = await client.auth.updateUser({ password: newPassword });
    if (error) throw error;
  },
  resetPassword: async (email: string, redirectTo?: string) => {
    const client = getSupabaseClient();
    if (!client) throw new Error('Supabase não inicializado');
    const { error } = await client.auth.resetPasswordForEmail(email, redirectTo ? { redirectTo } : undefined);
    if (error) throw error;
  },
  onAuthStateChange: (callback: AuthOnChangeCallback) => {
    const client = getSupabaseClient();
    if (!client) throw new Error('Supabase não inicializado');
    return client.auth.onAuthStateChange(callback);
  },
};
