/**
 * Sistema inteligente antifraude
 * Análises: geolocalização, fingerprint de dispositivo, velocidade impossível, padrão suspeito.
 * Score de risco: 0-30 normal, 30-70 suspeito, 70-100 fraude provável.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export interface PunchForAnalysis {
  id: string;
  user_id: string;
  company_id: string;
  type?: string;
  timestamp?: string | null;
  created_at: string;
  source?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  device_id?: string | null;
  ip_address?: string | null;
}

export interface FraudAnalysisResult {
  punch_id: string;
  risk_score: number;
  reason: string;
  device_id: string | null;
  latitude: number | null;
  longitude: number | null;
  flags: string[];
}

const RADIUS_VIOLATION_KM = 0.5;
const IMPOSSIBLE_SPEED_KMH = 200;
const EARTH_RADIUS_KM = 6371;

function haversineKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_KM * c;
}

/**
 * Analisa uma marcação e retorna score de risco e motivos.
 */
export function analyzePunch(
  punch: PunchForAnalysis,
  options?: {
    allowedLat?: number;
    allowedLon?: number;
    allowedRadiusKm?: number;
    previousPunch?: PunchForAnalysis | null;
    sameDevicePunchCount?: number;
  }
): FraudAnalysisResult {
  const flags: string[] = [];
  let score = 0;
  const reasonParts: string[] = [];

  const allowedRadius = options?.allowedRadiusKm ?? RADIUS_VIOLATION_KM;

  // Geolocalização: distância do local permitido
  if (punch.latitude != null && punch.longitude != null) {
    if (options?.allowedLat != null && options?.allowedLon != null) {
      const dist = haversineKm(
        options.allowedLat,
        options.allowedLon,
        punch.latitude,
        punch.longitude
      );
      if (dist > allowedRadius) {
        score += 40;
        flags.push('location_violation');
        reasonParts.push(`Fora do raio permitido (${dist.toFixed(1)} km)`);
      }
    }
  } else if (punch.source === 'mobile' || punch.source === 'desktop') {
    score += 15;
    flags.push('missing_location');
    reasonParts.push('Sem geolocalização em registro mobile/desktop');
  }

  // Mesmo dispositivo marcando vários funcionários (recebido como sameDevicePunchCount)
  if (options?.sameDevicePunchCount != null && options.sameDevicePunchCount > 5 && punch.device_id) {
    score += 35;
    flags.push('device_shared');
    reasonParts.push('Mesmo dispositivo com muitas marcações de outros usuários');
  }

  // Velocidade impossível: marcação em locais distantes em poucos minutos
  if (
    options?.previousPunch &&
    punch.latitude != null &&
    punch.longitude != null &&
    options.previousPunch.latitude != null &&
    options.previousPunch.longitude != null
  ) {
    const t1 = new Date(punch.timestamp || punch.created_at).getTime();
    const t2 = new Date(options.previousPunch.timestamp || options.previousPunch.created_at).getTime();
    const hours = Math.abs(t1 - t2) / (60 * 60 * 1000);
    if (hours > 0 && hours < 1) {
      const dist = haversineKm(
        options.previousPunch.latitude,
        options.previousPunch.longitude,
        punch.latitude,
        punch.longitude
      );
      const speedKmh = dist / hours;
      if (speedKmh > IMPOSSIBLE_SPEED_KMH) {
        score += 50;
        flags.push('impossible_speed');
        reasonParts.push(`Velocidade impossível (${speedKmh.toFixed(0)} km/h)`);
      }
    }
  }

  // Padrão suspeito: marcação sempre no mesmo segundo (avaliar por lote, não aqui; aqui só marcamos se já vier flag)
  if (score > 70) flags.push('high_risk');

  const risk_score = Math.min(100, Math.round(score));
  const reason = reasonParts.length ? reasonParts.join('; ') : (risk_score > 0 ? 'Análise de risco' : 'Normal');

  return {
    punch_id: punch.id,
    risk_score,
    reason,
    device_id: punch.device_id ?? null,
    latitude: punch.latitude ?? null,
    longitude: punch.longitude ?? null,
    flags,
  };
}

/**
 * Persiste análise na tabela punch_risk_analysis.
 */
export async function savePunchRiskAnalysis(
  _client: SupabaseClient | null,
  analysis: FraudAnalysisResult
): Promise<void> {
  const { db } = await import('../../services/supabaseClient');
  await db.insert('punch_risk_analysis', {
    punch_id: analysis.punch_id,
    risk_score: analysis.risk_score,
    reason: analysis.reason,
    device_id: analysis.device_id,
    latitude: analysis.latitude,
    longitude: analysis.longitude,
    details: { flags: analysis.flags },
    created_at: new Date().toISOString(),
  });
}
