/**
 * Motor antifraude para registro de ponto (SmartPonto).
 * Valida identidade, geolocalização, dispositivo, face e padrão comportamental.
 */

import type { GeoPosition } from '../services/locationService';

export const FRAUD_FLAGS = {
  LOCATION_VIOLATION: 'location_violation',
  DEVICE_UNKNOWN: 'device_unknown',
  FACE_MISMATCH: 'face_mismatch',
  BEHAVIOR_ANOMALY: 'behavior_anomaly',
} as const;

export const FRAUD_SCORES = {
  FACE_MISMATCH: 40,
  DEVICE_UNKNOWN: 20,
  LOCATION_VIOLATION: 30,
  BEHAVIOR_ANOMALY: 30,
} as const;

export interface ValidationLocationInput {
  latitude: number;
  longitude: number;
  accuracy?: number;
}

export interface AllowedLocation {
  id: string;
  company_id: string;
  name: string;
  latitude: number;
  longitude: number;
  radius: number;
}

export interface ValidateLocationResult {
  valid: boolean;
  withinAllowed: boolean;
  flag?: typeof FRAUD_FLAGS.LOCATION_VIOLATION;
  distanceMeters?: number;
  nearestLocation?: AllowedLocation;
}

export interface DeviceFingerprint {
  deviceId: string;
  deviceName?: string;
  browser?: string;
  os?: string;
  platform?: string;
  timezone?: string;
  screenResolution?: string;
}

export interface ValidateDeviceResult {
  valid: boolean;
  trusted: boolean;
  flag?: typeof FRAUD_FLAGS.DEVICE_UNKNOWN;
  fingerprint: DeviceFingerprint;
}

export interface ValidateFaceResult {
  valid: boolean;
  score: number;
  flag?: typeof FRAUD_FLAGS.FACE_MISMATCH;
}

export interface AnomalyResult {
  isAnomaly: boolean;
  flag?: typeof FRAUD_FLAGS.BEHAVIOR_ANOMALY;
  reasons?: string[];
}

export interface ValidatePunchInput {
  employeeId: string;
  companyId: string;
  type: string;
  location?: ValidationLocationInput | null;
  deviceFingerprint?: DeviceFingerprint | null;
  faceScore?: number | null;
  behaviorAnomaly?: boolean;
  allowedLocations?: AllowedLocation[];
  trustedDeviceIds?: string[];
}

export interface ValidatePunchResult {
  valid: boolean;
  fraudScore: number;
  fraudFlags: string[];
  location: ValidateLocationResult | null;
  device: ValidateDeviceResult | null;
  face: ValidateFaceResult | null;
  anomaly: AnomalyResult | null;
  suspicious: boolean;
}

const EARTH_RADIUS_M = 6371000;
const DEVICE_ID_STORAGE_KEY = 'smartponto.device_id.v1';

/**
 * Distância em metros entre dois pontos (fórmula de Haversine).
 */
export function haversineDistanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_M * c;
}

/**
 * Verifica se o ponto (lat, lon) está dentro de alguma zona autorizada.
 */
export function isWithinAllowedLocation(
  latitude: number,
  longitude: number,
  allowedLocations: AllowedLocation[]
): ValidateLocationResult {
  if (!allowedLocations?.length) {
    return { valid: true, withinAllowed: true };
  }

  let minDistance = Infinity;
  let nearest: AllowedLocation | undefined;

  for (const loc of allowedLocations) {
    const dist = haversineDistanceMeters(latitude, longitude, Number(loc.latitude), Number(loc.longitude));
    if (dist < minDistance) {
      minDistance = dist;
      nearest = loc;
    }
  }

  const radius = nearest ? Number(nearest.radius) : 200;
  const withinAllowed = minDistance <= radius;

  return {
    valid: withinAllowed,
    withinAllowed,
    distanceMeters: Math.round(minDistance),
    nearestLocation: nearest,
    ...(withinAllowed ? {} : { flag: FRAUD_FLAGS.LOCATION_VIOLATION }),
  };
}

/**
 * Valida geolocalização do registro.
 */
export function validateLocation(
  position: ValidationLocationInput,
  allowedLocations: AllowedLocation[] = []
): ValidateLocationResult {
  return isWithinAllowedLocation(position.latitude, position.longitude, allowedLocations);
}

/**
 * Gera fingerprint do dispositivo (userAgent, screen, timezone, platform).
 */
