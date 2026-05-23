/**
 * Shim de tipos — substitui @supabase/supabase-js no frontend (sem dependência npm).
 */
export type PostgrestError = { message: string; code?: string; status?: number };

export type SupabaseClient = {
  from: (table: string) => unknown;
  rpc: (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: PostgrestError | null }>;
  auth: {
    getSession: () => Promise<{ data: { session: unknown }; error: unknown }>;
    getUser: () => Promise<{ data: { user: unknown }; error: unknown }>;
    signOut: (opts?: unknown) => Promise<{ error: unknown }>;
    refreshSession: () => Promise<{ data: { session: unknown }; error: unknown }>;
    updateUser: (attrs: unknown) => Promise<{ error: unknown }>;
    onAuthStateChange: (cb: unknown) => { data: { subscription: { unsubscribe: () => void } } };
  };
  storage: { from: (bucket: string) => unknown };
  channel: (name: string) => unknown;
};
