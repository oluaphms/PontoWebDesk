import { observabilityConsole } from '../../shared/logger/observabilityConsole';
/**
 * Hard lock GEO + monitoramento: timestamps operacionais, última batida válida,
 * GEO realtime (precisão, idade), timezone America/Sao_Paulo (Luxon).
 */

import { DateTime } from 'luxon';
import { extractLatLng } from '../../utils/reverseGeocode';
import { recordPunchInstantIso, recordPunchInstantMs, resolvePunchOrigin } from '../../utils/punchOrigin';
import {
  buildOperationalDayRange,
  getOperationalTodayYmd,
  isFutureOperationalTimestamp,
  logFutureOperationalDateBlocked,
  normalizeOperationalDate,
  OPERATIONAL_FUTURE_TOLERANCE_MS,
  OPERATIONAL_TIMEZONE,
} from '../../utils/operationalDateHardLock';
import { operationalClockMs } from '../../utils/operationalClock';
import { validateCoordinateOrder } from '../geolocation/geoIntegrity.service';
import { calculateGeoConfidence, type GeoConfidenceLevel } from '../geolocation/geoConfidence.service';
import { detectAndHandleGhostLocation } from '../geolocation/ghostLocationDetector.service';
import { recordOperationalMetric } from '../../domain/operational/metrics/operationalMetrics';
import { opLog } from '../../utils/operationalLogger';
import {
  EmployeeOperationalStatus,
  MONITORING_OFFLINE_AFTER_LAST_PUNCH_MS,
  computeRealtimeOperationalStatusFromTypeAndAge,
  normalizePunchType,
  operationalStatusLabel,
} from '../../types/employeeOperationalStatus';

export const COMPANY_OPERATIONAL_TIMEZONE = OPERATIONAL_TIMEZONE;

/** Batidas além deste horizonte no futuro são inválidas para monitoramento e insert. */
export const FUTURE_PUNCH_TOLERANCE_MS = OPERATIONAL_FUTURE_TOLERANCE_MS;

/** Posição GPS com idade maior que isso não entra no mapa realtime. */
export const REALTIME_GEO_MAX_AGE_MS = 2 * 60 * 1000;

export const GEO_ACCURACY_APPROXIMATE_M = 100;
/** Precisão acima disso não entra no mapa de monitoramento (hard lock). */
export const GEO_ACCURACY_BLOCK_MARKER_M = 300;

export type OperationalTimestampResult =
  | { ok: true; instantMs: number; utcIso: string }
  | { ok: false; code: 'invalid_parse' | 'future'; diffMs?: number; raw?: string };

/**
 * Dedup das emissões de [FUTURE DATE BLOCKED] + métrica `future_operational_timestamp_blocked`.
 * Quando um único registro com timestamp futuro chega no DB, o resolver de monitoramento o vê
 * dezenas de vezes por refresh (filtros em getLastOperationalPunchForUser, listOperationalPunchesForUserSorted, etc.).
 * Sem dedup, isso inflama console e a fila `METRIC_STORE` operacional.
 */
const FUTURE_BLOCK_LOG_DEDUP_MS = 60_000;
const FUTURE_BLOCK_LOG_MAX_ENTRIES = 500;
const recentFutureBlocks = new Map<string, number>();

function shouldEmitFutureBlock(raw: string): boolean {
  const wall = Date.now();
  const last = recentFutureBlocks.get(raw);
  if (last != null && wall - last < FUTURE_BLOCK_LOG_DEDUP_MS) return false;
  if (recentFutureBlocks.size >= FUTURE_BLOCK_LOG_MAX_ENTRIES) {
    const cutoff = wall - FUTURE_BLOCK_LOG_DEDUP_MS;
    for (const [k, ts] of recentFutureBlocks) {
      if (ts < cutoff) recentFutureBlocks.delete(k);
    }
    if (recentFutureBlocks.size >= FUTURE_BLOCK_LOG_MAX_ENTRIES) {
      const firstKey = recentFutureBlocks.keys().next().value;
      if (firstKey !== undefined) recentFutureBlocks.delete(firstKey);
    }
  }
  recentFutureBlocks.set(raw, wall);
  return true;
}

