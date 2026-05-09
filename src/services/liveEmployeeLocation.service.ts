/**
 * Posição efêmera (live_employee_location): mapa/presença realtime — não batida jurídica.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { DateTime } from 'luxon';
import { getSupabaseClient } from './supabaseClient';
import { detectImpossibleRealtimeMovement, type GeoConfidenceLevel } from './geolocation/geoConfidence.service';
import { evaluateRealtimeGpsReliability } from './geolocation/realtimeGeoReliability.service';
import { recordOperationalMetric } from '../domain/operational/metrics/operationalMetrics';
import { normalizeOperationalDate, operationalNowUtcIso } from '../utils/operationalDateHardLock';
import { operationalClockMs } from '../utils/operationalClock';
import { reportDeviceOperationalReputationEvent } from './deviceOperationalReputation.service';
import { reportGeoCircuitSignal } from '../domain/operational/geo/geoOperationalCircuitBreaker';

export const LIVE_LOCATION_TTL_MS = 45_000;

export type LiveEmployeeLocationRow = {
  company_id: string;
  employee_id: string;
  latitude: number;
  longitude: number;
  accuracy: number | null;
  captured_at: string;
  provider: string | null;
  confidence: string | null;
  speed: number | null;
  heading: number | null;
  is_stale: boolean;
  expires_at: string;
  updated_at: string;
  geo_snapshot_checksum?: string | null;
};

export type UpsertLiveLocationInput = {
  companyId: string;
  employeeId: string;
  latitude: number;
  longitude: number;
  accuracy?: number | null;
  capturedAtMs?: number;
  provider?: string | null;
  speedMps?: number | null;
  headingDeg?: number | null;
  correlationId?: string | null;
};

function expiresAtIso(ttlMs: number): string {
  return DateTime.fromMillis(operationalClockMs() + ttlMs, { zone: 'utc' }).toUTC().toISO() ?? '';
}

export async function fetchLiveLocationsForCompany(
  companyId: string,
  clientOverride?: SupabaseClient | null,
): Promise<LiveEmployeeLocationRow[]> {
  const client = clientOverride ?? getSupabaseClient();
  if (!client || !companyId) return [];
  const { data, error } = await client
    .from('live_employee_location')
    .select(
      'company_id, employee_id, latitude, longitude, accuracy, captured_at, provider, confidence, speed, heading, is_stale, expires_at, updated_at, geo_snapshot_checksum',
    )
    .eq('company_id', companyId);
  if (error) {
    console.warn('[live_employee_location] fetch', error.message);
    return [];
  }
  return (data ?? []) as LiveEmployeeLocationRow[];
}

/** Upsert com TTL, confiança e bloqueio de movimento impossível vs última posição aceita. */
export async function upsertLiveEmployeeLocation(
  input: UpsertLiveLocationInput,
  clientOverride?: SupabaseClient | null,
): Promise<{ ok: boolean; confidence?: GeoConfidenceLevel; error?: string; skipped?: boolean }> {
  const client = clientOverride ?? getSupabaseClient();
  if (!client) return { ok: false, error: 'no_client' };
  const nowMs = input.capturedAtMs ?? operationalClockMs();
  const capIso = DateTime.fromMillis(nowMs, { zone: 'utc' }).toUTC().toISO() ?? '';

  const { data: existing } = await client
    .from('live_employee_location')
    .select('latitude, longitude, captured_at, expires_at')
    .eq('company_id', input.companyId)
    .eq('employee_id', input.employeeId)
    .maybeSingle();

  let previous: { latitude: number; longitude: number; atMs: number } | null = null;
  if (existing && existing.latitude != null && existing.longitude != null) {
    const prevN = normalizeOperationalDate(String(existing.captured_at), { quiet: true, source: 'liveLocationPrev' });
    const prevMs = prevN ? prevN.instantMs : operationalClockMs();
    previous = { latitude: Number(existing.latitude), longitude: Number(existing.longitude), atMs: prevMs };
    const mov = detectImpossibleRealtimeMovement(
      { latitude: previous.latitude, longitude: previous.longitude, atMs: prevMs },
      { latitude: input.latitude, longitude: input.longitude, atMs: nowMs },
    );
    if (mov.impossible) {
      recordOperationalMetric('geo_invalid_realtime_movement', 1, {
        company_id: input.companyId,
        employee_id: input.employeeId,
        source: 'live_location',
      });
      reportGeoCircuitSignal('stale_flood');
      void reportDeviceOperationalReputationEvent({
        companyId: input.companyId,
        employeeId: input.employeeId,
        event: 'impossible_movement_blocked',
      });
      return { ok: true, confidence: 'INVALID', skipped: true };
    }
  }

  const rel = evaluateRealtimeGpsReliability({
    latitude: input.latitude,
    longitude: input.longitude,
    accuracyMeters: input.accuracy ?? null,
    coordinateAgeMs: 0,
    speedMps: input.speedMps ?? null,
    provider: input.provider ?? null,
    previous,
    nowMs,
    employeeId: input.employeeId,
    companyId: input.companyId,
  });

  if (!rel.accepted) {
    const ev = rel.blockedReason === 'mock' ? 'mock_surge_blocked' : 'stale_geo_blocked';
    if (rel.blockedReason === 'mock') reportGeoCircuitSignal('mock_surge');
    else reportGeoCircuitSignal('stale_flood');
    void reportDeviceOperationalReputationEvent({
      companyId: input.companyId,
      employeeId: input.employeeId,
      event: ev,
    });
    return { ok: true, confidence: 'INVALID', skipped: true };
  }

  const conf = rel.level as GeoConfidenceLevel;

  const expiresAt = expiresAtIso(LIVE_LOCATION_TTL_MS);
  const { error } = await client.from('live_employee_location').upsert(
    {
      company_id: input.companyId,
      employee_id: input.employeeId,
      latitude: input.latitude,
      longitude: input.longitude,
      accuracy: input.accuracy ?? null,
      captured_at: capIso,
      provider: input.provider ?? null,
      confidence: conf,
      speed: input.speedMps ?? null,
      heading: input.headingDeg ?? null,
      is_stale: false,
      expires_at: expiresAt,
      updated_at: operationalNowUtcIso(),
    },
    { onConflict: 'company_id,employee_id' },
  );
  if (error) return { ok: false, error: error.message };

  console.info('[LIVE LOCATION UPDATED]', {
    company_id: input.companyId,
    employee_id: input.employeeId,
    confidence: conf,
    correlation_id: input.correlationId ?? null,
    expires_at: expiresAt,
  });
  return { ok: true, confidence: conf };
}

