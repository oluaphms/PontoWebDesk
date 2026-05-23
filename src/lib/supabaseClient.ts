/** @deprecated Supabase removido — use src/services/apiClient.ts */
export function getSupabaseClient(): never {
  throw new Error('Supabase removido. Use apiClient ou db de src/services/dbHttp.ts');
}

export const getSupabase = getSupabaseClient;

export function getSupabaseClientOrThrow(): never {
  throw new Error('Supabase removido. Use apiClient ou db de src/services/dbHttp.ts');
}

export function setSupabaseServiceRoleOverride(_client: unknown): void {}

export function resetSupabaseClient(): void {}
