import { observabilityConsole } from '../shared/logger/observabilityConsole';
/**
 * Reputação operacional por dispositivo (device_operational_reputation).
 * Histórico append-only: device_operational_reputation_history (trigger SQL).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { isLocalApiDataProvider } from '../config/system';
import { getSupabaseClient } from './supabaseClient';
import { operationalNowUtcIso } from '../utils/operationalDateHardLock';
import { getOperationalMonitoringIdentity } from '../performance/operationalMonitoringContext';

const LS_DEVICE_KEY = 'smartponto_device_ops_key';

export function getOperationalDeviceKey(): string {
  try {
    if (typeof localStorage === 'undefined') return 'ephemeral';
    let k = localStorage.getItem(LS_DEVICE_KEY);
    if (!k && typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
      k = crypto.randomUUID();
      localStorage.setItem(LS_DEVICE_KEY, k);
    }
    return k ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

type Signals = Record<string, number | string | boolean>;

function clampScore(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(100, Math.max(0, n));
}

function mergeSignals(prev: Signals, patch: Signals): Signals {
  const out: Signals = { ...prev };
  for (const [key, val] of Object.entries(patch)) {
    if (typeof val === 'number') {
      const p = prev[key];
      out[key] = (typeof p === 'number' ? p : 0) + val;
    } else {
      out[key] = val;
    }
  }
  return out;
}

const EVENT_IMPACT: Record<string, { delta: number; signal?: string }> = {
  geo_drift_detected: { delta: -1, signal: 'geo_drift_count' },
  mobile_clock_drift_detected: { delta: -2, signal: 'mobile_clock_drift_count' },
  heartbeat_lost: { delta: -2, signal: 'heartbeat_lost_count' },
  realtime_backpressure: { delta: -1, signal: 'realtime_backpressure_count' },
  offline_geo_replay_excess: { delta: -2, signal: 'offline_replay_storm_count' },
  stale_geo_blocked: { delta: -1, signal: 'stale_geo_blocked_count' },
  impossible_movement_blocked: { delta: -2, signal: 'impossible_movement_count' },
  query_invalidation_storm: { delta: -1, signal: 'query_storm_count' },
  reconnect_loop: { delta: -1, signal: 'reconnect_loop_count' },
  mock_surge_blocked: { delta: -2, signal: 'mock_surge_count' },
};

const throttleUntil = new Map<string, number>();
const THROTTLE_MS = 2_800;

function throttleKey(companyId: string, employeeId: string, code: string): string {
  return `${companyId}:${employeeId}:${code}`;
}

/**
 * Evento semântico → delta + contador em `signals` (merge numérico).
 */
export async function reportDeviceOperationalReputationEvent(
  input: {
    companyId: string;
    employeeId: string;
    event: keyof typeof EVENT_IMPACT | string;
    extraSignals?: Signals;
  },
  clientOverride?: SupabaseClient | null,
): Promise<{ ok: boolean; error?: string; throttled?: boolean }> {
  const spec = EVENT_IMPACT[input.event];
  if (!spec) {
    return recordDeviceOperationalReputationSignal(
      { companyId: input.companyId, employeeId: input.employeeId, deltaScore: -1, signalPatch: { unknown_event: 1 } },
      clientOverride,
    );
  }
  const tk = throttleKey(input.companyId, input.employeeId, input.event);
  const now = Date.now();
  if ((throttleUntil.get(tk) ?? 0) > now) {
    return { ok: true, throttled: true };
  }
  throttleUntil.set(tk, now + THROTTLE_MS);

  const patch: Signals = { ...(input.extraSignals ?? {}) };
  if (spec.signal) patch[spec.signal] = 1;

  return recordDeviceOperationalReputationSignal(
    {
      companyId: input.companyId,
      employeeId: input.employeeId,
      deltaScore: spec.delta,
      signalPatch: patch,
    },
    clientOverride,
  );
}

export function reportDeviceOperationalReputationFromMonitoringContext(
  event: keyof typeof EVENT_IMPACT | string,
): void {
  const id = getOperationalMonitoringIdentity();
  if (!id) return;
  void reportDeviceOperationalReputationEvent({
    companyId: id.companyId,
    employeeId: id.employeeId,
    event,
  });
}

/**
 * Incrementa sinais negativos e reduz score (merge JSONB no cliente).
 */
export async function recordDeviceOperationalReputationSignal(
  input: {
    companyId: string;
    employeeId: string;
    deltaScore?: number;
    signalPatch?: Signals;
  },
  clientOverride?: SupabaseClient | null,
): Promise<{ ok: boolean; error?: string }> {
  if (isLocalApiDataProvider() && !clientOverride) return { ok: true };
  let client: SupabaseClient | null = clientOverride ?? null;
  if (!client) {
    try {
      client = getSupabaseClient() as SupabaseClient;
    } catch {
      return { ok: false, error: 'no_client' };
    }
  }
  if (!client) return { ok: false, error: 'no_client' };
  const deviceKey = getOperationalDeviceKey();

  const { data: existing, error: readErr } = await client
    .from('device_operational_reputation')
    .select('score, signals')
    .eq('device_key', deviceKey)
    .eq('company_id', input.companyId)
    .eq('employee_id', input.employeeId)
    .maybeSingle();

  if (readErr) return { ok: false, error: readErr.message };

  const prevSignals = (existing?.signals ?? {}) as Signals;
  const nextSignals = mergeSignals(prevSignals, input.signalPatch ?? {});
  const prevScore = typeof existing?.score === 'number' ? Number(existing.score) : 100;
  const nextScore = clampScore(prevScore + (input.deltaScore ?? 0));

  const { error } = await client.from('device_operational_reputation').upsert(
    {
      device_key: deviceKey,
      company_id: input.companyId,
      employee_id: input.employeeId,
      score: nextScore,
      signals: nextSignals,
      updated_at: operationalNowUtcIso(),
    },
    { onConflict: 'device_key,company_id,employee_id' },
  );

  if (error) return { ok: false, error: error.message };
  if (nextScore < prevScore && nextScore < 70) {
    observabilityConsole.warn('[DEVICE REPUTATION DEGRADED]', {
      device_key: deviceKey,
      company_id: input.companyId,
      employee_id: input.employeeId,
      score: nextScore,
    });
  }
  return { ok: true };
}
