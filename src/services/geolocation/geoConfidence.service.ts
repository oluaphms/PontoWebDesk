import { observabilityConsole } from '../../shared/logger/observabilityConsole';
/**
 * Confiança GEO unificada para mapa realtime e presença operacional (não jurídico).
 */

import { distanceMeters, type GeoPoint } from './geoDistance.service';

export type GeoConfidenceLevel = 'HIGH' | 'MEDIUM' | 'LOW' | 'INVALID';

export type GeoConfidenceInput = {
  accuracyMeters: number | null | undefined;
  ageMs: number | null | undefined;
  provider: string | null | undefined;
  speedMps?: number | null | undefined;
  /** 0–1: 1 = totalmente alinhado ao histórico recente */
  historicalConsistency?: number | null | undefined;
  /** Variação de posição em metros em janela curta (repetição/jitter) */
  repeatJitterM?: number | null | undefined;
  impossibleMovement?: boolean | null | undefined;
};

const MAX_URBAN_KMH = 150;

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

export function calculateGeoConfidence(
  input: GeoConfidenceInput,
  opts?: { log?: boolean },
): GeoConfidenceLevel {
  let level: GeoConfidenceLevel = 'HIGH';
  let reason: string | undefined;

  if (input.impossibleMovement) {
    level = 'INVALID';
    reason = 'impossible_movement';
  } else {
    const acc = input.accuracyMeters;
    if (acc != null && acc > 500) {
      level = 'INVALID';
      reason = 'accuracy';
    } else {
      const age = input.ageMs ?? 0;
      if (age > 120_000) {
        level = 'LOW';
        reason = 'stale_age';
      } else {
        const jitter = input.repeatJitterM ?? 0;
        if (jitter > 80) {
          level = 'LOW';
          reason = 'jitter';
        } else {
          const hist = input.historicalConsistency;
          if (hist != null && clamp01(hist) < 0.35) {
            level = 'LOW';
            reason = 'history';
          } else {
            const speed = input.speedMps;
            if (speed != null && Number.isFinite(speed) && speed > 42) {
              level = 'LOW';
              reason = 'speed';
            } else if (acc != null && acc > 300) {
              level = 'LOW';
              reason = 'accuracy';
            } else if (acc != null && acc > 100) {
              level = 'MEDIUM';
              reason = 'accuracy';
            } else if (age > 60_000) {
              level = 'MEDIUM';
              reason = 'age';
            } else {
              const p = String(input.provider ?? '').toLowerCase();
              if (p && !p.includes('gps') && !p.includes('fused') && p !== 'browser' && p !== 'device') {
                level = 'MEDIUM';
                reason = 'provider';
              }
            }
          }
        }
      }
    }
  }

  if (opts?.log !== false) {
    observabilityConsole.info('[GEO CONFIDENCE SCORE]', {
      level,
      reason,
      accuracyMeters: input.accuracyMeters,
      ageMs: input.ageMs,
      provider: input.provider,
    });
  }
  return level;
}

export type ImpossibleMovementResult = {
  impossible: boolean;
  impliedKmh: number;
  meters: number;
  deltaMs: number;
};

export function detectImpossibleRealtimeMovement(
  prev: GeoPoint & { atMs: number },
  next: GeoPoint & { atMs: number },
  maxUrbanKmh: number = MAX_URBAN_KMH,
): ImpossibleMovementResult {
  const deltaMs = next.atMs - prev.atMs;
  const meters = distanceMeters(
    { latitude: prev.latitude, longitude: prev.longitude },
    { latitude: next.latitude, longitude: next.longitude },
  );
  if (deltaMs <= 0) {
    const payload = {
      impliedKmh: Number.POSITIVE_INFINITY,
      meters,
      deltaMs,
      prev,
      next,
    };
    observabilityConsole.warn('[GEO IMPOSSIBLE REALTIME MOVEMENT]', payload);
    return { impossible: true, impliedKmh: Number.POSITIVE_INFINITY, meters, deltaMs };
  }
  const hours = deltaMs / 3_600_000;
  const impliedKmh = meters / 1000 / hours;
  const impossible = impliedKmh > maxUrbanKmh;
  if (impossible) {
    observabilityConsole.warn('[GEO IMPOSSIBLE REALTIME MOVEMENT]', {
      impliedKmh,
      maxUrbanKmh,
      meters,
      deltaMs,
      prev,
      next,
    });
  }
  return { impossible, impliedKmh, meters, deltaMs };
}
