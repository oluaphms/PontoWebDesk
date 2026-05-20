/**
 * Autenticação do agente REP (Bearer): token global ou api_key do dispositivo.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { secureCompare } from './security.js';

export function getRepBridgeToken(): string {
  return (process.env.REP_BRIDGE_TOKEN || process.env.REP_AGENT_TOKEN || process.env.API_KEY || '').trim();
}

/** Aceita REP_BRIDGE_TOKEN/API_KEY global ou api_key da linha em rep_devices. */
export async function verifyRepAgentToken(
  supabase: SupabaseClient,
  token: string,
  deviceId?: string | null,
): Promise<boolean> {
  const trimmed = token.trim();
  if (!trimmed) return false;

  const bridge = getRepBridgeToken();
  if (bridge && secureCompare(trimmed, bridge)) return true;

  const id = String(deviceId || '').trim();
  if (!id) return false;

  const { data, error } = await supabase
    .from('rep_devices')
    .select('api_key')
    .eq('id', id)
    .maybeSingle();

  if (error || !data?.api_key) return false;
  const deviceKey = String(data.api_key).trim();
  return Boolean(deviceKey && secureCompare(trimmed, deviceKey));
}
