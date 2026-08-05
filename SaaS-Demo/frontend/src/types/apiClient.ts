/** Tipo de compatibilidade — substitui `SupabaseClient` nos módulos operacionais legados. */
export type ApiDbClient = {
  from: (table: string) => unknown;
  auth: unknown;
  rpc: (fn: string, args?: Record<string, unknown>) => Promise<unknown>;
};

/** @deprecated Use ApiDbClient */
export type SupabaseClient = ApiDbClient;
