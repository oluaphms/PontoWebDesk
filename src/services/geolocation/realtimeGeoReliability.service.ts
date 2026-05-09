/**
 * Hierarquia de confiabilidade GPS em tempo real (monitoramento — não jurídico).
 */

import { distanceMeters } from './geoDistance.service';
import { validateCoordinateOrder } from './geoIntegrity.service';
import { recordOperationalMetric } from '../../domain/operational/metrics/operationalMetrics';

export type RealtimeGpsReliabilityLevel = 'HIGH' | 'MEDIUM' | 'LOW' | 'INVALID';

export type RealtimeGpsReliabilityResult = {
  level: RealtimeGpsReliabilityLevel;
  accepted: boolean;
  blockedReason?: 'stale' | 'speed' | 'teleport' | 'invalid_lat_lng' | 'accuracy' | 'accuracy_map_block' | 'mock';
};

const STALE_MS = 90_000;
const MAX_SPEED_KMH = 150;
const MAX_SPEED_MPS = MAX_SPEED_KMH / 3.6;
const TELEPORT_M = 3000;
const TELEPORT_WINDOW_MS = 60_000;

function accuracyTier(accuracyMeters: number | null | undefined): RealtimeGpsReliabilityLevel {
  if (accuracyMeters == null || !Number.isFinite(accuracyMeters)) return 'MEDIUM';
  const a = accuracyMeters;
  if (a <= 30) return 'HIGH';
  if (a <= 80) return 'MEDIUM';
  if (a <= 300) return 'LOW';
  return 'INVALID';
}

function isMockSuspected(provider: string | null | undefined, accuracyMeters: number | null | undefined): boolean {
  const p = String(provider ?? '').toLowerCase();
  if (/\b(mock|fake|debug|test)\b/.test(p)) return true;
  if (p.includes('fakegps')) return true;
  if (accuracyMeters === 0 && p.length === 0) return true;
  return false;
}

export function isRealtimeGpsMockSuspected(
  provider: string | null | undefined,
  accuracyMeters: number | null | undefined,
): boolean {
  return isMockSuspected(provider, accuracyMeters);
}

export type EvaluateRealtimeGpsReliabilityInput = {
  latitude: number;
  longitude: number;
  accuracyMeters: number | null | undefined;
  /** Idade da coordenada em ms (agora - captura). */
  coordinateAgeMs: number;
  speedMps?: number | null | undefined;
  provider?: string | null | undefined;
  /** Posição anterior aceita (mesmo colaborador) para detectar salto/teleporte. */
  previous?: { latitude: number; longitude: number; atMs: number } | null;
  nowMs?: number;
  log?: boolean;
  /** Quando true, não emite métricas nem logs (triagem de candidatos). */
  silent?: boolean;
  employeeId?: string | null;
  companyId?: string | null;
};

/**
 * accuracy: ≤30 HIGH, ≤80 MEDIUM, ≤300 LOW (mapa com baixa confiança), >300 INVALID (mapa bloqueado).
 * Bloqueia: stale >90s, velocidade >150 km/h, salto >3 km em <60s, lat/lng inválidos, mock suspeito.
 */