export function __resetFutureBlockDedupForTests(): void {
  recentFutureBlocks.clear();
}

export type GeoPrecisionBadge = 'preciso' | 'aproximado' | 'stale' | 'sem_sinal' | 'bloqueado';

export type MonitoringGeoSourceKind = 'App' | 'REP' | 'Cache' | 'Realtime';

export type OperationalPunchRecord = {
  id: string;
  user_id: string;
  company_id?: string | null;
  type: string;
  timestamp?: string | null;
  created_at: string;
  accuracy?: number | null;
  latitude?: number | null;
  longitude?: number | null;
  raw_data?: {
    geo_snapshot?: {
      latitude_original?: number | null;
      longitude_original?: number | null;
      accuracy_meters?: number | null;
      captured_at?: string | null;
      provider?: string | null;
    };
  } | null;
  origin?: string | null;
  source?: string | null;
  method?: string | null;
};

export type GeoRead = {
  lat: number;
  lng: number;
  accuracy: number | null;
  capturedAt: string;
  provider: string | null;
  storageSource: 'raw_data.geo_snapshot' | 'record_lat_lng';
};

export type RealtimeGeoDecision =
  | {
      useForMap: true;
      lat: number;
      lng: number;
      accuracy: number | null;
      capturedAt: string;
      provider: string | null;
      sourceRecordId: string;
      precisionBadge: GeoPrecisionBadge;
      geoSourceLabel: MonitoringGeoSourceKind;
      mapMarkerKey: string;
      ageMs: number;
    }
  | {
      useForMap: false;
      reason: string;
      logPayload: Record<string, unknown>;
    };

function monitoringGeoSourceLabel(
  record: OperationalPunchRecord,
  storageSource: GeoRead['storageSource'],
): MonitoringGeoSourceKind {
  const o = resolvePunchOrigin(record);
  if (o.kind === 'rep') return 'REP';
  if (storageSource === 'record_lat_lng') return 'Cache';
  if (o.kind === 'admin') return 'App';
  if (o.kind === 'mobile') return 'App';
  return 'Realtime';
}

/**
 * Valida instante operacional (timestamp preferencial, senão created_at).
 * Proíbe batidas futuras além de FUTURE_PUNCH_TOLERANCE_MS.
 */
export function validateOperationalTimestamp(
  isoInput: string | null | undefined,
  nowMs: number = operationalClockMs(),
): OperationalTimestampResult {
  const raw = isoInput != null ? String(isoInput).trim() : '';
  if (!raw) return { ok: false, code: 'invalid_parse', raw };

  const normalized = normalizeOperationalDate(raw, { quiet: true, source: 'validateOperationalTimestamp' });
  if (!normalized) {
    return { ok: false, code: 'invalid_parse', raw };
  }
  const diffMs = normalized.instantMs - nowMs;
  if (diffMs > FUTURE_PUNCH_TOLERANCE_MS) {
    if (shouldEmitFutureBlock(raw)) {
      logFutureOperationalDateBlocked(raw, nowMs, diffMs, { source: 'validateOperationalTimestamp' });
      recordOperationalMetric('future_operational_timestamp_blocked', 1, { source: 'validateOperationalTimestamp' });
    }
    return { ok: false, code: 'future', diffMs, raw };
  }
  return { ok: true, instantMs: normalized.instantMs, utcIso: normalized.utcIso };
}

/** Insert / RPC client-side: bloqueia apenas futuro acima da tolerância. */
export function assertNoFutureOperationalPunch(isoInput: string | null | undefined, nowMs?: number): void {
  const now = nowMs ?? operationalClockMs();
  if (isFutureOperationalTimestamp(isoInput, now)) {
    const n = normalizeOperationalDate(isoInput, { quiet: true });
    const diffMs = n ? n.instantMs - now : 0;
    logFutureOperationalDateBlocked(isoInput ?? '', now, diffMs, { source: 'assertNoFutureOperationalPunch' });
    throw new Error(
      `Batida recusada: horário futuro além do permitido (${Math.round(diffMs / 1000)}s). Ajuste o relógio do dispositivo ou o horário informado.`,
    );
  }
}

