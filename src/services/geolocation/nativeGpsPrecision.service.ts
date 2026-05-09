import { operationalClockMs } from '../../utils/operationalClock';
import { distanceMeters } from './geoDistance.service';

export type GpsSignalQuality = 'excellent' | 'good' | 'poor' | 'invalid';

export type NativeGpsAcceptedPoint = {
  latitude: number;
  longitude: number;
  accuracyMeters: number;
  speedMps: number | null;
  capturedAtMs: number;
  gps_signal_quality: GpsSignalQuality;
  gps_provider_confidence: number;
  cached_position_reused: boolean;
  android_mock_location_suspected: boolean;
};

export type NativeGpsRejectedReason =
  | 'accuracy_too_low'
  | 'stale_timestamp'
  | 'repeated_coords'
  | 'impossible_speed'
  | 'teleport_blocked'
  | 'watch_error'
  | 'missing_coords';

type NativeGpsCallbacks = {
  onAccepted: (point: NativeGpsAcceptedPoint) => void;
  onRejected?: (reason: NativeGpsRejectedReason, extra?: Record<string, unknown>) => void;
};

type InternalPoint = {
  latitude: number;
  longitude: number;
  atMs: number;
};

const MAX_ACCEPT_ACCURACY_M = 120;
const MAX_TELEPORT_M = 500;
const TELEPORT_WINDOW_MS = 20_000;
const MAX_REASONABLE_SPEED_MPS = 90;
const STALE_GPS_AGE_MS = 45_000;
const COORD_REPEAT_EPS_M = 1.2;