export function evaluateRealtimeGpsReliability(
  input: EvaluateRealtimeGpsReliabilityInput,
): RealtimeGpsReliabilityResult {
  const nowMs = input.nowMs ?? Date.now();
  const silent = input.silent === true;
  const log = !silent && input.log !== false;

  const rangeIssues = validateCoordinateOrder(input.latitude, input.longitude);
  if (rangeIssues.includes('invalid_range')) {
    if (log) {
      console.info('[GEO HARDLOCK]', { op: 'invalid_coordinates' });
      console.info('[GEO POSITION REJECTED]', { reason: 'invalid_lat_lng', employee_id: input.employeeId });
    }
    if (log) console.warn('[GEO RELIABILITY EVALUATION]', { accepted: false, reason: 'invalid_lat_lng' });
    if (!silent) {
      recordOperationalMetric('geo_invalid_realtime_movement', 1, {
        company_id: input.companyId ?? null,
        employee_id: input.employeeId ?? null,
        source: 'invalid_lat_lng',
      });
    }
    return { level: 'INVALID', accepted: false, blockedReason: 'invalid_lat_lng' };
  }

  if (isMockSuspected(input.provider, input.accuracyMeters)) {
    if (log) console.warn('[GEO MOCK SUSPECTED]', { provider: input.provider, employee_id: input.employeeId });
    if (!silent) {
      recordOperationalMetric('geo_mock_suspected', 1, {
        company_id: input.companyId ?? null,
        employee_id: input.employeeId ?? null,
        source: 'geo_reliability',
      });
    }
    return { level: 'INVALID', accepted: false, blockedReason: 'mock' };
  }

  if (input.coordinateAgeMs > STALE_MS) {
    if (log) console.warn('[GEO STALE COORDINATE]', { age_ms: input.coordinateAgeMs, employee_id: input.employeeId });
    if (!silent) {
      recordOperationalMetric('geo_stale_coordinate_blocked', 1, {
        company_id: input.companyId ?? null,
        employee_id: input.employeeId ?? null,
        source: 'stale_coordinate',
      });
    }
    return { level: 'INVALID', accepted: false, blockedReason: 'stale' };
  }

  const speed = input.speedMps;
  if (speed != null && Number.isFinite(speed) && speed > MAX_SPEED_MPS) {
    if (log) console.warn('[GEO RELIABILITY EVALUATION]', { accepted: false, reason: 'speed', speed_mps: speed });
    if (!silent) {
      recordOperationalMetric('geo_invalid_realtime_movement', 1, {
        company_id: input.companyId ?? null,
        employee_id: input.employeeId ?? null,
        source: 'geo_speed',
      });
    }
    return { level: 'INVALID', accepted: false, blockedReason: 'speed' };
  }

  const prev = input.previous;
  if (prev && Number.isFinite(prev.atMs)) {
    const deltaMs = nowMs - prev.atMs;
    if (deltaMs > 0 && deltaMs < TELEPORT_WINDOW_MS) {
      const meters = distanceMeters(
        { latitude: prev.latitude, longitude: prev.longitude },
        { latitude: input.latitude, longitude: input.longitude },
      );
      if (meters > TELEPORT_M) {
        if (log) {
          console.warn('[GEO TELEPORT DETECTED]', {
            meters,
            delta_ms: deltaMs,
            employee_id: input.employeeId,
          });
        }
        if (!silent) {
          recordOperationalMetric('geo_teleport_detected', 1, {
            company_id: input.companyId ?? null,
            employee_id: input.employeeId ?? null,
            source: 'geo_reliability',
          });
        }
        return { level: 'INVALID', accepted: false, blockedReason: 'teleport' };
      }
    }
  }

  const tier = accuracyTier(input.accuracyMeters);
  if (tier === 'INVALID') {
    if (log) {
      console.warn('[GEO MAP BLOCKED]', { accuracy: input.accuracyMeters, employee_id: input.employeeId });
      console.info('[GEO HARDLOCK]', { op: 'accuracy_gt_300m' });
      console.info('[GEO POSITION REJECTED]', { reason: 'accuracy_map_block', accuracy: input.accuracyMeters });
    }
    if (!silent) {
      recordOperationalMetric('geo_invalid_realtime_movement', 1, {
        company_id: input.companyId ?? null,
        employee_id: input.employeeId ?? null,
        source: 'geo_accuracy_reliability',
      });
    }
    return { level: 'INVALID', accepted: false, blockedReason: 'accuracy_map_block' };
  }

  if (log) {
    console.info('[GEO RELIABILITY EVALUATION]', {
      level: tier,
      age_ms: input.coordinateAgeMs,
      accuracy: input.accuracyMeters,
      employee_id: input.employeeId,
    });
    console.info('[GEO CONFIDENCE UPDATED]', { level: tier, employee_id: input.employeeId });
  }
  if (!silent) {
    recordOperationalMetric('geo_reliability_eval', 1, {
      company_id: input.companyId ?? null,
      employee_id: input.employeeId ?? null,
      source: tier,
    });
  }
  return { level: tier, accepted: true };
}