export function normalizeOperationalDateUtcAndLocal(
  isoInput: string,
  timezone: string = COMPANY_OPERATIONAL_TIMEZONE,
): { utc: string; local: string; timezone: string; offset: string } | null {
  const dt = DateTime.fromISO(isoInput, { setZone: true });
  if (!dt.isValid) return null;
  const inTz = dt.setZone(timezone);
  return {
    utc: dt.toUTC().toISO() ?? '',
    local: inTz.toFormat("yyyy-MM-dd HH:mm:ss"),
    timezone,
    offset: inTz.toFormat('ZZ'),
  };
}

export function logTimezoneNormalization(
  isoInput: string,
  context: Record<string, unknown>,
  timezone: string = COMPANY_OPERATIONAL_TIMEZONE,
): void {
  const n = normalizeOperationalDateUtcAndLocal(isoInput, timezone);
  if (!n) {
    opLog.diag('TIMEZONE NORMALIZATION', { ...context, error: 'invalid_iso', input: isoInput });
    return;
  }
  opLog.diag('TIMEZONE NORMALIZATION', {
    utc: n.utc,
    local: n.local,
    timezone: n.timezone,
    offset: n.offset,
    ...context,
  });
}

export function formatOperationalLocalDisplay(
  isoInput: string | undefined,
  context: { employeeId?: string; recordId?: string },
  timezone: string = COMPANY_OPERATIONAL_TIMEZONE,
): string | undefined {
  if (!isoInput) return undefined;
  const v = validateOperationalTimestamp(isoInput);
  if (!v.ok) return undefined;
  logTimezoneNormalization(isoInput, { employee_id: context.employeeId, record_id: context.recordId }, timezone);
  const dt = DateTime.fromMillis(v.instantMs, { zone: 'utc' }).setZone(timezone);
  return dt.toFormat('dd/MM/yyyy, HH:mm');
}

export function getCompanyTodayYmd(timezone: string = COMPANY_OPERATIONAL_TIMEZONE): string {
  return getOperationalTodayYmd(timezone);
}

export function companyOperationalDayBoundsUtc(
  dateYmd: string,
  timezone: string = COMPANY_OPERATIONAL_TIMEZONE,
): { startUtc: string; endUtc: string } {
  const r = buildOperationalDayRange(dateYmd, timezone);
  return { startUtc: r.startUtcIso, endUtc: r.endUtcIso };
}

/** Data civil operacional (YYYY-MM-DD em `timezone`) do instante da batida. */
export function punchInstantOperationalYmd(
  record: { timestamp?: string | null; created_at?: string | null },
  timezone: string = COMPANY_OPERATIONAL_TIMEZONE,
): string | null {
  const iso = recordPunchInstantIso(record);
  const v = validateOperationalTimestamp(iso);
  if (!v.ok) return null;
  return DateTime.fromMillis(v.instantMs, { zone: 'utc' }).setZone(timezone).toISODate() ?? null;
}

export function readGeoSnapshot(record: OperationalPunchRecord): GeoRead | null {
  const geo = record.raw_data?.geo_snapshot;
  if (geo) {
    const lat = Number(geo.latitude_original);
    const lng = Number(geo.longitude_original);
    const accuracy = geo.accuracy_meters == null ? null : Number(geo.accuracy_meters);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      return {
        lat,
        lng,
        accuracy: Number.isFinite(accuracy as number) ? accuracy : null,
        capturedAt: geo.captured_at != null && String(geo.captured_at).trim() !== '' ? String(geo.captured_at) : recordPunchInstantIso(record),
        provider: geo.provider != null && String(geo.provider).trim() !== '' ? String(geo.provider) : null,
        storageSource: 'raw_data.geo_snapshot',
      };
    }
  }
  const fallbackCoord = extractLatLng(record);
  if (fallbackCoord) {
    return {
      lat: fallbackCoord.lat,
      lng: fallbackCoord.lng,
      accuracy: record.accuracy == null ? null : Number(record.accuracy),
      capturedAt: recordPunchInstantIso(record),
      provider: null,
      storageSource: 'record_lat_lng',
    };
  }
  return null;
}

