/**
 * Heartbeat operacional leve (tabela live_employee_heartbeat).
 * Complementa live_employee_location; não substitui batida jurídica.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseClient } from './supabaseClient';
import { operationalNowUtcIso } from '../utils/operationalDateHardLock';

export type OperationalHeartbeatInput = {
  companyId: string;
  employeeId: string;
  appState?: string | null;
  networkState?: string | null;
  batteryState?: string | null;
  gpsHealth?: string | null;
};

export async function upsertOperationalHeartbeat(
  input: OperationalHeartbeatInput,
  clientOverride?: SupabaseClient | null,
): Promise<{ ok: boolean; error?: string }> {
  const client = clientOverride ?? getSupabaseClient();
  if (!client) return { ok: false, error: 'no_client' };

  const ts = operationalNowUtcIso();
  const { error } = await client.from('live_employee_heartbeat').upsert(
    {
      company_id: input.companyId,
      employee_id: input.employeeId,
      captured_at: ts,
      app_state: input.appState ?? null,
      network_state: input.networkState ?? null,
      battery_state: input.batteryState ?? null,
      gps_health: input.gpsHealth ?? null,
      updated_at: ts,
    },
    { onConflict: 'company_id,employee_id' },
  );

  if (error) return { ok: false, error: error.message };
  console.info('[OPERATIONAL HEARTBEAT]', {
    company_id: input.companyId,
    employee_id: input.employeeId,
    app_state: input.appState,
    network_state: input.networkState,
    gps_health: input.gpsHealth,
  });
  return { ok: true };
}

/** Rótulo de rede para telemetria (sem PII). */
export function resolveNetworkStateLabel(): string {
  if (typeof navigator === 'undefined') return 'unknown';
  if (!navigator.onLine) return 'offline';
  const c = (navigator as Navigator & { connection?: { effectiveType?: string } }).connection;
  const et = c?.effectiveType;
  if (et) return `online:${et}`;
  return 'online';
}

/** Nível de bateria agregado (quando a API existir). */
export async function resolveBatteryStateLabel(): Promise<string | null> {
  const nav = typeof navigator !== 'undefined' ? navigator : null;
  const bat = nav && 'getBattery' in nav && typeof (nav as Navigator).getBattery === 'function' ? await (nav as Navigator).getBattery!() : null;
  if (!bat) return null;
  const level = Math.round(bat.level * 100);
  return `${level}%${bat.charging ? ',charging' : ''}`;
}
