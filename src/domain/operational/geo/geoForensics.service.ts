/**
 * Auditoria GEO para disputa trabalhista / fraude — somente leitura e score;
 * não bloqueia operações.
 */

import { distanceMeters } from '../../../services/geolocation/geoDistance.service';

export type GeoForensicsPoint = {
  atMs: number;
  latitude: number;
  longitude: number;
  accuracyMeters?: number | null;
  mocked?: boolean | null;
};

export type GeoForensicsResult = {
  geo_forensics_score: number;
  flags: string[];
};

const IMPOSSIBLE_SPEED_KMH = 180;
const MOCK_WEIGHT = 18;
const TELEPORT_WEIGHT = 22;
const JITTER_WEIGHT = 8;
const DAY_JUMP_WEIGHT = 15;

/**
 * Score 0–100 (100 = sem alertas). Quanto menor, maior suspeita.
 */
export function computeGeoForensicsScore(points: GeoForensicsPoint[], nowMs?: number): GeoForensicsResult {
  const flags: string[] = [];
  let penalty = 0;
  const sorted = [...points].filter((p) => Number.isFinite(p.atMs) && Number.isFinite(p.latitude) && Number.isFinite(p.longitude)).sort((a, b) => a.atMs - b.atMs);

  if (sorted.length === 0) {
    return { geo_forensics_score: 100, flags: ['insufficient_samples'] };
  }

  let mockCount = 0;
  for (const p of sorted) {
    if (p.mocked) mockCount++;
  }
  if (mockCount >= 2) {
    penalty += MOCK_WEIGHT;
    flags.push('recurrent_mock_location');
  } else if (mockCount === 1) {
    penalty += MOCK_WEIGHT / 2;
    flags.push('mock_location_observed');
  }

  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1]!;
    const b = sorted[i]!;
    const dtH = (b.atMs - a.atMs) / 3_600_000;
    if (dtH <= 0) continue;
    const dM = distanceMeters(
      { latitude: a.latitude, longitude: a.longitude },
      { latitude: b.latitude, longitude: b.longitude },
    );
    const kmh = dM / 1000 / dtH;
    if (kmh > IMPOSSIBLE_SPEED_KMH && dM > 800) {
      penalty += TELEPORT_WEIGHT;
      flags.push('impossible_displacement_segment');
      break;
    }
    if (dM < 3 && dtH * 60 < 2 && i > 1) {
      const c = sorted[i - 2]!;
      const dPrev = distanceMeters(
        { latitude: c.latitude, longitude: c.longitude },
        { latitude: a.latitude, longitude: a.longitude },
      );
      if (dPrev > 500) {
        penalty += DAY_JUMP_WEIGHT;
        flags.push('abrupt_daily_position_change');
        break;
      }
    }
  }

  if (sorted.length >= 4) {
    const accs = sorted.map((p) => p.accuracyMeters).filter((x): x is number => x != null && Number.isFinite(x));
    if (accs.length >= 3) {
      const mean = accs.reduce((s, n) => s + n, 0) / accs.length;
      const varSum = accs.reduce((s, n) => s + (n - mean) ** 2, 0) / accs.length;
      if (varSum > 4000) {
        penalty += JITTER_WEIGHT;
        flags.push('gps_inconsistent_accuracy_profile');
      }
    }
  }

  const geo_forensics_score = Math.max(0, Math.min(100, Math.round(100 - penalty)));
  if (geo_forensics_score < 72) {
    console.warn('[GEO FORENSICS ALERT]', { geo_forensics_score, flags });
  }
  return { geo_forensics_score, flags };
}