/**
 * Última batida operacionalmente válida (não futura) por usuário — ordenação por instante da batida.
 */
export function getLastOperationalPunchForUser(
  records: OperationalPunchRecord[],
  userId: string,
  nowMs: number = operationalClockMs(),
): OperationalPunchRecord | null {
  const valid = records.filter(
    (r) => r.user_id === userId && validateOperationalTimestamp(recordPunchInstantIso(r), nowMs).ok,
  );
  if (valid.length === 0) return null;
  valid.sort((a, b) => recordPunchInstantMs(b) - recordPunchInstantMs(a));
  return valid[0];
}

export function listOperationalPunchesForUserSorted(
  records: OperationalPunchRecord[],
  userId: string,
): OperationalPunchRecord[] {
  const valid = records.filter((r) => r.user_id === userId && validateOperationalTimestamp(recordPunchInstantIso(r)).ok);
  valid.sort((a, b) => recordPunchInstantMs(b) - recordPunchInstantMs(a));
  return valid;
}

export function evaluateRealtimeGeoForMonitoring(
  sortedOperationalNewestFirst: OperationalPunchRecord[],
  employeeId: string,
  nowMs: number = operationalClockMs(),
): RealtimeGeoDecision {
  for (const r of sortedOperationalNewestFirst) {
    const geo = readGeoSnapshot(r);
    if (!geo) continue;

    const capV = validateOperationalTimestamp(geo.capturedAt, nowMs);
    const capturedMs = capV.ok ? capV.instantMs : recordPunchInstantMs(r);
    const ageMs = nowMs - capturedMs;

    if (ageMs > REALTIME_GEO_MAX_AGE_MS) {
      observabilityConsole.info('[GEO STALE POSITION]', {
        employee_id: employeeId,
        age_ms: ageMs,
        captured_at: geo.capturedAt,
        source_record_id: r.id,
      });
      continue;
    }

    const acc = geo.accuracy;
    if (acc != null && Number.isFinite(acc) && acc > GEO_ACCURACY_BLOCK_MARKER_M) {
      observabilityConsole.info('[GEO MAP BLOCKED]', {
        reason: 'accuracy_gt_300m',
        accuracy: acc,
        employee_id: employeeId,
        source_record_id: r.id,
      });
      observabilityConsole.info('[GEO HARDLOCK]', { op: 'map_accuracy_reject', accuracy: acc, employee_id: employeeId });
      observabilityConsole.info('[GEO POSITION REJECTED]', { reason: 'accuracy_map', accuracy: acc, employee_id: employeeId });
      continue;
    }

    const coordIssues = validateCoordinateOrder(geo.lat, geo.lng);
    if (coordIssues.includes('invalid_range')) {
      observabilityConsole.info('[GEO REALTIME REJECTED]', {
        reason: 'invalid_range',
        lat: geo.lat,
        lng: geo.lng,
        employee_id: employeeId,
        source_record_id: r.id,
      });
      continue;
    }

    let precisionBadge: GeoPrecisionBadge = 'preciso';
    if (acc == null || !Number.isFinite(acc)) {
      precisionBadge = 'aproximado';
    } else if (acc > GEO_ACCURACY_APPROXIMATE_M) {
      precisionBadge = 'aproximado';
    }

    const geoSourceLabel = monitoringGeoSourceLabel(r, geo.storageSource);
    const mapMarkerKey = `${r.id}:${geo.capturedAt}:${geo.lat.toFixed(5)}:${geo.lng.toFixed(5)}:${acc ?? 'na'}`;

    observabilityConsole.info('[MAP MARKER UPDATED]', {
      employee_id: employeeId,
      source_record_id: r.id,
      map_marker_key: mapMarkerKey,
      accuracy: acc,
      age_ms: ageMs,
    });

    observabilityConsole.info('[MONITORING GEO SOURCE]', {
      employee_id: employeeId,
      source_record_id: r.id,
      geo_source_label: geoSourceLabel,
      storage: geo.storageSource,
      provider: geo.provider,
      captured_at: geo.capturedAt,
      accuracy: acc,
    });

    return {
      useForMap: true,
      lat: geo.lat,
      lng: geo.lng,
      accuracy: acc,
      capturedAt: geo.capturedAt,
      provider: geo.provider,
      sourceRecordId: r.id,
      precisionBadge,
      geoSourceLabel,
      mapMarkerKey,
      ageMs,
    };
  }

  const payload = { employee_id: employeeId, reason: 'no_acceptable_geo' };
  observabilityConsole.info('[MAP MARKER IGNORED]', payload);
  return { useForMap: false, reason: 'no_acceptable_geo', logPayload: payload };
}

