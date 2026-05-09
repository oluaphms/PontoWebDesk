/**
 * Camada defensiva GEO — somente score e flags (sem bloquear fluxo de produção).
 */

import { distanceMeters } from './geoDistance.service';
import { evaluateRealtimeGpsReliability } from './realtimeGeoReliability.service';

export type GeoTrustLevel = 'trusted' | 'suspicious' | 'blocked';

export type GeoFraudEvaluation = {
  geo_trust_score: number;
  geo_fraud_flags: string[];
  trust_level: GeoTrustLevel;
};

const REPEAT_EPS_M = 2;
const JITTER_MIN_M = 0.5;
const JITTER_MAX_SAMPLES = 6;

function clampScore(n: number): number {
  return Math.max(0, Math.min(100, n));
}

/**
 * Combina heurísticas de movimento impossível, mock, teleporte, coordenada repetida e “replay” de stale.
 * `trust_level === 'blocked'` indica risco alto para observabilidade — não aciona bloqueio automático em outras camadas.
 */
export function evaluateGeoFraudSignals(input: {
  latitude: number;
  longitude: number;
  accuracyMeters?: number | null;
  coordinateAgeMs: number;
  speedMps?: number | null;
  provider?: string | null;
  previous?: { latitude: number; longitude: number; atMs: number } | null;
  nowMs?: number;
  /** Últimas posições aceitas (mesmo colaborador) para detectar repetição/jitter artificial. */
  recentAccepted?: Array<{ latitude: number; longitude: number; atMs: number }>;
  employeeId?: string | null;
  companyId?: string | null;
}): GeoFraudEvaluation {
  const flags: string[] = [];
  const nowMs = input.nowMs ?? Date.now();

  const rel = evaluateRealtimeGpsReliability({
    latitude: input.latitude,
    longitude: input.longitude,
    accuracyMeters: input.accuracyMeters,
    coordinateAgeMs: input.coordinateAgeMs,
    speedMps: input.speedMps,
    provider: input.provider,
    previous: input.previous,
    nowMs,
    silent: true,
    log: false,
    employeeId: input.employeeId,
    companyId: input.companyId,
  });

  if (!rel.accepted) {
    flags.push(`reliability:${rel.blockedReason ?? 'unknown'}`);
  }

  const recent = input.recentAccepted ?? [];
  for (const p of recent) {
    const d = distanceMeters(
      { latitude: p.latitude, longitude: p.longitude },
      { latitude: input.latitude, longitude: input.longitude },
    );
    if (d < REPEAT_EPS_M) {
      flags.push('coordinate_repeat');
      break;
    }
  }

  if (recent.length >= 3) {
    const deltas: number[] = [];
    const seq = [...recent.slice(-JITTER_MAX_SAMPLES), { latitude: input.latitude, longitude: input.longitude, atMs: nowMs }];
    for (let i = 1; i < seq.length; i++) {
      deltas.push(
        distanceMeters(
          { latitude: seq[i - 1]!.latitude, longitude: seq[i - 1]!.longitude },
          { latitude: seq[i]!.latitude, longitude: seq[i]!.longitude },
        ),
      );
    }
    const allTiny = deltas.every((d) => d > 0 && d < JITTER_MIN_M);
    const varianceLow = deltas.every((d) => Math.abs(d - (deltas[0] ?? 0)) < 0.2);
    if (allTiny && varianceLow && deltas.length >= 3) {
      flags.push('jitter_artificial');
    }
  }

  if (input.coordinateAgeMs > 60_000 && input.previous && nowMs - input.previous.atMs < 5000) {
    flags.push('stale_coordinate_replay');
  }

  let score = 100;
  score -= flags.length * 12;
  if (rel.level === 'INVALID') score -= 25;
  else if (rel.level === 'LOW') score -= 8;
  else if (rel.level === 'MEDIUM') score -= 4;

  score = clampScore(score);

  let trust_level: GeoTrustLevel = 'trusted';
  if (score < 40 || flags.length >= 3) trust_level = 'blocked';
  else if (score < 70 || flags.length > 0) trust_level = 'suspicious';

  if (flags.length > 0) {
    console.warn('[GEO FRAUD DETECTED]', {
      flags,
      employee_id: input.employeeId,
      company_id: input.companyId,
    });
  }

  console.info('[GEO TRUST SCORE]', {
    score,
    trust_level,
    employee_id: input.employeeId,
    reliability_level: rel.level,
  });

  if (trust_level === 'blocked') {
    console.warn('[GEO LOCATION BLOCKED]', {
      note: 'observability_only',
      score,
      flags,
      employee_id: input.employeeId,
    });
  }

  return { geo_trust_score: score, geo_fraud_flags: flags, trust_level };
}
