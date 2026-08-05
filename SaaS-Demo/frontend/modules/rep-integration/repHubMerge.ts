import type { SupabaseClient } from '@supabase/supabase-js';
import type { RepDevice } from './types';

const HUB_TYPES = new Set(['control_id', 'dimep', 'topdata', 'henry']);

/**
 * Se `rep_devices.provider_type` estiver vazio, preenche com `timeclock_devices.type`
 * do espelho hub (`rep_device_id`), quando existir.
 */
export async function mergeHubProviderIntoRepDevice(
  client: SupabaseClient,
  device: RepDevice
): Promise<RepDevice> {
  if (String(device.provider_type || '').trim()) return device;
  const { data, error } = await client
    .from('timeclock_devices')
    .select('type')
    .eq('rep_device_id', device.id)
    .maybeSingle();
  if (error || !data || typeof (data as { type?: unknown }).type !== 'string') return device;
  const t = String((data as { type: string }).type)
    .trim()
    .toLowerCase();
  if (!HUB_TYPES.has(t)) return device;
  return { ...device, provider_type: t };
}
