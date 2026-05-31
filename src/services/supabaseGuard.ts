import { observabilityConsole } from '../shared/logger/observabilityConsole';
export function assertNoSupabaseUsage(): void {
  if (!import.meta.env.DEV) return;
  observabilityConsole.warn('[SUPABASE GUARD] Uso direto detectado — deve ser removido.');
}

