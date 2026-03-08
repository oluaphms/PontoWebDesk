import { supabase, isSupabaseConfigured } from './supabaseClient';

/**
 * Verifica se a conexão com o Supabase está ativa (leitura de tabela employees).
 * Executar ao iniciar o app para detectar projeto pausado ou rede indisponível.
 */
export async function checkSupabaseConnection(): Promise<boolean> {
  if (!isSupabaseConfigured || !supabase) {
    console.error('[SmartPonto] Supabase connection check skipped: not configured');
    return false;
  }

  try {
    const { error } = await supabase.from('employees').select('id').limit(1);

    if (error) throw error;

    return true;
  } catch (error) {
    console.error('[SmartPonto] Supabase connection failed', error);
    return false;
  }
}
