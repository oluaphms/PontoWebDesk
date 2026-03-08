import { SupabaseClient, createClient } from '@supabase/supabase-js';

/**
 * Cliente centralizado do Supabase para o novo namespace `src/`.
 *
 * Preferencialmente, use os helpers exportados de `services/supabase`,
 * mas este arquivo existe para atender ao padrão:
 * `src/services/supabaseClient.ts`.
 *
 * - `supabase`: client bruto do Supabase (quando configurado)
 * - `db`: helpers de acesso a tabelas (select/insert/update/delete/subscribe)
 * - `auth`: helpers de autenticação
 * - `storage`: helpers de storage
 * - `isSupabaseConfigured`: flag booleana de configuração
 */

import supabaseDefault, {
  db,
  auth,
  storage,
  isSupabaseConfigured,
} from '../../services/supabase';

// Exporta o client principal já existente para manter uma única fonte de verdade
export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? (supabaseDefault as SupabaseClient)
  : null;

export { db, auth, storage, isSupabaseConfigured, SupabaseClient, createClient };

// Re-export para uso de timeout em queries críticas e reset de sessão
export {
  testSupabaseConnection,
  withSupabaseTimeout,
  resetSession,
} from '../../services/supabase';

