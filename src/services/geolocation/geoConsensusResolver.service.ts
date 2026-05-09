import { distanceMeters } from './geoDistance.service';
import type { NativeGpsAcceptedPoint } from './nativeGpsPrecision.service';

export type GeoConsensusSourceName =
  | 'live_employee_location'
  | 'current_operational_state'
  | 'browser_native_gps'
  | 'last_operational_valid'
  | 'heartbeat'
  | 'recent_history';

export type GeoConsensusSource = {
  source: GeoConsensusSourceName;
  latitude: number;
  longitude: number;
  confidence: number;
  ageMs: number;
};

export type GeoConsensusInput = {
  employeeId: string;
  sources: GeoConsensusSource[];
  nativeGps?: NativeGpsAcceptedPoint | null;
  nowMs?: number;
  requireStableConfirmations?: number;
};

export type GeoConsensusResult = {
  stable: boolean;
  latitude: number | null;
  longitude: number | null;
  weightedConfidence: number;
  acceptedSources: GeoConsensusSourceName[];
  rejectedOutliers: GeoConsensusSourceName[];
  reason: string;
};

const SOURCE_WEIGHT: Record<GeoConsensusSourceName, number> = {
  browser_native_gps: 1.35,
  live_employee_location: 1.2,
  current_operational_state: 1.05,
  last_operational_valid: 0.9,
  recent_history: 0.8,
  heartbeat: 0.65,
};

const CLUSTER_RADIUS_M = 180;
const DIVERGENCE_M = 280;

type MemoryState = {
  hash: string;
  confirmations: number;
};

const memoryByEmployee = new Map<string, MemoryState>();

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) return (sorted[middle - 1] + sorted[middle]) / 2;
  return sorted[middle];
}

function roundedHash(lat: number, lng: number): string {
  return `${lat.toFixed(5)}:${lng.toFixed(5)}`;
}

export function resolveGeoConsensus(input: GeoConsensusInput): GeoConsensusResult {
  const requireStableConfirmations = Math.max(1, input.requireStableConfirmations ?? 2);
  const candidates = input.sources.filter((s) => Number.isFinite(s.latitude) && Number.isFinite(s.longitude));
  if (input.nativeGps) {
    candidates.push({
      source: 'browser_native_gps',
      latitude: input.nativeGps.latitude,
      longitude: input.nativeGps.longitude,
      confidence: input.nativeGps.gps_provider_confidence,
      ageMs: Math.max(0, (input.nowMs ?? Date.now()) - input.nativeGps.capturedAtMs),
    });
  }

  if (candidates.length === 0) {
    return {
      stable: false,
      latitude: null,
      longitude: null,
      weightedConfidence: 0,
      acceptedSources: [],
      rejectedOutliers: [],
      reason: 'no_sources',
    };
  }

  const medLat = median(candidates.map((s) => s.latitude));
  const medLng = median(candidates.map((s) => s.longitude));

  const accepted: GeoConsensusSource[] = [];
  const rejected: GeoConsensusSourceName[] = [];
  for (const s of candidates) {
    const dist = distanceMeters(
      { latitude: medLat, longitude: medLng },
      { latitude: s.latitude, longitude: s.longitude },
    );
    if (dist > DIVERGENCE_M) {
      rejected.push(s.source);
      console.warn('[GEO OUTLIER REJECTED]', {
        employee_id: input.employeeId,
        source: s.source,
        distance_m: dist,
      });
      continue;
    }
    accepted.push(s);
  }

  if (accepted.length === 0) {
    return {
      stable: false,
      latitude: null,
      longitude: null,
      weightedConfidence: 0,
      acceptedSources: [],
      rejectedOutliers: rejected,
      reason: 'all_outliers',
    };
  }

  let sumW = 0;
  let latAcc = 0;
  let lngAcc = 0;
  let confAcc = 0;
  for (const s of accepted) {
    const freshnessPenalty = s.ageMs > 60_000 ? 0.65 : s.ageMs > 20_000 ? 0.82 : 1;
    const w = Math.max(0.1, (SOURCE_WEIGHT[s.source] ?? 1) * Math.max(0.1, s.confidence) * freshnessPenalty);
    sumW += w;
    latAcc += s.latitude * w;
    lngAcc += s.longitude * w;
    confAcc += s.confidence * w;
  }
  const lat = latAcc / sumW;
  const lng = lngAcc / sumW;
  const weightedConfidence = Math.max(0, Math.min(1, confAcc / sumW));

  let diverged = 0;
  for (const s of accepted) {
    const d = distanceMeters(
      { latitude: lat, longitude: lng },
      { latitude: s.latitude, longitude: s.longitude },
    );
    if (d > CLUSTER_RADIUS_M) diverged += 1;
  }
  if (diverged > 0) {
    console.warn('[GEO SOURCE DIVERGENCE]', {
      employee_id: input.employeeId,
      diverged_sources: diverged,
      accepted_sources: accepted.length,
    });
  }

  const hash = roundedHash(lat, lng);
  const mem = memoryByEmployee.get(input.employeeId);
  const confirmations = mem?.hash === hash ? mem.confirmations + 1 : 1;
  memoryByEmployee.set(input.employeeId, { hash, confirmations });
  const stable = confirmations >= requireStableConfirmations;

  const payload = {
    employee_id: input.employeeId,
    stable,
    confirmations,
    weighted_confidence: weightedConfidence,
    accepted_sources: accepted.map((s) => s.source),
    rejected_outliers: rejected,
    latitude: lat,
    longitude: lng,
  };
  console.info('[GEO CONSENSUS]', payload);
  if (stable) console.info('[GEO CONSENSUS STABLE]', payload);

  return {
    stable,
    latitude: stable ? lat : null,
    longitude: stable ? lng : null,
    weightedConfidence,
    acceptedSources: accepted.map((s) => s.source),
    rejectedOutliers: rejected,
    reason: stable ? 'consensus_stable' : 'awaiting_consecutive_confirmations',
  };
}

