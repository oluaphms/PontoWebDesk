/**
 * Fonte única para o mapa de monitoramento: live_employee_location → current_operational_state → time_record.
 * Não mistura coordenadas entre fontes; aceita apenas a primeira camada que passa nas validações temporais e de drift.
 */

import type { LiveEmployeeLocationRow } from '../liveEmployeeLocation.service';
import type { CurrentOperationalStateRow } from '../currentOperationalState.service';
import { validateCoordinateOrder } from './geoIntegrity.service';
import { calculateGeoConfidence, type GeoConfidenceLevel } from './geoConfidence.service';
import { distanceMeters } from './geoDistance.service';
import {
  GEO_ACCURACY_BLOCK_MARKER_M,
} from '../monitoring/monitoringGeoHardLock.service';
import { normalizeOperationalDate } from '../../utils/operationalDateHardLock';
import {
  MONITORING_GEO_FUTURE_TOLERANCE_MS,
  MONITORING_MARKER_STALE_HIDE_MS,
  MONITORING_REALTIME_MAX_CAPTURE_AGE_MS,
  operationalClockMs,
  isOperationalTimestampFuture,
  isOperationalTimestampStale,
} from '../../utils/operationalClock';
import { strictOperationalDateGuard } from '../../utils/strictOperationalDateGuard';
import { validateStrictRealtimeGeoCandidate } from './strictRealtimeGeoGuard.service';
import { confirmGeoCandidate } from './geoConfirmationWindow.service';
import { getOperationalFeatureFlag } from '../../config/operationalFeatureFlags';
import { appendGeoLegalAuditTrail } from './geoLegalAuditTrail.service';
import { opLog } from '../../utils/operationalLogger';

export type MonitoringGeoResolvedSource = 'live_employee_location' | 'current_operational_state' | 'time_record';
const BRAZIL_BOUNDS = { minLat: -34, maxLat: 6, minLng: -74, maxLng: -28 };

export type ResolveRealtimeMonitoringLocationInput = {
  nowMs?: number;
  employeeId: string;
  companyId?: string | null;
  live: LiveEmployeeLocationRow | null;
  cos: CurrentOperationalStateRow | null;
  record: {
    lat: number;
    lng: number;
    accuracy: number | null;
    capturedAt: string;
    provider: string | null;
    recordId: string;
  } | null;
  /** Para detecção de teleporte / drift urbano vs última posição aceita. */
  previousAccepted: { latitude: number; longitude: number; atMs: number } | null;
  log?: boolean;
};

export type ResolveRealtimeMonitoringLocationResult = {
  source: MonitoringGeoResolvedSource | null;
  latitude: number | null;
  longitude: number | null;
  accuracy: number | null;
  captured_at: string | null;
  freshness_ms: number;
  confidence: GeoConfidenceLevel;
  stale: boolean;
  invalid_reason: string | null;
  version: number;
  /** Para `markerVersionKey`: updated_at da fonte (live/COS) ou identificador estável do registro. */
  lineage_updated_at: string | null;
  source_record_id: string | null;
};

const DRIFT_MAX_M = 1000;
const DRIFT_WINDOW_MS = 30_000;

function captureInstantMs(capturedAt: string | null | undefined, nowMs: number): number | null {
  if (!capturedAt) return null;
  const n = normalizeOperationalDate(capturedAt, { quiet: true, source: 'monitoringGeoSourceResolver' });
  return n ? n.instantMs : null;
}

function reject(
  employeeId: string,
  source: MonitoringGeoResolvedSource | null,
  reason: string,
  version: number,
  freshness_ms: number,
  log: boolean,
): ResolveRealtimeMonitoringLocationResult {
  if (log) {
    console.info('[MONITORING GEO SOURCE REJECTED]', { employee_id: employeeId, source, reason });
  }
  return {
    source,
    latitude: null,
    longitude: null,
    accuracy: null,
    captured_at: null,
    freshness_ms,
    confidence: 'INVALID',
    stale: true,
    invalid_reason: reason,
    version,
    lineage_updated_at: null,
    source_record_id: null,
  };
}

