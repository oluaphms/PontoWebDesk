export function assertNoSupabaseUsage(): void {
  if (!import.meta.env.DEV) return;
  console.warn('[SUPABASE GUARD] Uso direto detectado — deve ser removido.');
}

