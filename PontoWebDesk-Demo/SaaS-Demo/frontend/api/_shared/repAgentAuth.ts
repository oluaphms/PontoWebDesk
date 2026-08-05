/**
 * Autenticação do agente REP (Bearer): device_key (hash), api_key por dispositivo ou bridge legado.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { secureCompare } from './security.js';

export function getRepBridgeToken(): string {
  return (process.env.REP_BRIDGE_TOKEN || process.env.REP_AGENT_TOKEN || process.env.API_KEY || '').trim();
}

async function validateDeviceKeyHash(
  supabase: SupabaseClient,
  deviceId: string,
  token: string,
): Promise<boolean> {
  const id = String(deviceId || '').trim();
  if (!id || !token.trim()) return false;
  try {
    const { data, error } = await supabase.rpc('validate_device_key', {
      p_device_id: id,
      p_api_key: token,
    });
    if (error || !Array.isArray(data) || data.length === 0) return false;
    const row = data[0] as { valid?: boolean };
    return row?.valid === true;
  } catch {
    return false;
  }
}

/** Aceita device_key (hash), api_key da linha em rep_devices ou bridge global (legado). */
export async function verifyRepAgentToken(
  supabase: SupabaseClient,
  token: string,
  deviceId?: string | null,
): Promise<boolean> {
  const trimmed = token.trim();
  if (!trimmed) return false;

  const id = String(deviceId || '').trim();
  if (id) {
    if (await validateDeviceKeyHash(supabase, id, trimmed)) return true;

    const { data, error } = await supabase
      .from('rep_devices')
      .select('api_key')
      .eq('id', id)
      .maybeSingle();

    if (!error && data?.api_key) {
      const deviceKey = String(data.api_key).trim();
      if (deviceKey && secureCompare(trimmed, deviceKey)) return true;
    }
  }

  const bridge = getRepBridgeToken();
  if (bridge && secureCompare(trimmed, bridge)) return true;

  return false;
}
