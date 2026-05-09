/**
 * Resolver único para telas operacionais: status + GEO alinhados (COS, live, último registro).
 */

import type { LiveEmployeeLocationRow } from '../../services/liveEmployeeLocation.service';
import {
  buildMonitoringPipelineRow,
  filterRecordsForOperationalDay,
  getLastOperationalPunchForUser,
  inferOperationalPresenceForDay,
  readGeoSnapshot,
  validateOperationalTimestamp,
  type MonitoringPipelineEmployeeRow,
  type OperationalPunchRecord,
} from '../../services/monitoring/monitoringGeoHardLock.service';
import {
  buildPresenceListFromOperationalState,
  emptyMonitoringPipelineRowForUser,
  operationalStateRowToMonitoringPipelineRow,
  type CurrentOperationalStateRow,
  type EmployeePresenceFromState,
} from '../../services/currentOperationalState.service';
import { resolveBestRealtimeLocation, type ResolvedRealtimeLocation } from '../../services/geolocation/realtimeGeoSourcePriority.service';
import { assertOperationalStateConsistency } from './assertOperationalStateConsistency';

export type UnifiedOperationalResolverInput = {
  companyId: string;
  users: Array<{ id: string; nome?: string; email?: string }>;
  cosRows: CurrentOperationalStateRow[];
  timeRecords: OperationalPunchRecord[];
  liveByEmployee: Map<string, LiveEmployeeLocationRow>;
  todayYmd: string;
  nowMs: number;
};

export type UnifiedOperationalResolverResult = {
  usingOperationalStateTable: boolean;
  pipelineRows: MonitoringPipelineEmployeeRow[];
  presenceList: EmployeePresenceFromState[];
};

function recordGeoCandidate(
  last: OperationalPunchRecord | null,
): {
  lat: number;
  lng: number;
  accuracy: number | null;
  capturedAt: string;
  provider: string | null;
  recordId: string;
} | null {
  if (!last) return null;
  const geo = readGeoSnapshot(last);
  if (!geo) return null;
  return {
    lat: geo.lat,
    lng: geo.lng,
    accuracy: geo.accuracy,
    capturedAt: geo.capturedAt,
    provider: geo.provider,
    recordId: last.id,
  };
}

function cosPreviousAccepted(
  cos: CurrentOperationalStateRow | null | undefined,
  nowMs: number,
): { latitude: number; longitude: number; atMs: number } | null {
  if (!cos?.map_captured_at || cos.map_latitude == null || cos.map_longitude == null) return null;
  const v = validateOperationalTimestamp(cos.map_captured_at, nowMs);
  const atMs = v.ok ? v.instantMs : nowMs;
  return {
    latitude: Number(cos.map_latitude),
    longitude: Number(cos.map_longitude),
    atMs,
  };
}

function applyResolvedGeo(
  row: MonitoringPipelineEmployeeRow,
  resolved: ResolvedRealtimeLocation | null,
  nowMs: number,
): MonitoringPipelineEmployeeRow {
  if (!resolved) return row;
  if (resolved.geoConfidence === 'INVALID') {
    return {
      ...row,
      geoConfidenceLevel: 'INVALID',
      lat: undefined,
      lng: undefined,
      accuracy: null,
    };
  }
  const mapMarkerKey = [
    resolved.source,
    resolved.sourceRecordId ?? row.sourceRecordId ?? '',
    resolved.capturedAt,
    resolved.latitude,
    resolved.longitude,
    row.stateVersion ?? '',
  ].join(':');

  return {
    ...row,
    lat: resolved.latitude,
    lng: resolved.longitude,
    accuracy: resolved.accuracy,
    capturedAt: resolved.capturedAt,
    sourceRecordId: resolved.sourceRecordId ?? row.sourceRecordId,
    geoConfidenceLevel: resolved.geoConfidence,
    geoSourceLabel: resolved.source === 'live_employee_location' ? 'Realtime' : row.geoSourceLabel,
    positionAgeMs: resolved.ageMs,
    mapMarkerKey,
    mapRenderTimestamp: nowMs,
    geoSpeedMps: resolved.speedMps ?? null,
    geoHeadingDeg: resolved.headingDeg ?? null,
    geoBearingDeg: resolved.bearingDeg ?? null,
    geoIsMocked: resolved.isMocked ?? false,
    geoGpsAgeMs: resolved.gpsAgeMs ?? resolved.ageMs,
  };
}

/**
 * Todas as telas de monitoramento / cards devem usar este resultado para data civil, status e GEO coerentes.
 */
export function resolveUnifiedOperationalState(input: UnifiedOperationalResolverInput): UnifiedOperationalResolverResult {
  const { users, cosRows, timeRecords, liveByEmployee, todayYmd, nowMs, companyId } = input;
  const usingOperationalStateTable = cosRows.length > 0;
  const cosByEmployee = new Map(cosRows.map((r) => [r.employee_id, r]));

  let pipelineRows: MonitoringPipelineEmployeeRow[];

  if (usingOperationalStateTable) {
    pipelineRows = users.map((u) => {
      const cos = cosByEmployee.get(u.id);
      const base = cos ? operationalStateRowToMonitoringPipelineRow(cos, u, nowMs) : emptyMonitoringPipelineRowForUser(u, nowMs);
      const live = liveByEmployee.get(u.id) ?? null;
      const last = getLastOperationalPunchForUser(timeRecords, u.id);
      const record = recordGeoCandidate(last);
      const resolved = resolveBestRealtimeLocation({
        nowMs,
        employeeId: u.id,
        companyId,
        live,
        cos: cos ?? null,
        record,
        previousAccepted: cosPreviousAccepted(cos, nowMs),
        log: false,
      });
      return applyResolvedGeo(base, resolved, nowMs);
    });
  } else {
    pipelineRows = users.map((u) => {
      const base = buildMonitoringPipelineRow(u, timeRecords, nowMs);
      const live = liveByEmployee.get(u.id) ?? null;
      const last = getLastOperationalPunchForUser(timeRecords, u.id);
      const record = recordGeoCandidate(last);
      const resolved = resolveBestRealtimeLocation({
        nowMs,
        employeeId: u.id,
        companyId,
        live,
        cos: null,
        record,
        previousAccepted: null,
        log: false,
      });
      return applyResolvedGeo(base, resolved, nowMs);
    });
  }

  let presenceList: EmployeePresenceFromState[];
  if (usingOperationalStateTable) {
    presenceList = buildPresenceListFromOperationalState(users, cosByEmployee, todayYmd);
  } else {
    const todayOperationalRecords = filterRecordsForOperationalDay(timeRecords, todayYmd);
    presenceList = users
      .map((u) => {
        const recs = todayOperationalRecords.filter((r) => r.user_id === u.id);
        const { status, lastPunch, lastType, pairCount } = inferOperationalPresenceForDay(recs);
        return {
          user_id: u.id,
          nome: u.nome || u.email || u.id.slice(0, 8),
          email: u.email,
          status,
          lastPunch,
          lastType,
          pairCount,
        };
      })
      .sort((a, b) => a.nome.localeCompare(b.nome));
  }

  assertOperationalStateConsistency({
    companyId,
    usingCos: usingOperationalStateTable,
    cosByEmployee,
    pipelineRows,
  });

  return {
    usingOperationalStateTable,
    pipelineRows,
    presenceList,
  };
}