function driftBlocks(
  employeeId: string,
  prev: { latitude: number; longitude: number; atMs: number } | null,
  lat: number,
  lng: number,
  atMs: number,
  log: boolean,
): boolean {
  if (!prev) return false;
  const deltaMs = atMs - prev.atMs;
  if (deltaMs <= 0 || deltaMs >= DRIFT_WINDOW_MS) return false;
  const meters = distanceMeters(
    { latitude: prev.latitude, longitude: prev.longitude },
    { latitude: lat, longitude: lng },
  );
  if (meters > DRIFT_MAX_M) {
    console.info('[GEO DRIFT DETECTED]', {
      employee_id: employeeId,
      meters,
      delta_ms: deltaMs,
    });
    console.info('[IMPOSSIBLE MOVEMENT BLOCKED]', {
      employee_id: employeeId,
      meters,
      delta_ms: deltaMs,
    });
    return true;
  }
  return false;
}

function insideOperationalBrazil(lat: number, lng: number): boolean {
  return lat >= BRAZIL_BOUNDS.minLat && lat <= BRAZIL_BOUNDS.maxLat && lng >= BRAZIL_BOUNDS.minLng && lng <= BRAZIL_BOUNDS.maxLng;
}

function temporalOk(
  employeeId: string,
  capturedAt: string,
  nowMs: number,
  source: MonitoringGeoResolvedSource,
  log: boolean,
): { ok: boolean; capMs: number; freshness: number } {
  const n = normalizeOperationalDate(capturedAt, { quiet: true, source: 'monitoringGeoTemporal' });
  if (!n) {
    console.info('[INVALID FUTURE GEO BLOCKED]', { employee_id: employeeId, source, reason: 'unparseable_timestamp' });
    return { ok: false, capMs: nowMs, freshness: 0 };
  }
  const capMs = n.instantMs;
  const freshness = nowMs - capMs;

  if (isOperationalTimestampFuture(capturedAt, nowMs, MONITORING_GEO_FUTURE_TOLERANCE_MS)) {
    console.info('[INVALID FUTURE GEO BLOCKED]', { employee_id: employeeId, source, captured_at: capturedAt });
    return { ok: false, capMs, freshness };
  }

  if (source !== 'time_record' && isOperationalTimestampStale(capturedAt, nowMs, MONITORING_REALTIME_MAX_CAPTURE_AGE_MS)) {
    opLog.diag('STALE GEO BLOCKED', { employee_id: employeeId, source, freshness_ms: freshness });
    return { ok: false, capMs, freshness };
  }

  return { ok: true, capMs, freshness };
}

function accept(
  companyId: string | null | undefined,
  employeeId: string,
  source: MonitoringGeoResolvedSource,
  lat: number,
  lng: number,
  accuracy: number | null,
  captured_at: string,
  freshness_ms: number,
  version: number,
  impossibleMovement: boolean,
  lineage_updated_at: string | null,
  source_record_id: string | null,
  log: boolean,
): ResolveRealtimeMonitoringLocationResult {
  const confidence = calculateGeoConfidence(
    {
      accuracyMeters: accuracy,
      ageMs: freshness_ms,
      provider: null,
      impossibleMovement,
    },
    { log: false },
  );

  const stale = freshness_ms > MONITORING_MARKER_STALE_HIDE_MS;

  if (log) {
    console.info('[MONITORING GEO SOURCE ACCEPTED]', {
      employee_id: employeeId,
      source,
      freshness_ms,
      stale,
      version,
    });
    console.info('[MONITORING GEO RESOLVE]', {
      employee_id: employeeId,
      source,
      latitude: lat,
      longitude: lng,
      accuracy,
      captured_at,
      freshness_ms,
      confidence,
      stale,
      invalid_reason: null,
      version,
      lineage_updated_at,
      source_record_id,
    });
  }
  appendGeoLegalAuditTrail({
    companyId,
    employeeId,
    source,
    nextPosition: { latitude: lat, longitude: lng },
    accuracy,
    operationalTimestamp: captured_at,
    consensusSource: source,
    lineage: lineage_updated_at,
  });

  return {
    source,
    latitude: lat,
    longitude: lng,
    accuracy,
    captured_at,
    freshness_ms,
    confidence,
    stale,
    invalid_reason: stale ? 'marker_stale_threshold' : null,
    version,
    lineage_updated_at,
    source_record_id,
  };
}