export type MonitoringPipelineEmployeeRow = {
  userId: string;
  userName: string;
  status: EmployeeOperationalStatus;
  statusLabel: string;
  lastRecordType?: string;
  lastRecordAt?: string;
  lat?: number;
  lng?: number;
  accuracy?: number | null;
  capturedAt?: string;
  sourceRecordId?: string;
  geoPrecisionBadge?: GeoPrecisionBadge;
  geoSourceLabel?: MonitoringGeoSourceKind;
  provider?: string | null;
  positionAgeMs?: number;
  mapMarkerKey?: string;
  mapRenderTimestamp: number;
  geoConfidenceLevel?: GeoConfidenceLevel;
  stateVersion?: number;
  stateSource?: string | null;
  lastEventAt?: string | null;
  geoSpeedMps?: number | null;
  geoHeadingDeg?: number | null;
  geoBearingDeg?: number | null;
  geoIsMocked?: boolean;
  geoGpsAgeMs?: number | null;
  /** Localização válida expirou para exibição no mapa (alinhado ao resolver único). */
  geoLocationExpired?: boolean;
};

export function buildMonitoringPipelineRow(
  user: { id: string; nome?: string; email?: string },
  records: OperationalPunchRecord[],
  nowMs: number = operationalClockMs(),
  matchUserIds?: string[],
): MonitoringPipelineEmployeeRow {
  const ids = new Set(matchUserIds?.length ? matchUserIds : [user.id]);
  const userRaw = records.filter((r) => ids.has(r.user_id));
  const sortedValid = userRaw
    .filter((r) => validateOperationalTimestamp(recordPunchInstantIso(r)).ok)
    .sort((a, b) => recordPunchInstantMs(b) - recordPunchInstantMs(a));
  const last = sortedValid[0] ?? null;

  for (const r of userRaw) {
    const v = validateOperationalTimestamp(recordPunchInstantIso(r), nowMs);
    if (v.ok === false && v.code === 'future') {
      observabilityConsole.info('[INVALID FUTURE PUNCH]', {
        employee_id: user.id,
        record_id: r.id,
        timestamp: recordPunchInstantIso(r),
        now_ms: nowMs,
        diff_ms: v.diffMs,
      });
    }
  }

  let lastInstantMs = 0;
  if (last) {
    const lv = validateOperationalTimestamp(recordPunchInstantIso(last), nowMs);
    lastInstantMs = lv.ok ? lv.instantMs : 0;
  }
  const ageMs =
    last && lastInstantMs > 0 ? nowMs - lastInstantMs : MONITORING_OFFLINE_AFTER_LAST_PUNCH_MS + 1;

  const status = computeRealtimeOperationalStatusFromTypeAndAge(
    last?.type,
    ageMs,
    sortedValid.length === 0,
    userRaw.length > 0,
  );

  const geoDecision = evaluateRealtimeGeoForMonitoring(sortedValid, user.id, nowMs);
  let lat: number | undefined;
  let lng: number | undefined;
  let accuracy: number | null | undefined;
  let capturedAt: string | undefined;
  let sourceRecordId: string | undefined;
  let geoPrecisionBadge: GeoPrecisionBadge | undefined;
  let geoSourceLabel: MonitoringGeoSourceKind | undefined;
  let provider: string | null | undefined;
  let positionAgeMs: number | undefined;
  let mapMarkerKey: string | undefined;

  if (geoDecision.useForMap) {
    lat = geoDecision.lat;
    lng = geoDecision.lng;
    accuracy = geoDecision.accuracy;
    capturedAt = geoDecision.capturedAt;
    sourceRecordId = geoDecision.sourceRecordId;
    geoPrecisionBadge = geoDecision.precisionBadge;
    geoSourceLabel = geoDecision.geoSourceLabel;
    provider = geoDecision.provider;
    positionAgeMs = geoDecision.ageMs;
    mapMarkerKey = geoDecision.mapMarkerKey;
  }

  if (last) {
    observabilityConsole.info('[MONITORING LAST VALID PUNCH]', {
      employee_id: user.id,
      source_record_id: last.id,
      source_punch_iso: recordPunchInstantIso(last),
      source_type: normalizePunchType(last.type),
    });
  }

  observabilityConsole.info('[MONITORING STATUS DERIVED]', {
    employee_id: user.id,
    derived_status: status,
    last_type: last ? normalizePunchType(last.type) : null,
    age_ms_since_last: last && lastInstantMs ? nowMs - lastInstantMs : null,
  });

  observabilityConsole.info('[GEO MONITORING PIPELINE]', {
    employee_id: user.id,
    source_record_id: last?.id,
    source_date: last ? punchInstantOperationalYmd(last) : null,
    source_created_at: last?.created_at,
    source_punch_time: last ? recordPunchInstantIso(last) : null,
    source_type: last?.type,
    source_lat: lat,
    source_lng: lng,
    source_accuracy: accuracy ?? null,
    source_provider: provider ?? null,
    source_company_id: last?.company_id ?? null,
    source_timezone: COMPANY_OPERATIONAL_TIMEZONE,
    derived_status: status,
    map_render_timestamp: nowMs,
  });

  let geoConfidenceLevel: GeoConfidenceLevel | undefined;
  if (lat != null && lng != null) {
    geoConfidenceLevel = calculateGeoConfidence(
      {
        accuracyMeters: accuracy ?? null,
        ageMs: positionAgeMs ?? null,
        provider: provider ?? null,
      },
      { log: false },
    );
  }

  if (
    lat != null &&
    lng != null &&
    accuracy != null &&
    Number.isFinite(accuracy) &&
    accuracy > GEO_ACCURACY_BLOCK_MARKER_M
  ) {
    observabilityConsole.info('[GEO MAP BLOCKED]', { employee_id: user.id, accuracy, source: 'buildMonitoringPipelineRow' });
    observabilityConsole.info('[GEO HARDLOCK]', { op: 'pipeline_strip_accuracy', employee_id: user.id });
    return {
      userId: user.id,
      userName: user.nome || user.email || '—',
      status,
      statusLabel: operationalStatusLabel(status),
      lastRecordType: last?.type,
      lastRecordAt: last
        ? formatOperationalLocalDisplay(recordPunchInstantIso(last), { employeeId: user.id, recordId: last.id })
        : undefined,
      geoPrecisionBadge: 'bloqueado',
      geoSourceLabel,
      provider: provider ?? null,
      positionAgeMs,
      mapMarkerKey,
      mapRenderTimestamp: nowMs,
      geoConfidenceLevel: 'INVALID',
      accuracy: accuracy ?? null,
    };
  }

  return {
    userId: user.id,
    userName: user.nome || user.email || '—',
    status,
    statusLabel: operationalStatusLabel(status),
    lastRecordType: last?.type,
    lastRecordAt: last
      ? formatOperationalLocalDisplay(recordPunchInstantIso(last), { employeeId: user.id, recordId: last.id })
      : undefined,
    lat,
    lng,
    accuracy: accuracy ?? null,
    capturedAt,
    sourceRecordId,
    geoPrecisionBadge,
    geoSourceLabel,
    provider: provider ?? null,
    positionAgeMs,
    mapMarkerKey,
    mapRenderTimestamp: nowMs,
    geoConfidenceLevel,
  };
}