export function generateDeviceFingerprint(): DeviceFingerprint {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  // Não nomear como `screen`: sombreia o global e causa TDZ ("Cannot access before initialization").
  const screenResolution =
    typeof window !== 'undefined' && window.screen
      ? `${window.screen.width}x${window.screen.height}`
      : '';
  const tz = typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : '';
  const platform = typeof navigator !== 'undefined' ? navigator.platform : '';
  const str = [ua, screenResolution, tz, platform].join('|');
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    hash = (hash << 5) - hash + c;
    hash = hash & hash;
  }
  const baseId = `fp_${Math.abs(hash).toString(36)}`;
  let stableSuffix = '';
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      stableSuffix = window.localStorage.getItem(DEVICE_ID_STORAGE_KEY) || '';
      if (!stableSuffix) {
        const rnd = Math.random().toString(36).slice(2, 10);
        stableSuffix = rnd || 'local';
        window.localStorage.setItem(DEVICE_ID_STORAGE_KEY, stableSuffix);
      }
    } catch {
      stableSuffix = 'fallback';
    }
  }
  const deviceId = stableSuffix ? `${baseId}_${stableSuffix}` : baseId;

  return {
    deviceId,
    browser: ua.split(/[/\s]/)[0] || undefined,
    os: typeof navigator !== 'undefined' ? (navigator as any).userAgentData?.platform : undefined,
    platform,
    timezone: tz,
    screenResolution,
  };
}

/**
 * Valida se o dispositivo é conhecido/confiável.
 */
export function validateDevice(
  fingerprint: DeviceFingerprint,
  trustedDeviceIds: string[] = []
): ValidateDeviceResult {
  const trusted = trustedDeviceIds.includes(fingerprint.deviceId);
  return {
    valid: trusted,
    trusted,
    fingerprint,
    ...(trusted ? {} : { flag: FRAUD_FLAGS.DEVICE_UNKNOWN }),
  };
}

/**
 * Valida face (score de similaridade 0–1). Limite padrão 0.6.
 */
export function validateFace(score: number, threshold: number = 0.6): ValidateFaceResult {
  const valid = score >= threshold;
  return {
    valid,
    score,
    ...(valid ? {} : { flag: FRAUD_FLAGS.FACE_MISMATCH }),
  };
}

/**
 * Detecta anomalia comportamental (delegado ao módulo de detecção).
 */
export function detectAnomaly(_input: {
  employeeId: string;
  companyId: string;
  type: string;
  timestamp: Date;
  location?: ValidationLocationInput | null;
  deviceId?: string | null;
}): AnomalyResult {
  const input = _input;
  const reasons: string[] = [];
  const h = input.timestamp.getHours();

  // Heurística de horário extremo (fora de jornada padrão).
  if (h >= 0 && h < 4) {
    reasons.push('Registro em horário atípico (madrugada)');
  }

  // Precisão muito ruim tende a indicar GPS instável/spoofing por app externo.
  if (input.location?.accuracy != null && input.location.accuracy > 1000) {
    reasons.push('Precisão de geolocalização muito baixa');
  }

  // Dispositivo ausente quando esperado para web/mobile.
  if (!input.deviceId || String(input.deviceId).trim() === '') {
    reasons.push('Dispositivo não identificado');
  }

  if (reasons.length === 0) return { isAnomaly: false };
  return { isAnomaly: true, flag: FRAUD_FLAGS.BEHAVIOR_ANOMALY, reasons };
}

/**
 * Calcula pontuação de fraude a partir das flags.
 */
export function calculateFraudScore(flags: string[]): number {
  let score = 0;
  if (flags.includes(FRAUD_FLAGS.FACE_MISMATCH)) score += FRAUD_SCORES.FACE_MISMATCH;
  if (flags.includes(FRAUD_FLAGS.DEVICE_UNKNOWN)) score += FRAUD_SCORES.DEVICE_UNKNOWN;
  if (flags.includes(FRAUD_FLAGS.LOCATION_VIOLATION)) score += FRAUD_SCORES.LOCATION_VIOLATION;
  if (flags.includes(FRAUD_FLAGS.BEHAVIOR_ANOMALY)) score += FRAUD_SCORES.BEHAVIOR_ANOMALY;
  return Math.min(100, score);
}

/**
 * Valida o registro de ponto completo e retorna score + flags.
 */
export function validatePunch(input: ValidatePunchInput): ValidatePunchResult {
  const flags: string[] = [];
  let locationResult: ValidateLocationResult | null = null;
  let deviceResult: ValidateDeviceResult | null = null;
  let faceResult: ValidateFaceResult | null = null;
  let anomalyResult: AnomalyResult | null = null;

  if (input.location) {
    locationResult = validateLocation(input.location, input.allowedLocations ?? []);
    if (locationResult.flag) flags.push(locationResult.flag);
  }

  if (input.deviceFingerprint) {
    deviceResult = validateDevice(input.deviceFingerprint, input.trustedDeviceIds ?? []);
    if (deviceResult.flag) flags.push(deviceResult.flag);
  }

  if (input.faceScore != null) {
    faceResult = validateFace(input.faceScore);
    if (faceResult.flag) flags.push(faceResult.flag);
  }

  if (input.behaviorAnomaly) {
    anomalyResult = { isAnomaly: true, flag: FRAUD_FLAGS.BEHAVIOR_ANOMALY };
    flags.push(FRAUD_FLAGS.BEHAVIOR_ANOMALY);
  }

  const fraudScore = calculateFraudScore(flags);
  const suspicious = fraudScore > 50;

  return {
    valid: flags.length === 0,
    fraudScore,
    fraudFlags: flags,
    location: locationResult,
    device: deviceResult,
    face: faceResult,
    anomaly: anomalyResult,
    suspicious,
  };
}