export async function runLiveLocationCleanup(clientOverride?: SupabaseClient | null): Promise<number> {
  const client = clientOverride ?? getSupabaseClient();
  if (!client) return 0;
  const { data, error } = await client.rpc('cleanup_expired_live_employee_locations');
  if (error) {
    console.warn('[live_employee_location] cleanup', error.message);
    return 0;
  }
  const n = typeof data === 'number' ? data : Number(data);
  return Number.isFinite(n) ? n : 0;
}

/** Marca linhas acima do TTL lógico como stale (sem apagar), para métricas/UI. */
export function flagStaleLiveLocations(rows: LiveEmployeeLocationRow[], nowMs: number = operationalClockMs()): LiveEmployeeLocationRow[] {
  let staleCount = 0;
  const out = rows.map((r) => {
    const expN = normalizeOperationalDate(r.expires_at, { quiet: true, source: 'liveExpires' });
    const exp = expN ? expN.instantMs : NaN;
    if (Number.isFinite(exp) && exp < nowMs) {
      staleCount += 1;
      if (!r.is_stale) {
        console.info('[LIVE LOCATION STALE]', { company_id: r.company_id, employee_id: r.employee_id, expires_at: r.expires_at });
      }
      return { ...r, is_stale: true };
    }
    return r;
  });
  if (staleCount > 0) {
    recordOperationalMetric('live_location_stale_count', staleCount, { source: 'flagStaleLiveLocations' });
  }
  return out;
}
