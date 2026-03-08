/**
 * Cliente centralizado Supabase (path canônico: src/lib/supabaseClient).
 * Re-exporta do serviço raiz que já inclui:
 * - fetch com timeout 15s (evita requisições travadas)
 * - auth com persistSession e autoRefreshToken
 */

export {
  supabase,
  db,
  auth,
  storage,
  isSupabaseConfigured,
  testSupabaseConnection,
  withSupabaseTimeout,
  resetSession,
} from '../../services/supabase';

export type { SupabaseClient } from '@supabase/supabase-js';
export { createClient } from '@supabase/supabase-js';