/** Presença do dia: apenas batidas cuja data operacional (SP) = `dayYmd`. */
export function filterRecordsForOperationalDay(
  records: OperationalPunchRecord[],
  dayYmd: string,
  timezone: string = COMPANY_OPERATIONAL_TIMEZONE,
): OperationalPunchRecord[] {
  return records.filter((r) => punchInstantOperationalYmd(r, timezone) === dayYmd);
}

export function geoPrecisionBadgeLabel(badge: GeoPrecisionBadge | undefined): string {
  if (badge === 'preciso') return 'GPS preciso';
  if (badge === 'aproximado') return 'Localização aproximada';
  if (badge === 'stale') return 'GPS stale';
  if (badge === 'sem_sinal') return 'Sem sinal confiável';
  if (badge === 'bloqueado') return 'GPS bloqueado';
  return '';
}

export function buildMapEmployeeFromPipelineRow(row: MonitoringPipelineEmployeeRow): {
  userId: string;
  userName: string;
  status: string;
  lastRecordAt?: string;
  lat?: number;
  lng?: number;
  leafletMarkerKey?: string;
  markerVersionKey?: string;
  geoBadge?: string;
  geoDetailLine?: string;
  geoConfidence?: GeoConfidenceLevel;
} {
  detectAndHandleGhostLocation({
    employeeId: row.userId,
    companyId: undefined,
    hasRealtimeUpdate: row.positionAgeMs != null && row.positionAgeMs <= 15_000,
    positionAgeMs: row.positionAgeMs ?? null,
    isOffline: row.status === EmployeeOperationalStatus.OFF_DUTY,
  });
  if (row.geoLocationExpired) {
    observabilityConsole.info('[STALE MARKER HIDDEN]', { userId: row.userId, reason: 'geo_location_expired_card' });
    return {
      userId: row.userId,
      userName: row.userName,
      status: 'Localização expirada',
      lastRecordAt: row.lastRecordAt,
      leafletMarkerKey: row.mapMarkerKey ?? `${row.userId}|expired`,
      markerVersionKey: row.mapMarkerKey,
      geoBadge: 'Localização expirada',
      geoDetailLine: 'Atualize o app ou aguarde nova posição válida.',
      geoConfidence: 'INVALID',
    };
  }
  if (row.lat == null || row.lng == null) {
    return {
      userId: row.userId,
      userName: row.userName,
      status: 'Aguardando consenso',
      lastRecordAt: row.lastRecordAt,
      leafletMarkerKey: row.mapMarkerKey ?? `${row.userId}|pending_consensus`,
      markerVersionKey: row.mapMarkerKey,
      geoBadge: 'Aguardando consenso',
      geoDetailLine: 'Verificando localização...',
      geoConfidence: 'INVALID',
    };
  }
  if (
    row.lat != null &&
    row.lng != null &&
    row.accuracy != null &&
    Number.isFinite(row.accuracy) &&
    row.accuracy > GEO_ACCURACY_BLOCK_MARKER_M
  ) {
    observabilityConsole.info('[GEO MAP BLOCKED]', { userId: row.userId, accuracy: row.accuracy, source: 'buildMapEmployee' });
    return {
      userId: row.userId,
      userName: row.userName,
      status: row.statusLabel,
      lastRecordAt: row.lastRecordAt,
      leafletMarkerKey: row.mapMarkerKey ?? `${row.userId}|blocked`,
      markerVersionKey: row.mapMarkerKey,
      geoBadge: 'GPS bloqueado (precisão)',
      geoDetailLine: `Precisão ${Math.round(row.accuracy)} m — acima do limite do mapa`,
      geoConfidence: 'INVALID',
    };
  }

  const badgeText = geoPrecisionBadgeLabel(row.geoPrecisionBadge);
  const resolvedBadge =
    row.geoConfidenceLevel === 'HIGH'
      ? 'Localização confirmada'
      : row.geoConfidenceLevel === 'MEDIUM'
      ? 'Localização instável'
      : row.geoConfidenceLevel === 'LOW'
      ? 'Posição bloqueada'
      : badgeText || 'Aguardando consenso';
  const detailParts: string[] = [];
  if (row.geoConfidenceLevel) {
    detailParts.push(`Confiança: ${row.geoConfidenceLevel}`);
  }
  if (row.capturedAt) {
    const cap = formatOperationalLocalDisplay(row.capturedAt, { employeeId: row.userId, recordId: row.sourceRecordId });
    if (cap) detailParts.push(`Captura: ${cap}`);
  }
  if (row.provider) detailParts.push(`Provedor: ${row.provider}`);
  if (row.accuracy != null && Number.isFinite(row.accuracy)) detailParts.push(`Precisão: ${Math.round(row.accuracy)} m`);
  if (row.positionAgeMs != null) detailParts.push(`Idade: ${Math.round(row.positionAgeMs / 1000)} s`);
  if (row.geoSourceLabel) detailParts.push(`Origem: ${row.geoSourceLabel}`);
  if (row.geoSpeedMps != null && Number.isFinite(row.geoSpeedMps)) {
    detailParts.push(`Velocidade: ${(row.geoSpeedMps * 3.6).toFixed(1)} km/h`);
  }
  if (row.geoHeadingDeg != null && Number.isFinite(row.geoHeadingDeg)) {
    detailParts.push(`Direção: ${Math.round(row.geoHeadingDeg)}°`);
  }
  if (row.geoIsMocked) detailParts.push('Mock GPS suspeito');

  return {
    userId: row.userId,
    userName: row.userName,
    status: row.statusLabel,
    lastRecordAt: row.lastRecordAt,
    lat: row.lat,
    lng: row.lng,
    leafletMarkerKey: row.mapMarkerKey ?? `${row.userId}|${row.mapRenderTimestamp}`,
    markerVersionKey: row.mapMarkerKey,
    geoBadge: resolvedBadge,
    geoDetailLine: detailParts.length ? detailParts.join(' · ') : undefined,
    geoConfidence: row.geoConfidenceLevel,
  };
}

