import { observabilityConsole } from '../../shared/logger/observabilityConsole';
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
import {
  resolveRealtimeMonitoringLocation,
  type ResolveRealtimeMonitoringLocationResult,
} from '../../services/geolocation/monitoringGeoSourceResolver';
import { assertOperationalStateConsistency } from './assertOperationalStateConsistency';
import { auditRealtimeGeoConsistency } from './auditRealtimeGeoConsistency';
import { getLastOperationalPunchForRoster, rosterIdSet } from '../../services/monitoring/monitoringRoster.service';

export type UnifiedOperationalResolverInput = {
  companyId: string;
  users: Array<{ id: string; nome?: string; email?: string }>;
  cosRows: CurrentOperationalStateRow[];
  timeRecords: OperationalPunchRecord[];
  liveByEmployee: Map<string, LiveEmployeeLocationRow>;
  todayYmd: string;
  nowMs: number;
  /** IDs alternativos por colaborador (ex.: user.id vinculado por e-mail). */
  rosterIdAliases?: Map<string, string[]>;
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

function geoLabelForMonitoringSource(
  source: ResolveRealtimeMonitoringLocationResult['source'],
  row: MonitoringPipelineEmployeeRow,
): MonitoringPipelineEmployeeRow['geoSourceLabel'] {
  if (source === 'live_employee_location') return 'Realtime';
  if (source === 'current_operational_state') return row.geoSourceLabel;
  if (source === 'time_record') return 'Cache';
  return row.geoSourceLabel;
}

function applyResolvedGeo(
  row: MonitoringPipelineEmployeeRow,
  resolved: ResolveRealtimeMonitoringLocationResult,
  nowMs: number,
  live: LiveEmployeeLocationRow | null,
): MonitoringPipelineEmployeeRow {
  if (!resolved.source || resolved.latitude == null || resolved.longitude == null) {
    return {
      ...row,
      lat: undefined,
      lng: undefined,
      accuracy: null,
      capturedAt: undefined,
      geoConfidenceLevel: 'INVALID',
      geoLocationExpired: false,
      mapRenderTimestamp: nowMs,
    };
  }

  if (resolved.stale || resolved.confidence === 'INVALID') {
    observabilityConsole.info('[MAP MARKER HARD REFRESH]', {
      employee_id: row.userId,
      reason: resolved.stale ? 'stale_threshold' : 'invalid_confidence',
      freshness_ms: resolved.freshness_ms,
    });
    return {
      ...row,
      lat: undefined,
      lng: undefined,
      accuracy: null,
      capturedAt: undefined,
      geoConfidenceLevel: 'INVALID',
      geoLocationExpired: true,
      positionAgeMs: resolved.freshness_ms,
      mapRenderTimestamp: nowMs,
    };
  }

  const mapMarkerKey = [row.userId, resolved.captured_at, String(resolved.version), resolved.lineage_updated_at ?? ''].join('|');
  observabilityConsole.info('[MAP MARKER VERSION CHANGE]', { employee_id: row.userId, map_marker_version_key: mapMarkerKey });

  return {
    ...row,
    lat: resolved.latitude,
    lng: resolved.longitude,
    accuracy: resolved.accuracy,
    capturedAt: resolved.captured_at ?? undefined,
    sourceRecordId: resolved.source_record_id ?? row.sourceRecordId,
    geoConfidenceLevel: resolved.confidence,
    geoSourceLabel: geoLabelForMonitoringSource(resolved.source, row),
    positionAgeMs: resolved.freshness_ms,
    mapMarkerKey,
    mapRenderTimestamp: nowMs,
    geoLocationExpired: false,
    geoSpeedMps: live?.speed != null && Number.isFinite(Number(live.speed)) ? Number(live.speed) : row.geoSpeedMps ?? null,
    geoHeadingDeg:
      live?.heading != null && Number.isFinite(Number(live.heading)) ? Number(live.heading) : row.geoHeadingDeg ?? null,
    geoBearingDeg:
      live?.heading != null && Number.isFinite(Number(live.heading)) ? Number(live.heading) : row.geoBearingDeg ?? null,
    geoIsMocked: row.geoIsMocked,
    geoGpsAgeMs: resolved.freshness_ms,
  };
}

function cosForRoster(
  rosterId: string,
  cosByEmployee: Map<string, CurrentOperationalStateRow>,
  rosterIdAliases?: Map<string, string[]>,
): CurrentOperationalStateRow | undefined {
  for (const id of rosterIdSet(rosterId, rosterIdAliases)) {
    const row = cosByEmployee.get(id);
    if (row) return row;
  }
  return undefined;
}

/**
 * Todas as telas de monitoramento / cards devem usar este resultado para data civil, status e GEO coerentes.
 */
export function resolveUnifiedOperationalState(input: UnifiedOperationalResolverInput): UnifiedOperationalResolverResult {
  const { users, cosRows, timeRecords, liveByEmployee, todayYmd, nowMs, companyId, rosterIdAliases } = input;
  const usingOperationalStateTable = cosRows.length > 0;
  const cosByEmployee = new Map(cosRows.map((r) => [r.employee_id, r]));
  const matchIds = (rosterId: string) => Array.from(rosterIdSet(rosterId, rosterIdAliases));

  let pipelineRows: MonitoringPipelineEmployeeRow[];

  if (usingOperationalStateTable) {
    pipelineRows = users.map((u) => {
      const cos = cosForRoster(u.id, cosByEmployee, rosterIdAliases);
      const base = cos ? operationalStateRowToMonitoringPipelineRow(cos, u, nowMs) : emptyMonitoringPipelineRowForUser(u, nowMs);
      const live = liveByEmployee.get(u.id) ?? null;
      const last = getLastOperationalPunchForRoster(timeRecords, u.id, rosterIdAliases, nowMs);
      const record = recordGeoCandidate(last);
      const resolved = resolveRealtimeMonitoringLocation({
        nowMs,
        employeeId: u.id,
        companyId,
        live,
        cos: cos ?? null,
        record,
        previousAccepted: cosPreviousAccepted(cos, nowMs),
        log: false,
      });
      return applyResolvedGeo(base, resolved, nowMs, live);
    });
  } else {
    pipelineRows = users.map((u) => {
      const base = buildMonitoringPipelineRow(u, timeRecords, nowMs, matchIds(u.id));
      const live = liveByEmployee.get(u.id) ?? null;
      const last = getLastOperationalPunchForRoster(timeRecords, u.id, rosterIdAliases, nowMs);
      const record = recordGeoCandidate(last);
      const resolved = resolveRealtimeMonitoringLocation({
        nowMs,
        employeeId: u.id,
        companyId,
        live,
        cos: null,
        record,
        previousAccepted: null,
        log: false,
      });
      return applyResolvedGeo(base, resolved, nowMs, live);
    });
  }

  let presenceList: EmployeePresenceFromState[];
  if (usingOperationalStateTable) {
    presenceList = buildPresenceListFromOperationalState(users, cosByEmployee, todayYmd, rosterIdAliases);
  } else {
    const todayOperationalRecords = filterRecordsForOperationalDay(timeRecords, todayYmd);
    presenceList = users
      .map((u) => {
        const recs = todayOperationalRecords.filter((r) => rosterIdSet(u.id, rosterIdAliases).has(r.user_id));
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

  auditRealtimeGeoConsistency({
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
