import { observabilityConsole } from '../../shared/logger/observabilityConsole';
/**
 * Prioridade de fonte para GEO em tempo real: live_employee_location > current_operational_state > time_record.
 *
 * @deprecated Produção deve usar apenas {@link resolveRealtimeMonitoringLocation} (`monitoringGeoSourceResolver.ts`).
 * Mantido para compatibilidade temporária; remoção após migração completa dos chamadores.
 */

import { DateTime } from 'luxon';
import type { LiveEmployeeLocationRow } from '../liveEmployeeLocation.service';
import type { CurrentOperationalStateRow } from '../currentOperationalState.service';
import { validateOperationalTimestamp } from '../monitoring/monitoringGeoHardLock.service';
import {
  evaluateRealtimeGpsReliability,
  isRealtimeGpsMockSuspected,
  type RealtimeGpsReliabilityLevel,
} from './realtimeGeoReliability.service';
import { calculateGeoConfidence, type GeoConfidenceLevel } from './geoConfidence.service';

export type RealtimeGeoSourceKind = 'live_employee_location' | 'current_operational_state' | 'time_record';

export type ResolvedRealtimeLocation = {
  source: RealtimeGeoSourceKind;
  latitude: number;
  longitude: number;
  accuracy: number | null;
  capturedAt: string;
  provider: string | null;
  reliability: RealtimeGpsReliabilityLevel;
  geoConfidence: GeoConfidenceLevel;
  ageMs: number;
  sourceRecordId?: string | null;
  speedMps?: number | null;
  headingDeg?: number | null;
  bearingDeg?: number | null;
  isMocked?: boolean;
  gpsAgeMs?: number;
};

type Candidate = {
  source: RealtimeGeoSourceKind;
  lat: number;
  lng: number;
  accuracy: number | null;
  capturedAt: string;
  provider: string | null;
  ageMs: number;
  priority: number;
  confidenceRank: number;
  sourceRecordId?: string | null;
};

const SOURCE_PRIORITY: Record<RealtimeGeoSourceKind, number> = {
  live_employee_location: 0,
  current_operational_state: 1,
  time_record: 2,
};

function confidenceRank(conf: string | null | undefined): number {
  const c = String(conf ?? '').toUpperCase();
  if (c === 'HIGH') return 3;
  if (c === 'MEDIUM') return 2;
  if (c === 'LOW') return 1;
  return 0;
}

export type ResolveBestRealtimeLocationInput = {
  nowMs: number;
  employeeId: string;
  companyId?: string | null;
  live: LiveEmployeeLocationRow | null;
  cos: CurrentOperationalStateRow | null;
  /** Geo do último time_record válido (já extraído). */
  record: {
    lat: number;
    lng: number;
    accuracy: number | null;
    capturedAt: string;
    provider: string | null;
    recordId: string;
  } | null;
  previousAccepted: { latitude: number; longitude: number; atMs: number } | null;
  speedMps?: number | null;
  log?: boolean;
};

/**
 * Escolhe a melhor posição: menor idade, melhor accuracy, maior confiança, prioridade de fonte.
 * @deprecated Ver `resolveRealtimeMonitoringLocation`.
 */
