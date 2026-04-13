/**
 * Re-export de supabase para compatibilidade com código existente
 * Todos os imports devem vir daqui
 */

export { 
  supabase, 
  isSupabaseConfigured, 
  getUserProfileStorage, 
  clearCurrentUserFromAllStorages, 
  useSessionStorageForAuth,
  DB_SELECT_TIMEOUT_MS,
  DEFAULT_CONNECTION_TIMEOUT_MS,
  clearLocalAuthSession
} from './supabase';
export { getSupabaseClient, getSupabaseClientOrThrow, testSupabaseConnection, withSupabaseTimeout, resetSession } from '../src/lib/supabaseClient';

// Criar aliases para db e storage (compatibilidade com código antigo)
import { getSupabaseClient } from '../src/lib/supabaseClient';

// Tipos para filtros
type FilterOperator = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'like' | 'ilike' | 'in' | 'is' | 'contains';

interface Filter {
  column: string;
  operator: FilterOperator;
  value: any;
}

interface OrderBy {
  column: string;
  ascending?: boolean;
}

// Implementação completa do db com suporte a filtros, ordenação e limite
export const db = {
  select: async (
    table: string,
    filters?: Filter[],
    orderBy?: OrderBy,
    limit?: number
  ): Promise<any[]> => {
    const client = getSupabaseClient();
    if (!client) throw new Error('Supabase não inicializado');

    let query = client.from(table).select('*');

    // Aplicar filtros
    if (filters && filters.length > 0) {
      for (const filter of filters) {
        const { column, operator, value } = filter;
        switch (operator) {
          case 'eq':
            query = query.eq(column, value);
            break;
          case 'neq':
            query = query.neq(column, value);
            break;
          case 'gt':
            query = query.gt(column, value);
            break;
          case 'gte':
            query = query.gte(column, value);
            break;
          case 'lt':
            query = query.lt(column, value);
            break;
          case 'lte':
            query = query.lte(column, value);
            break;
          case 'like':
            query = query.like(column, value);
            break;
          case 'ilike':
            query = query.ilike(column, value);
            break;
          case 'in':
            query = query.in(column, Array.isArray(value) ? value : [value]);
            break;
          case 'is':
            query = query.is(column, value);
            break;
          case 'contains':
            query = query.contains(column, value);
            break;
          default:
            query = query.eq(column, value);
        }
      }
    }

    // Aplicar ordenação
    if (orderBy) {
      query = query.order(orderBy.column, { ascending: orderBy.ascending ?? true });
    }

    // Aplicar limite
    if (limit && limit > 0) {
      query = query.limit(limit);
    }

    const { data, error } = await query;

    if (error) {
      throw new Error(`Erro ao buscar dados de ${table}: ${error.message}`);
    }

    return data || [];
  },

  insert: async (table: string, data: any): Promise<any> => {
    const client = getSupabaseClient();
    if (!client) throw new Error('Supabase não inicializado');

    const { data: result, error } = await client.from(table).insert(data).select().single();

    if (error) {
      throw new Error(`Erro ao inserir em ${table}: ${error.message}`);
    }

    return result;
  },

  update: async (table: string, data: any, filters?: Filter[]): Promise<any> => {
    const client = getSupabaseClient();
    if (!client) throw new Error('Supabase não inicializado');

    let query = client.from(table).update(data);

    // Aplicar filtros para update
    if (filters && filters.length > 0) {
      for (const filter of filters) {
        const { column, operator, value } = filter;
        switch (operator) {
          case 'eq':
            query = query.eq(column, value);
            break;
          case 'neq':
            query = query.neq(column, value);
            break;
          default:
            query = query.eq(column, value);
        }
      }
    }

    const { data: result, error } = await query.select().single();

    if (error) {
      throw new Error(`Erro ao atualizar em ${table}: ${error.message}`);
    }

    return result;
  },

  delete: async (table: string, filters?: Filter[]): Promise<void> => {
    const client = getSupabaseClient();
    if (!client) throw new Error('Supabase não inicializado');

    let query = client.from(table).delete();

    // Aplicar filtros para delete
    if (filters && filters.length > 0) {
      for (const filter of filters) {
        const { column, operator, value } = filter;
        switch (operator) {
          case 'eq':
            query = query.eq(column, value);
            break;
          default:
            query = query.eq(column, value);
        }
      }
    }

    const { error } = await query;

    if (error) {
      throw new Error(`Erro ao deletar de ${table}: ${error.message}`);
    }
  },

  // Método auxiliar para buscar um único registro por ID
  findById: async (table: string, id: string): Promise<any | null> => {
    const client = getSupabaseClient();
    if (!client) throw new Error('Supabase não inicializado');

    const { data, error } = await client
      .from(table)
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return null; // Não encontrado
      }
      throw new Error(`Erro ao buscar ${table} por ID: ${error.message}`);
    }

    return data;
  },

  // Método para subscribe em tempo real (Realtime API)
  subscribe: (
    table: string,
    callback: (payload: any) => void,
    filter?: string
  ): (() => void) => {
    const client = getSupabaseClient();
    if (!client) {
      console.warn('[db.subscribe] Supabase não inicializado');
      return () => {};
    }

    const channel = client
      .channel(`db-changes-${table}`)
      .on(
        'postgres_changes' as any,
        {
          event: '*',
          schema: 'public',
          table: table,
          filter: filter,
        },
        (payload: any) => {
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
};

export const auth = {
  signUp: async (email: string, password: string, options?: any) => {
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
  signInWithOAuth: async (provider: string, options?: any) => {
    const client = getSupabaseClient();
    if (!client) throw new Error('Supabase não inicializado');
    const { data, error } = await client.auth.signInWithOAuth({ provider: provider as any, ...options });
    if (error) throw error;
    return data;
  },
  signOut: async (options?: { scope?: 'global' | 'local' | 'others' }) => {
    const client = getSupabaseClient();
    if (!client) throw new Error('Supabase não inicializado');
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
  onAuthStateChange: (callback: any) => {
    const client = getSupabaseClient();
    if (!client) throw new Error('Supabase não inicializado');
    return client.auth.onAuthStateChange(callback);
  },
};
