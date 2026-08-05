/**
 * Escolhe bridge HTTPS (browser) ou HTTP direto (servidor/agente) para falar com o relógio.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { RepDevice, PunchFromDevice } from './types';

export async function getPunchesForSync(
  supabase: SupabaseClient,
  device: RepDevice,
  since?: Date
): Promise<PunchFromDevice[]> {
  /** Ramo servidor primeiro: o bundler do cliente elimina este bloco (window existe no browser). */
  if (typeof window === 'undefined') {
    const { getPunchesFromDeviceServer } = await import('./repDeviceServer');
    return getPunchesFromDeviceServer(device, since);
  }
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) {
    throw new Error('Sessão expirada. Faça login novamente.');
  }
  const { fetchPunchesViaApi } = await import('./repDeviceBrowser');
  return fetchPunchesViaApi(device.id, since, session.access_token);
}

export async function testConnectionForSync(
  supabase: SupabaseClient,
  device: RepDevice
): Promise<{ ok: boolean; message: string }> {
  if (typeof window === 'undefined') {
    const { testConnectionServer } = await import('./repDeviceServer');
    return testConnectionServer(device);
  }
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) {
    return { ok: false, message: 'Sessão expirada. Faça login novamente.' };
  }
  const { testConnectionViaApi } = await import('./repDeviceBrowser');
  return testConnectionViaApi(device.id, session.access_token);
}