export function resolveBestRealtimeLocation(input: ResolveBestRealtimeLocationInput): ResolvedRealtimeLocation | null {
  if (typeof console !== 'undefined') {
    observabilityConsole.warn('[LEGACY GEO RESOLVER DETECTED]', {
      employee_id: input.employeeId,
      resolver: 'resolveBestRealtimeLocation',
    });
  }
  const log = input.log !== false;
  const candidates: Candidate[] = [];

  const pushIfValid = (
    c: Omit<Candidate, 'priority' | 'confidenceRank'> & { priority: number; confidenceRank: number },
    speedMpsOverride?: number | null,
  ) => {
    const rel = evaluateRealtimeGpsReliability({
      latitude: c.lat,
      longitude: c.lng,
      accuracyMeters: c.accuracy,
      coordinateAgeMs: c.ageMs,
      speedMps: speedMpsOverride ?? input.speedMps ?? null,
      provider: c.provider,
      previous: input.previousAccepted,
      nowMs: input.nowMs,
      employeeId: input.employeeId,
      companyId: input.companyId ?? null,
      silent: true,
      log: false,
    });
    if (!rel.accepted) return;
    candidates.push({ ...c, confidenceRank: c.confidenceRank });
  };

  if (input.live && !input.live.is_stale) {
    const cap = validateOperationalTimestamp(input.live.captured_at, input.nowMs);
    const capMs = cap.ok ? cap.instantMs : input.nowMs;
    const ageMs = input.nowMs - capMs;
    pushIfValid(
      {
        source: 'live_employee_location',
        lat: Number(input.live.latitude),
        lng: Number(input.live.longitude),
        accuracy: input.live.accuracy,
        capturedAt: input.live.captured_at,
        provider: input.live.provider,
        ageMs: Math.max(0, ageMs),
        priority: SOURCE_PRIORITY.live_employee_location,
        confidenceRank: confidenceRank(input.live.confidence),
      },
      input.live.speed,
    );
  }

  if (
    input.cos &&
    input.cos.map_latitude != null &&
    input.cos.map_longitude != null &&
    Number.isFinite(Number(input.cos.map_latitude)) &&
    Number.isFinite(Number(input.cos.map_longitude))
  ) {
    const capIso = input.cos.map_captured_at ?? input.cos.last_punch_at;
    const cap = capIso ? validateOperationalTimestamp(capIso, input.nowMs) : { ok: false as const, code: 'invalid_parse' as const };
    const capMs = cap.ok ? cap.instantMs : input.nowMs;
    const ageMs = input.nowMs - capMs;
    pushIfValid({
      source: 'current_operational_state',
      lat: Number(input.cos.map_latitude),
      lng: Number(input.cos.map_longitude),
      accuracy: input.cos.map_accuracy,
      capturedAt: capIso ?? DateTime.fromMillis(capMs, { zone: 'utc' }).toUTC().toISO() ?? '',
      provider: input.cos.geo_provider,
      ageMs: Math.max(0, ageMs),
      priority: SOURCE_PRIORITY.current_operational_state,
      confidenceRank: confidenceRank(input.cos.location_confidence),
    });
  }

  if (input.record) {
    const cap = validateOperationalTimestamp(input.record.capturedAt, input.nowMs);
    const capMs = cap.ok ? cap.instantMs : input.nowMs;
    const ageMs = input.nowMs - capMs;
    pushIfValid({
      source: 'time_record',
      lat: input.record.lat,
      lng: input.record.lng,
      accuracy: input.record.accuracy,
      capturedAt: input.record.capturedAt,
      provider: input.record.provider,
      ageMs: Math.max(0, ageMs),
      priority: SOURCE_PRIORITY.time_record,
      confidenceRank: 1,
      sourceRecordId: input.record.recordId,
    });
  }

  if (candidates.length === 0) {
    if (log) observabilityConsole.info('[GEO SOURCE PRIORITY]', { employee_id: input.employeeId, selected: null });
    return null;
  }

  candidates.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    if (a.ageMs !== b.ageMs) return a.ageMs - b.ageMs;
    const accA = a.accuracy ?? 9999;
    const accB = b.accuracy ?? 9999;
    if (accA !== accB) return accA - accB;
    return b.confidenceRank - a.confidenceRank;
  });

  const best = candidates[0]!;
  if (log) {
    observabilityConsole.info('[GEO SOURCE PRIORITY]', {
      employee_id: input.employeeId,
      candidates: candidates.length,
      order: candidates.map((c) => c.source),
    });
    observabilityConsole.info('[GEO SOURCE SELECTED]', {
      employee_id: input.employeeId,
      source: best.source,
      age_ms: best.ageMs,
      accuracy: best.accuracy,
    });
  }

  const reliability = evaluateRealtimeGpsReliability({
    latitude: best.lat,
    longitude: best.lng,
    accuracyMeters: best.accuracy,
    coordinateAgeMs: best.ageMs,
    speedMps: best.source === 'live_employee_location' && input.live ? input.live.speed : input.speedMps,
    provider: best.provider,
    previous: input.previousAccepted,
    nowMs: input.nowMs,
    employeeId: input.employeeId,
    companyId: input.companyId ?? null,
    log: log,
  });

  const geoConfidence = calculateGeoConfidence(
    {
      accuracyMeters: best.accuracy,
      ageMs: best.ageMs,
      provider: best.provider,
      speedMps: input.speedMps ?? null,
      impossibleMovement: !reliability.accepted,
    },
    { log: false },
  );

  const live = input.live;
  const headingDeg =
    best.source === 'live_employee_location' && live?.heading != null && Number.isFinite(Number(live.heading))
      ? Number(live.heading)
      : null;
  const speedMps =
    best.source === 'live_employee_location' && live && live.speed != null ? Number(live.speed) : input.speedMps ?? null;

  return {
    source: best.source,
    latitude: best.lat,
    longitude: best.lng,
    accuracy: best.accuracy,
    capturedAt: best.capturedAt,
    provider: best.provider,
    reliability: reliability.level,
    geoConfidence,
    ageMs: best.ageMs,
    sourceRecordId: best.sourceRecordId ?? null,
    speedMps: Number.isFinite(speedMps as number) ? speedMps : null,
    headingDeg,
    bearingDeg: headingDeg,
    isMocked: isRealtimeGpsMockSuspected(best.provider, best.accuracy),
    gpsAgeMs: best.ageMs,
  };
}
