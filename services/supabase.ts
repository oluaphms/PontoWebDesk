/**
 * Supabase Configuration and Initialization
 *
 * Só inicializa o client quando VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY
 * estão definidos (.env.local localmente ou variáveis na Vercel).
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
const configured = !!(supabaseUrl && supabaseAnonKey);

export const isSupabaseConfigured = configured;

const notConfiguredMsg =
  'Supabase não configurado. Configure VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY no .env.local (local) ou nas variáveis de ambiente da Vercel (Settings → Environment Variables). Veja CONFIGURAR_SUPABASE.md.';

function notConfigured(): never {
  if (typeof console !== 'undefined') {
    console.error('❌', notConfiguredMsg);
  }
  throw new Error(notConfiguredMsg);
}

let client: SupabaseClient | null = null;
if (configured) {
  client = createClient(supabaseUrl!, supabaseAnonKey!, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
}

export const supabase = client;

// Stub auth when not configured: getCurrentUser → null, onAuthStateChange → no-op
const stubAuth = {
  signIn: async () => notConfigured(),
  signUp: async () => notConfigured(),
  signOut: async () => notConfigured(),
  getUser: async () => null as any,
  getSession: async () => null as any,
  onAuthStateChange: (_cb: (event: string, session: any) => void) => () => {},
  resetPassword: async () => notConfigured(),
  updatePassword: async () => notConfigured(),
  signInWithOAuth: async () => notConfigured(),
};

const realAuth = configured
  ? {
      signIn: async (email: string, password: string) => {
        const { data, error } = await client!.auth.signInWithPassword({ email, password });
        if (error) throw error;
        return data;
      },
      signUp: async (email: string, password: string, metadata?: any) => {
        const { data, error } = await client!.auth.signUp({
          email,
          password,
          options: { data: metadata },
        });
        if (error) throw error;
        return data;
      },
      signOut: async () => {
        const { error } = await client!.auth.signOut();
        if (error) throw error;
      },
      getUser: async () => {
        const { data: { user }, error } = await client!.auth.getUser();
        if (error) throw error;
        return user;
      },
      getSession: async () => {
        const { data: { session }, error } = await client!.auth.getSession();
        if (error) throw error;
        return session;
      },
      onAuthStateChange: (callback: (event: string, session: any) => void) => {
        const { data } = client!.auth.onAuthStateChange(callback);
        const unsub = (data as { subscription?: { unsubscribe?: () => void }; unsubscribe?: () => void })?.subscription?.unsubscribe
          ?? (data as { unsubscribe?: () => void })?.unsubscribe;
        return typeof unsub === 'function' ? () => unsub() : () => {};
      },
      resetPassword: async (email: string) => {
        const { error } = await client!.auth.resetPasswordForEmail(email, {
          redirectTo: `${typeof window !== 'undefined' ? window.location.origin : ''}/reset-password`,
        });
        if (error) throw error;
      },
      updatePassword: async (newPassword: string) => {
        const { error } = await client!.auth.updateUser({ password: newPassword });
        if (error) throw error;
      },
      signInWithOAuth: async (provider: 'google' | 'github' | 'azure' = 'google') => {
        const { data, error } = await client!.auth.signInWithOAuth({
          provider,
          options: {
            redirectTo: `${typeof window !== 'undefined' ? window.location.origin : ''}/auth/callback`,
          },
        });
        if (error) throw error;
        return data;
      },
    }
  : stubAuth;

export const auth = realAuth;

// DB helpers – throw when not configured
const stubDb = {
  from: (_: string) => notConfigured(),
  insert: async () => notConfigured(),
  update: async () => notConfigured(),
  delete: async () => notConfigured(),
  select: async () => notConfigured(),
  subscribe: () => notConfigured(),
};

const realDb = configured
  ? {
      from: (table: string) => client!.from(table),
      insert: async (table: string, data: any) => {
        const { data: result, error } = await client!.from(table).insert(data).select();
        if (error) throw error;
        return result;
      },
      update: async (table: string, id: string, data: any) => {
        const { data: result, error } = await client!
          .from(table)
          .update({ ...data, updated_at: new Date().toISOString() })
          .eq('id', id)
          .select();
        if (error) throw error;
        return result?.[0];
      },
      delete: async (table: string, id: string) => {
        const { error } = await client!.from(table).delete().eq('id', id);
        if (error) throw error;
      },
      select: async (
        table: string,
        filters?: { column: string; operator: string; value: any }[],
        orderBy?: { column: string; ascending?: boolean },
        limit?: number
      ) => {
        let query = client!.from(table).select('*');
        if (filters) {
          filters.forEach((f) => {
            query = (query as any)[f.operator](f.column, f.value);
          });
        }
        if (orderBy) query = (query as any).order(orderBy.column, { ascending: orderBy.ascending ?? true });
        if (limit != null) query = (query as any).limit(limit);
        const { data, error } = await query;
        if (error) throw error;
        return data;
      },
      subscribe: (table: string, callback: (payload: any) => void, filters?: string) => {
        const ch = client!
          .channel(`${table}_changes`)
          .on('postgres_changes', { event: '*', schema: 'public', table, filter: filters }, callback)
          .subscribe();
        return () => client!.removeChannel(ch);
      },
    }
  : stubDb;

export const db = realDb;

// Storage – throw when not configured
const stubStorage = {
  upload: async () => notConfigured(),
  getPublicUrl: () => notConfigured(),
  download: async () => notConfigured(),
  delete: async () => notConfigured(),
  list: async () => notConfigured(),
};

const realStorage = configured
  ? {
      upload: async (bucket: string, path: string, file: File) => {
        const { data, error } = await client!.storage.from(bucket).upload(path, file, {
          cacheControl: '3600',
          upsert: false,
        });
        if (error) throw error;
        return data;
      },
      getPublicUrl: (bucket: string, path: string) =>
        client!.storage.from(bucket).getPublicUrl(path).data.publicUrl,
      download: async (bucket: string, path: string) => {
        const { data, error } = await client!.storage.from(bucket).download(path);
        if (error) throw error;
        return data;
      },
      delete: async (bucket: string, paths: string[]) => {
        const { error } = await client!.storage.from(bucket).remove(paths);
        if (error) throw error;
      },
      list: async (bucket: string, path?: string) => {
        const { data, error } = await client!.storage.from(bucket).list(path);
        if (error) throw error;
        return data;
      },
    }
  : stubStorage;

export const storage = realStorage;

export default supabase;