/**
 * Resolve uma única fonte GEO para o mapa de monitoramento (prioridade estrita, sem mistura).
 */
export function resolveRealtimeMonitoringLocation(
  input: ResolveRealtimeMonitoringLocationInput,
): ResolveRealtimeMonitoringLocationResult {
  const log = input.log !== false;
  const nowMs = input.nowMs ?? operationalClockMs();
  const version = input.cos ? Number(input.cos.state_version ?? 0) : 0;
  const employeeId = input.employeeId;

  const tryLive = (): ResolveRealtimeMonitoringLocationResult | null => {
    const live = input.live;
    if (!live || live.is_stale) {
      if (log && live?.is_stale) {
        console.info('[MONITORING GEO SOURCE REJECTED]', { employee_id: employeeId, source: 'live_employee_location', reason: 'flag_stale' });
      }
      return null;
    }
    const lat = Number(live.latitude);
    const lng = Number(live.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return null;
    }
    if (validateCoordinateOrder(lat, lng).includes('invalid_range')) {
      return null;
    }
    const acc = live.accuracy;
    if (acc != null && Number.isFinite(acc) && acc > GEO_ACCURACY_BLOCK_MARKER_M) {
      if (log) console.info('[MONITORING GEO SOURCE REJECTED]', { employee_id: employeeId, source: 'live_employee_location', reason: 'accuracy' });
      return null;
    }

    const t = temporalOk(employeeId, live.captured_at, nowMs, 'live_employee_location', log);
    if (!t.ok) return null;
    const strictDate = strictOperationalDateGuard(live.captured_at, nowMs);
    if (!strictDate.ok) return reject(employeeId, 'live_employee_location', `strict_date_${strictDate.reason}`, version, t.freshness, log);
    if (!insideOperationalBrazil(lat, lng)) return reject(employeeId, 'live_employee_location', 'outside_operational_brazil_bounds', version, t.freshness, log);

    const capMs = t.capMs;
    if (driftBlocks(employeeId, input.previousAccepted, lat, lng, capMs, log)) {
      return null;
    }
    const strict = validateStrictRealtimeGeoCandidate({
      companyId: input.companyId,
      employeeId,
      source: 'live_employee_location',
      latitude: lat,
      longitude: lng,
      capturedAtMs: capMs,
      capturedAtIso: live.captured_at,
      accuracy: live.accuracy ?? null,
      speedMps: Number((live as unknown as { speed_mps?: number | null }).speed_mps ?? NaN),
      stateVersion: version,
      checksum: (live as unknown as { geo_snapshot_checksum?: string | null }).geo_snapshot_checksum ?? null,
      lineageUpdatedAt: live.updated_at ?? null,
    });
    if (!strict.ok) return reject(employeeId, 'live_employee_location', strict.reason ?? 'strict_guard_block', version, t.freshness, log);
    if (getOperationalFeatureFlag('geoConsensus', { companyId: input.companyId })) {
      const c = confirmGeoCandidate(employeeId, {
        latitude: lat,
        longitude: lng,
        accuracy: live.accuracy ?? null,
        capturedAtMs: capMs,
      });
      if (!c.accepted) return reject(employeeId, 'live_employee_location', c.reason, version, t.freshness, log);
    }

    if (log) console.info('[MONITORING GEO RESOLVE]', { employee_id: employeeId, phase: 'live_candidate' });
    return accept(
      input.companyId,
      employeeId,
      'live_employee_location',
      lat,
      lng,
      live.accuracy,
      live.captured_at,
      t.freshness,
      version,
      false,
      live.updated_at ?? null,
      `live:${live.updated_at ?? live.captured_at}`,
      log,
    );
  };

  const tryCos = (): ResolveRealtimeMonitoringLocationResult | null => {
    const cos = input.cos;
    if (!cos || cos.map_latitude == null || cos.map_longitude == null) return null;
    const lat = Number(cos.map_latitude);
    const lng = Number(cos.map_longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    if (validateCoordinateOrder(lat, lng).includes('invalid_range')) return null;
    const acc = cos.map_accuracy;
    if (acc != null && Number.isFinite(acc) && acc > GEO_ACCURACY_BLOCK_MARKER_M) {
      if (log) console.info('[MONITORING GEO SOURCE REJECTED]', { employee_id: employeeId, source: 'current_operational_state', reason: 'accuracy' });
      return null;
    }

    const capIso = cos.map_captured_at ?? cos.last_punch_at;
    if (!capIso) return null;

    const t = temporalOk(employeeId, capIso, nowMs, 'current_operational_state', log);
    if (!t.ok) return null;
    const strictDate = strictOperationalDateGuard(capIso, nowMs);
    if (!strictDate.ok) return reject(employeeId, 'current_operational_state', `strict_date_${strictDate.reason}`, version, t.freshness, log);
    if (!insideOperationalBrazil(lat, lng)) return reject(employeeId, 'current_operational_state', 'outside_operational_brazil_bounds', version, t.freshness, log);

    if (driftBlocks(employeeId, input.previousAccepted, lat, lng, t.capMs, log)) {
      return null;
    }
    const strict = validateStrictRealtimeGeoCandidate({
      companyId: input.companyId,
      employeeId,
      source: 'current_operational_state',
      latitude: lat,
      longitude: lng,
      capturedAtMs: t.capMs,
      capturedAtIso: capIso,
      accuracy: cos.map_accuracy ?? null,
      stateVersion: Number(cos.state_version ?? 0),
      checksum: (cos as unknown as { geo_snapshot_checksum?: string | null }).geo_snapshot_checksum ?? null,
      lineageUpdatedAt: cos.updated_at ?? null,
    });
    if (!strict.ok) return reject(employeeId, 'current_operational_state', strict.reason ?? 'strict_guard_block', version, t.freshness, log);
    if (getOperationalFeatureFlag('geoConsensus', { companyId: input.companyId })) {
      const c = confirmGeoCandidate(employeeId, {
        latitude: lat,
        longitude: lng,
        accuracy: cos.map_accuracy ?? null,
        capturedAtMs: t.capMs,
      });
      if (!c.accepted) return reject(employeeId, 'current_operational_state', c.reason, version, t.freshness, log);
    }

    if (log) console.info('[MONITORING GEO RESOLVE]', { employee_id: employeeId, phase: 'cos_candidate' });
    return accept(
      input.companyId,
      employeeId,
      'current_operational_state',
      lat,
      lng,
      cos.map_accuracy,
      capIso,
      t.freshness,
      Number(cos.state_version ?? 0),
      false,
      cos.updated_at ?? null,
      cos.last_punch_record_id ?? null,
      log,
    );
  };

  const tryRecord = (): ResolveRealtimeMonitoringLocationResult | null => {
    const rec = input.record;
    if (!rec) return null;
    const lat = rec.lat;
    const lng = rec.lng;
    if (validateCoordinateOrder(lat, lng).includes('invalid_range')) return null;
    const acc = rec.accuracy;
    if (acc != null && Number.isFinite(acc) && acc > GEO_ACCURACY_BLOCK_MARKER_M) {
      if (log) console.info('[MONITORING GEO SOURCE REJECTED]', { employee_id: employeeId, source: 'time_record', reason: 'accuracy' });
      return null;
    }

    const n = normalizeOperationalDate(rec.capturedAt, { quiet: true, source: 'monitoringGeoRecord' });
    if (!n) return null;
    const strictDate = strictOperationalDateGuard(rec.capturedAt, nowMs);
    if (!strictDate.ok) return reject(employeeId, 'time_record', `strict_date_${strictDate.reason}`, version, 0, log);
    if (isOperationalTimestampFuture(rec.capturedAt, nowMs, MONITORING_GEO_FUTURE_TOLERANCE_MS)) {
      console.info('[INVALID FUTURE GEO BLOCKED]', { employee_id: employeeId, source: 'time_record' });
      return null;
    }
    const freshness = nowMs - n.instantMs;
    if (driftBlocks(employeeId, input.previousAccepted, lat, lng, n.instantMs, log)) {
      return null;
    }
    if (!insideOperationalBrazil(lat, lng)) return reject(employeeId, 'time_record', 'outside_operational_brazil_bounds', version, freshness, log);
    const strict = validateStrictRealtimeGeoCandidate({
      companyId: input.companyId,
      employeeId,
      source: 'time_record',
      latitude: lat,
      longitude: lng,
      capturedAtMs: n.instantMs,
      capturedAtIso: rec.capturedAt,
      accuracy: rec.accuracy ?? null,
      stateVersion: version,
      checksum: null,
      lineageUpdatedAt: `time_record:${rec.recordId}`,
    });
    if (!strict.ok) return reject(employeeId, 'time_record', strict.reason ?? 'strict_guard_block', version, freshness, log);
    if (getOperationalFeatureFlag('geoConsensus', { companyId: input.companyId })) {
      const c = confirmGeoCandidate(employeeId, {
        latitude: lat,
        longitude: lng,
        accuracy: rec.accuracy ?? null,
        capturedAtMs: n.instantMs,
      });
      if (!c.accepted) return reject(employeeId, 'time_record', c.reason, version, freshness, log);
    }

    if (log) console.info('[MONITORING GEO RESOLVE]', { employee_id: employeeId, phase: 'time_record_candidate' });
    return accept(
      input.companyId,
      employeeId,
      'time_record',
      lat,
      lng,
      rec.accuracy,
      rec.capturedAt,
      freshness,
      version,
      false,
      `time_record:${rec.recordId}`,
      rec.recordId,
      log,
    );
  };

  const liveRes = tryLive();
  if (liveRes && liveRes.latitude != null && !liveRes.stale) {
    if (!liveRes.lineage_updated_at || !liveRes.source_record_id) return reject(employeeId, 'live_employee_location', 'missing_source_or_lineage', version, liveRes.freshness_ms, log);
    return liveRes;
  }
  if (liveRes && liveRes.latitude != null && liveRes.stale) {
    if (log) console.info('[STALE MARKER HIDDEN]', { employee_id: employeeId, source: 'live_employee_location', freshness_ms: liveRes.freshness_ms });
  }

  const cosRes = tryCos();
  if (cosRes && cosRes.latitude != null && !cosRes.stale) {
    if (!cosRes.lineage_updated_at || !cosRes.source_record_id) return reject(employeeId, 'current_operational_state', 'missing_source_or_lineage', version, cosRes.freshness_ms, log);
    return cosRes;
  }
  if (cosRes && cosRes.latitude != null && cosRes.stale) {
    if (log) console.info('[STALE MARKER HIDDEN]', { employee_id: employeeId, source: 'current_operational_state', freshness_ms: cosRes.freshness_ms });
  }

  const recRes = tryRecord();
  if (recRes && recRes.latitude != null && !recRes.stale) {
    if (!recRes.lineage_updated_at || !recRes.source_record_id) return reject(employeeId, 'time_record', 'missing_source_or_lineage', version, recRes.freshness_ms, log);
    return recRes;
  }
  if (recRes && recRes.latitude != null && recRes.stale) {
    if (log) console.info('[STALE MARKER HIDDEN]', { employee_id: employeeId, source: 'time_record', freshness_ms: recRes.freshness_ms });
  }

  if (log) {
    console.info('[MONITORING GEO SOURCE REJECTED]', { employee_id: employeeId, source: null, reason: 'no_valid_source' });
  }
  return {
    source: null,
    latitude: null,
    longitude: null,
    accuracy: null,
    captured_at: null,
    freshness_ms: 0,
    confidence: 'INVALID',
    stale: true,
    invalid_reason: 'no_valid_source',
    version,
    lineage_updated_at: null,
    source_record_id: null,
  };
}