export function inferOperationalPresenceForDay(
  recordsForUser: OperationalPunchRecord[],
): { status: 'working' | 'break' | 'lunch' | 'off_duty'; lastPunch?: string; lastType?: string; pairCount: number } {
  const valid = [...recordsForUser].filter((r) => validateOperationalTimestamp(recordPunchInstantIso(r)).ok);
  const sorted = valid.sort((a, b) => recordPunchInstantMs(a) - recordPunchInstantMs(b));
  const last = sorted[sorted.length - 1];
  const type = (t: string) =>
    (t || '')
      .toLowerCase()
      .replace('saída', 'saida')
      .replace('saida', 'saida');
  let entradas = 0;
  let saidas = 0;
  for (const r of sorted) {
    const t = type(r.type);
    if (t === 'entrada') entradas++;
    if (t === 'saida') saidas++;
  }
  const pairCount = Math.min(entradas, saidas);
  const lastType = last ? type(last.type) : null;
  const lastTs = last ? recordPunchInstantIso(last) : null;

  if (sorted.length === 0) return { status: 'off_duty', pairCount: 0 };
  if (lastType === 'entrada') return { status: 'working', lastPunch: lastTs ?? undefined, lastType: last.type, pairCount };
  if (lastType === 'pausa') return { status: 'break', lastPunch: lastTs ?? undefined, lastType: last.type, pairCount };
  if (lastType === 'intervalo_saida') return { status: 'lunch', lastPunch: lastTs ?? undefined, lastType: last.type, pairCount };
  return { status: 'off_duty', lastPunch: lastTs ?? undefined, lastType: last?.type, pairCount };
}
