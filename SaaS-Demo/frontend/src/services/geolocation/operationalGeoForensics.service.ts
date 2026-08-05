import { observabilityConsole } from '../../shared/logger/observabilityConsole';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseClient } from '../supabaseClient';
import type { GeoForensicsPoint } from '../../domain/operational/geo/geoForensics.service';
import { computeGeoForensicsScore } from '../../domain/operational/geo/geoForensics.service';

export type GeoRiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export type OperationalGeoForensicsInput = {
  companyId: string;
  employeeId: string;
  points: GeoForensicsPoint[];
  recentAccepted?: Array<{ latitude: number; longitude: number; atMs: number }>;
  previousPosition?: { latitude: number; longitude: number } | null;
  nextPosition?: { latitude: number; longitude: number } | null;
  deltaMeters?: number | null;
  speedMps?: number | null;
  source?: string | null;
  deviceReputation?: string | null;
  networkMode?: string | null;
  visibilityState?: string | null;
  runtimePlatform?: string | null;
  checksum?: string | null;
  lineage?: string | null;
  stateVersion?: number | null;
  geoRenderDecision?: 'accepted' | 'rejected' | 'stale' | 'regression' | 'ghost' | 'invalid_checksum' | null;
};

function hasReplayPattern(points: GeoForensicsPoint[]): boolean {
  if (points.length < 3) return false;
  const recent = points.slice(-3);
  return (
    recent[0]?.atMs === recent[1]?.atMs ||
    recent[1]?.atMs === recent[2]?.atMs ||
    (recent[0]?.latitude === recent[2]?.latitude && recent[0]?.longitude === recent[2]?.longitude)
  );
}

function countImpossiblePatterns(points: GeoForensicsPoint[]): number {
  let impossible = 0;
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1]!;
    const cur = points[i]!;
    const dt = cur.atMs - prev.atMs;
    if (dt > 0 && dt < 20_000) {
      const dLat = Math.abs(cur.latitude - prev.latitude);
      const dLng = Math.abs(cur.longitude - prev.longitude);
      if (dLat + dLng > 0.01) impossible++;
    }
  }
  return impossible;
}

function toRiskLevel(score: number, extraFlags: string[]): GeoRiskLevel {
  if (score < 35 || extraFlags.includes('multi_device_simultaneous')) return 'CRITICAL';
  if (score < 55 || extraFlags.length >= 3) return 'HIGH';
  if (score < 75 || extraFlags.length > 0) return 'MEDIUM';
  return 'LOW';
}

export async function evaluateAndPersistOperationalGeoForensics(
  input: OperationalGeoForensicsInput,
  clientOverride?: SupabaseClient | null,
): Promise<{ score: number; riskLevel: GeoRiskLevel; flags: string[] }> {
  const base = computeGeoForensicsScore(input.points);
  const flags = [...base.flags];

  if (hasReplayPattern(input.points)) {
    flags.push('position_replay_pattern');
    observabilityConsole.warn('[GEO REPLAY DETECTED]', {
      company_id: input.companyId,
      employee_id: input.employeeId,
    });
  }
  const impossible = countImpossiblePatterns(input.points);
  if (impossible >= 2) flags.push('recurrent_teleport');
  if (input.recentAccepted && input.recentAccepted.length >= 8) {
    const uniq = new Set(input.recentAccepted.slice(-8).map((p) => `${p.latitude.toFixed(5)}:${p.longitude.toFixed(5)}`));
    if (uniq.size <= 2) flags.push('gps_frozen');
  }
  if (flags.includes('recurrent_mock_location') || flags.includes('mock_location_observed')) {
    flags.push('mock_provider');
  }

  const adjustedScore = Math.max(0, base.geo_forensics_score - Math.max(0, flags.length - base.flags.length) * 6);
  const riskLevel = toRiskLevel(adjustedScore, flags);
  if (riskLevel === 'CRITICAL') {
    observabilityConsole.error('[GEO FORENSICS CRITICAL]', {
      company_id: input.companyId,
      employee_id: input.employeeId,
      flags,
    });
  }
  if (flags.length > 0) {
    observabilityConsole.warn('[GEO FRAUD PATTERN]', {
      company_id: input.companyId,
      employee_id: input.employeeId,
      flags,
      risk_level: riskLevel,
    });
  }

  const client = clientOverride ?? getSupabaseClient();
  if (client) {
    await client.from('operational_geo_forensics_history').insert({
      company_id: input.companyId,
      employee_id: input.employeeId,
      geo_forensics_score: adjustedScore,
      geo_risk_level: riskLevel,
      flags,
      sample_size: input.points.length,
      previous_position: input.previousPosition ?? null,
      next_position: input.nextPosition ?? null,
      delta_meters: input.deltaMeters ?? null,
      speed_mps: input.speedMps ?? null,
      source: input.source ?? null,
      device_reputation: input.deviceReputation ?? null,
      network_mode: input.networkMode ?? null,
      visibility_state: input.visibilityState ?? null,
      runtime_platform: input.runtimePlatform ?? null,
      checksum: input.checksum ?? null,
      lineage: input.lineage ?? null,
      state_version: input.stateVersion ?? null,
      geo_render_decision: input.geoRenderDecision ?? null,
    });
  }

  return { score: adjustedScore, riskLevel, flags };
}