function uaIsAndroid(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /android/i.test(navigator.userAgent || '');
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function signalQuality(accuracyMeters: number): GpsSignalQuality {
  if (!Number.isFinite(accuracyMeters) || accuracyMeters <= 0) return 'invalid';
  if (accuracyMeters <= 20) return 'excellent';
  if (accuracyMeters <= 60) return 'good';
  if (accuracyMeters <= MAX_ACCEPT_ACCURACY_M) return 'poor';
  return 'invalid';
}

function providerConfidence(accuracyMeters: number, ageMs: number, speedMps: number | null): number {
  let score = 1;
  if (accuracyMeters > 60) score -= 0.35;
  else if (accuracyMeters > 30) score -= 0.15;
  if (ageMs > 20_000) score -= 0.2;
  if (speedMps != null && speedMps > 45) score -= 0.15;
  return clamp01(score);
}

export class NativeGpsPrecisionWatcher {
  private watchId: number | null = null;
  private lastAccepted: InternalPoint | null = null;
  private lastSeenCoords: { latitude: number; longitude: number; timestamp: number } | null = null;

  constructor(private readonly callbacks: NativeGpsCallbacks) {}

  start(): boolean {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return false;
    if (this.watchId != null) return true;
    this.watchId = navigator.geolocation.watchPosition(
      (pos) => this.handlePosition(pos),
      (err) => this.handleError(err),
      {
        enableHighAccuracy: true,
        maximumAge: 0,
        timeout: 20_000,
      },
    );
    return true;
  }

  stop(): void {
    if (this.watchId == null || typeof navigator === 'undefined' || !navigator.geolocation) return;
    navigator.geolocation.clearWatch(this.watchId);
    this.watchId = null;
  }

  getLastAccepted(): NativeGpsAcceptedPoint | null {
    if (!this.lastAccepted) return null;
    return {
      latitude: this.lastAccepted.latitude,
      longitude: this.lastAccepted.longitude,
      accuracyMeters: 0,
      speedMps: null,
      capturedAtMs: this.lastAccepted.atMs,
      gps_signal_quality: 'good',
      gps_provider_confidence: 1,
      cached_position_reused: false,
      android_mock_location_suspected: false,
    };
  }

  private reject(reason: NativeGpsRejectedReason, extra?: Record<string, unknown>): void {
    if (reason === 'stale_timestamp') console.warn('[NATIVE GPS STALE]', extra ?? {});
    else if (reason === 'teleport_blocked') console.warn('[NATIVE GPS TELEPORT BLOCKED]', extra ?? {});
    else console.info('[NATIVE GPS REJECTED]', { reason, ...(extra ?? {}) });
    this.callbacks.onRejected?.(reason, extra);
  }

  private handleError(error: GeolocationPositionError): void {
    this.reject('watch_error', { code: error.code, message: error.message });
  }

  private handlePosition(position: GeolocationPosition): void {
    const nowMs = operationalClockMs();
    const coords = position.coords;
    const tsMs = Number(position.timestamp || 0);
    const lat = Number(coords.latitude);
    const lng = Number(coords.longitude);
    const accuracyMeters = Number(coords.accuracy);
    const speedMps = Number.isFinite(coords.speed) ? Number(coords.speed) : null;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      this.reject('missing_coords');
      return;
    }

    const ageMs = nowMs - tsMs;
    if (!Number.isFinite(tsMs) || ageMs > STALE_GPS_AGE_MS || ageMs < -5_000) {
      this.reject('stale_timestamp', { age_ms: ageMs, timestamp: tsMs });
      return;
    }

    if (!Number.isFinite(accuracyMeters) || accuracyMeters > MAX_ACCEPT_ACCURACY_M) {
      this.reject('accuracy_too_low', { accuracy_m: accuracyMeters });
      return;
    }

    const cached_position_reused =
      this.lastSeenCoords != null &&
      Math.abs(this.lastSeenCoords.latitude - lat) < 0.0000001 &&
      Math.abs(this.lastSeenCoords.longitude - lng) < 0.0000001 &&
      Math.abs(this.lastSeenCoords.timestamp - tsMs) < 3;
    if (cached_position_reused) {
      console.warn('[NATIVE GPS CACHE REUSED]', { timestamp: tsMs });
      this.reject('repeated_coords', { reason: 'cache_reused' });
      return;
    }

    const repeatedCoords =
      this.lastSeenCoords != null &&
      distanceMeters(
        { latitude: this.lastSeenCoords.latitude, longitude: this.lastSeenCoords.longitude },
        { latitude: lat, longitude: lng },
      ) < COORD_REPEAT_EPS_M &&
      Math.abs(tsMs - this.lastSeenCoords.timestamp) < 8_000;
    if (repeatedCoords) {
      this.reject('repeated_coords', { reason: 'repeated_eps' });
      return;
    }
    this.lastSeenCoords = { latitude: lat, longitude: lng, timestamp: tsMs };

    if (speedMps != null && speedMps > MAX_REASONABLE_SPEED_MPS) {
      this.reject('impossible_speed', { speed_mps: speedMps });
      return;
    }

    if (this.lastAccepted) {
      const dtMs = tsMs - this.lastAccepted.atMs;
      if (dtMs > 0 && dtMs < TELEPORT_WINDOW_MS) {
        const distM = distanceMeters(
          { latitude: this.lastAccepted.latitude, longitude: this.lastAccepted.longitude },
          { latitude: lat, longitude: lng },
        );
        if (distM > MAX_TELEPORT_M) {
          this.reject('teleport_blocked', { distance_m: distM, delta_ms: dtMs });
          return;
        }
      }
    }

    const android_mock_location_suspected =
      uaIsAndroid() &&
      ((speedMps != null && speedMps > 35 && accuracyMeters > 80) || (this.lastAccepted == null && ageMs < 1000));
    if (android_mock_location_suspected) {
      console.warn('[NATIVE GPS MOCK SUSPECTED]', { accuracy_m: accuracyMeters, speed_mps: speedMps });
    }

    const gps_signal_quality = signalQuality(accuracyMeters);
    if (gps_signal_quality === 'invalid') {
      this.reject('accuracy_too_low', { quality: gps_signal_quality });
      return;
    }
    const gps_provider_confidence = providerConfidence(accuracyMeters, ageMs, speedMps);

    this.lastAccepted = { latitude: lat, longitude: lng, atMs: tsMs };
    const accepted: NativeGpsAcceptedPoint = {
      latitude: lat,
      longitude: lng,
      accuracyMeters,
      speedMps,
      capturedAtMs: tsMs,
      gps_signal_quality,
      gps_provider_confidence,
      cached_position_reused,
      android_mock_location_suspected,
    };
    console.info('[NATIVE GPS ACCEPTED]', {
      accuracy_m: accuracyMeters,
      speed_mps: speedMps,
      quality: gps_signal_quality,
      provider_confidence: gps_provider_confidence,
    });
    this.callbacks.onAccepted(accepted);
  }
}

