import { isSupabaseConfigured } from '../../services/supabaseClient';
import { isCloudEnabled } from './cloudService';
import { isDegradedMode } from './systemMode';

export type SupabaseConnectionStatus =
  | 'ok'
  | 'dns'
  | 'network'
  | 'timeout'
  | 'offline'
  | 'not_configured'
  | 'egress_quota'
  | 'unknown'
  | 'circuit_breaker'
  | 'local_mode';

export type SupabaseConnectionCheckResult = {
  ok: boolean;
  status: SupabaseConnectionStatus;
  message: string;
};

/**
 * Diagnóstico não bloqueante — nunca impede login nem UI.
 * Com cloud desligado ou modo degradado, retorna imediatamente sem chamar REST.
 */
export async function checkSupabaseConnection(): Promise<SupabaseConnectionCheckResult> {
  if (!isCloudEnabled() || isDegradedMode()) {
    return { ok: true, status: 'local_mode', message: 'Modo local ativo.' };
  }
  if (!isSupabaseConfigured()) {
    return { ok: true, status: 'local_mode', message: 'Cloud desligado.' };
  }
  return { ok: true, status: 'ok', message: 'Cloud habilitado.' };
}
