import { observabilityConsole } from '../shared/logger/observabilityConsole';
import { db, type DbRow } from '../../services/supabaseClient';
import { queryCache, TTL } from './queryCache';
import { runSingleFlight } from '../performance/fetchSingleFlight';
import { recordCriticalRequest } from '../performance/requestBudget';
import { handleError } from '../utils/handleError';
import { recordPunchInstantIso, recordPunchInstantMs, resolvePunchOrigin } from '../utils/punchOrigin';
import {
  extractLocalCalendarDateFromIso,
  normalizeRecordTypeForMirror,
  type NormalizedMirrorRecordType,
} from '../utils/timesheetMirror';
import { inferDashboardPunchDisplayMirrorType, type RawTimeRecord } from './timeProcessingService';
import {
  currentOperationalStateCacheKey,
  fetchCurrentOperationalStateByCompany,
  type CurrentOperationalStateRow,
} from './currentOperationalState.service';
import { fetchLiveLocationsForCompany, flagStaleLiveLocations } from './liveEmployeeLocation.service';
import {
  filterRecordsForOperationalDay,
  punchInstantOperationalYmd,
  readGeoSnapshot,
  validateOperationalTimestamp,
  type OperationalPunchRecord,
} from './monitoring/monitoringGeoHardLock.service';
import { resolveRealtimeMonitoringLocation } from './geolocation/monitoringGeoSourceResolver';
import { buildOperationalDayRange, getOperationalTodayYmd } from '../utils/operationalDateHardLock';
import { addDaysYmd } from '../utils/resolveOperationalDate';
import { operationalClockMs } from '../utils/operationalClock';
import { opLog } from '../utils/operationalLogger';
import type { LiveEmployeeLocationRow } from './liveEmployeeLocation.service';
import { PlatformService } from '../platform/PlatformService';
import { enableDegradedMode } from './systemMode';
import { isSupabaseBlocked } from '../utils/supabaseGuard';
import {
  getLocalAdminDashboardCards,
  getLocalAdminLastRecords,
  type LocalDashboardLastRecord,
} from './localDb';
import { fetchEmployees, type ApiEmployee } from './employeesApi.service';

export interface AdminDashboardCards {
  totalEmployees: number;
  activeEmployees: number;
  recordsToday: number;
  absentToday: number;
}

export interface AdminWeeklyChartPoint {
  /** YYYY-MM-DD (data civil local do instante da batida) */
  day: string;
  count: number;
  inCount: number;
  outCount: number;
  breakCount: number;
  repCount: number;
  appCount: number;
  adminCount: number;
}

export interface AdminWeeklySummary {
  total: number;
  averagePerDay: number;
  peakDay: string;
  peakCount: number;
  lowDay: string;
  lowCount: number;
}

export interface AdminDashboardLastRecord {
  id: string;
  employeeName: string;
  type: string;
  typeLabel: string;
  /** YYYY-MM-DD */
  date: string;
  /** HH:mm */
  time: string;
  location: string;
  originLabel: string;
  userId: string;
  lat: number | null;
  lng: number | null;
  accuracy: number | null;
  sourceRecordId: string;
  hasTimeAnomaly: boolean;
  timeAnomalyReason: string | null;
  streetAddress: string | null;
  streetResolved: boolean;
  geoStreet: string | null;
  geoDistrict: string | null;
  geoPostalCode: string | null;
  geoCity: string | null;
  geoState: string | null;
}

export interface AdminDashboardPayload {
  cards: AdminDashboardCards;
  users: any[];
  /** Série dos últimos 7 dias (incluindo hoje), já agregada */
  weeklyChart: AdminWeeklyChartPoint[];
  weeklySummary: AdminWeeklySummary;
  previousWeekTotal: number;
  lastRecords: AdminDashboardLastRecord[];
}

const ADMIN_DASHBOARD_LAST_RECORDS_LIMIT = 8;
const ADMIN_DASHBOARD_DAILY_RECORD_QUERY_LIMIT = 120;

type DashboardRecordCandidate = DbRow & {
  id?: string | null;
  user_id?: string | null;
  timestamp?: string | null;
  created_at?: string | null;
  type?: string | null;
};

function isVisibleDashboardEmployee(employee: ApiEmployee): boolean {
  return employee.invisivel !== true;
}

function isActiveDashboardEmployee(employee: ApiEmployee): boolean {
  const status = String(employee.status || 'active').trim().toLowerCase();
  return isVisibleDashboardEmployee(employee) && status !== 'inactive' && status !== 'inativo';
}

function normalizeEmail(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

function buildDashboardUserIdByEmployeeEmail(users: DbRow[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const user of users ?? []) {
    const email = normalizeEmail(user.email);
    const id = String(user.id ?? '').trim();
    if (email && id && !out.has(email)) out.set(email, id);
  }
  return out;
}

function recordUserIdsForEmployee(employee: ApiEmployee, userIdByEmail: Map<string, string>): string[] {
  const ids = [employee.id, userIdByEmail.get(normalizeEmail(employee.email))]
    .map((id) => String(id ?? '').trim())
    .filter(Boolean);
  return Array.from(new Set(ids));
}

async function fetchDashboardEmployees(companyId: string): Promise<ApiEmployee[]> {
  // Reusa `employees-api:` (fetchEmployees) — sem wrapper paralelo.
  return fetchEmployees(companyId);
}

function operationalDashboardTodayYmd(): string {
  return getOperationalTodayYmd();
}

function operationalDayQueryBounds(todayYmd: string): { startUtcIso: string; endUtcIso: string } {
  const yesterday = addDaysYmd(todayYmd, -1);
  const start = buildOperationalDayRange(yesterday).startUtcIso;
  const end = buildOperationalDayRange(todayYmd).endUtcIso;
  return { startUtcIso: start, endUtcIso: end };
}

function filterDashboardTodayRecords(records: any[], todayLocal: string): any[] {
  return filterRecordsForOperationalDay(records as OperationalPunchRecord[], todayLocal, {
    includeOpenNightJourney: true,
  });
}

/**
 * Remove duplicatas lógicas (mesmo espelhamento REP): mantém o registro mais recente por chave.
 */
export function dedupeTimeRecordsByRepKey(records: any[]): any[] {
  const sorted = [...(records ?? [])].sort((a, b) => recordPunchInstantMs(b) - recordPunchInstantMs(a));
  const seen = new Set<string>();
  const out: any[] = [];
  for (const r of sorted) {
    const hasKey = r?.rep_id != null && r?.nsr != null;
    const k = hasKey ? `rep:${String(r.rep_id)}:${String(r.nsr)}` : `id:${String(r.id ?? '')}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(r);
  }
  return out;
}

function mergeDashboardRecordRows(...recordGroups: DashboardRecordCandidate[][]): DashboardRecordCandidate[] {
  const seen = new Set<string>();
  const out: DashboardRecordCandidate[] = [];
  for (const records of recordGroups) {
    for (const record of records ?? []) {
      const rawId = String(record?.id ?? '').trim();
      const key = rawId || `${String(record?.user_id ?? '')}:${recordPunchInstantIso(record)}:${String(record?.type ?? '')}`;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(record);
    }
  }
  return out;
}

async function fetchAdminDashboardDailyRecordCandidates(
  companyId: string,
  todayLocal: string,
  startUtcIso: string,
  endUtcIso: string,
): Promise<DashboardRecordCandidate[]> {
  const columns =
    'id,user_id,company_id,type,timestamp,created_at,accuracy,latitude,longitude,raw_data,origin,source,method,metadata,source_type,is_manual,manual_reason,device_id,nsr';
  const [byPunchInstant, byCreatedAtFallback] = await Promise.all([
    queryCache.getOrFetch(
      `time_records:admin_dash:daily:punch:${companyId}:${todayLocal}`,
      () =>
        db.select(
          'time_records',
          [
            { column: 'company_id', operator: 'eq', value: companyId },
            { column: 'timestamp', operator: 'gte', value: startUtcIso },
            { column: 'timestamp', operator: 'lte', value: endUtcIso },
          ],
          {
            columns,
            orderBy: { column: 'timestamp', ascending: false },
            limit: ADMIN_DASHBOARD_DAILY_RECORD_QUERY_LIMIT,
          },
        ) as Promise<DashboardRecordCandidate[]>,
      TTL.REALTIME,
    ),
    queryCache.getOrFetch(
      `time_records:admin_dash:daily:created:${companyId}:${todayLocal}`,
      () =>
        db.select(
          'time_records',
          [
            { column: 'company_id', operator: 'eq', value: companyId },
            { column: 'created_at', operator: 'gte', value: startUtcIso },
            { column: 'created_at', operator: 'lte', value: endUtcIso },
          ],
          {
            columns,
            orderBy: { column: 'created_at', ascending: false },
            limit: ADMIN_DASHBOARD_DAILY_RECORD_QUERY_LIMIT,
          },
        ) as Promise<DashboardRecordCandidate[]>,
      TTL.REALTIME,
    ),
  ]);

  return mergeDashboardRecordRows(byPunchInstant ?? [], byCreatedAtFallback ?? []);
}

function formatLatLng(r: any): string {
  const lat = r?.latitude ?? r?.location?.lat;
  const lng = r?.longitude ?? r?.location?.lng;
  if (lat != null && lng != null && Number(lat) !== 0 && Number(lng) !== 0) {
    return `${Number(lat).toFixed(4)}, ${Number(lng).toFixed(4)}`;
  }
  return '—';
}

function normalizeType(raw: unknown): string {
  return String(raw ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
}

function typeLabelFromMirrorNorm(norm: NormalizedMirrorRecordType, rawFallback: unknown): string {
  switch (norm) {
    case 'entrada':
      return 'Entrada';
    case 'saida':
      return 'Saída';
    case 'intervalo_saida':
      return 'Intervalo (saída)';
    case 'intervalo_volta':
      return 'Intervalo (retorno)';
    default: {
      const s = String(rawFallback ?? '').trim();
      return s || '—';
    }
  }
}

function typeLabel(rawType: unknown): string {
  return typeLabelFromMirrorNorm(normalizeRecordTypeForMirror(String(rawType ?? '')), rawType);
}

/** Mesma regra do dashboard do colaborador: segunda «entrada» tolerante → saída de intervalo no rótulo. */
function buildAdminLastRecordTypeInferenceMap(recentRecords: any[], todayLocal: string): Map<string, NormalizedMirrorRecordType> {
  const out = new Map<string, NormalizedMirrorRecordType>();
  const todayRecords = filterDashboardTodayRecords(recentRecords, todayLocal);
  const byUser = new Map<string, any[]>();
  for (const r of todayRecords) {
    const uid = String(r.user_id ?? '').trim();
    if (!uid) continue;
    if (!byUser.has(uid)) byUser.set(uid, []);
    byUser.get(uid)!.push(r);
  }
  for (const [, list] of byUser) {
    const sorted = [...list].sort((a, b) => recordPunchInstantMs(a) - recordPunchInstantMs(b));
    sorted.forEach((rec, idx) => {
      const id = String(rec.id ?? '').trim();
      if (!id) return;
      const curMs = recordPunchInstantMs(rec);
      const prevMs = idx > 0 ? recordPunchInstantMs(sorted[idx - 1]!) : null;
      // Mesmo instante (duplicata REP/promote): não reinterpretar sequência — evita «Entrada» + «Saída» às 07:24.
      if (prevMs != null && Math.abs(curMs - prevMs) < 60_000) {
        out.set(id, normalizeRecordTypeForMirror(rec.type));
        return;
      }
      let norm = inferDashboardPunchDisplayMirrorType(sorted as RawTimeRecord[], idx);
      if (
        sorted.length === 2 &&
        idx === 1 &&
        normalizeRecordTypeForMirror(sorted[0]!.type) === 'entrada' &&
        normalizeRecordTypeForMirror(sorted[1]!.type) === 'entrada' &&
        norm === 'intervalo_saida' &&
        Math.abs(recordPunchInstantMs(sorted[0]!) - recordPunchInstantMs(sorted[1]!)) >= 60_000
      ) {
        norm = 'saida';
      }
      out.set(id, norm);
    });
  }
  return out;
}

function readGeoFromRecord(r: any): { lat: number; lng: number; accuracy: number | null } | null {
  const snapshot = r?.raw_data?.geo_snapshot;
  if (snapshot && snapshot.latitude_original != null && snapshot.longitude_original != null) {
    const lat = Number(snapshot.latitude_original);
    const lng = Number(snapshot.longitude_original);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      const accuracy = snapshot.accuracy_meters == null ? null : Number(snapshot.accuracy_meters);
      return { lat, lng, accuracy: Number.isFinite(accuracy as number) ? accuracy : null };
    }
  }
  const lat = Number(r?.latitude ?? r?.location?.lat);
  const lng = Number(r?.longitude ?? r?.location?.lng);
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    const accuracy = r?.accuracy == null ? null : Number(r.accuracy);
    return { lat, lng, accuracy: Number.isFinite(accuracy as number) ? accuracy : null };
  }
  return null;
}

function readStreetAddressFromGeoSnapshot(r: any): string | null {
  const geocodeSnapshot = r?.raw_data?.geo_snapshot?.geocode_snapshot;
  if (!geocodeSnapshot || typeof geocodeSnapshot !== 'object') return null;
  const street = String(geocodeSnapshot.street ?? '').trim();
  const district = String(geocodeSnapshot.district ?? '').trim();
  const city = String(geocodeSnapshot.city ?? '').trim();
  if (!street) return null;
  const suffix = [district, city].filter(Boolean).join(' - ');
  return suffix ? `${street} - ${suffix}` : street;
}

function readGeoAddressPartsFromSnapshot(r: any): {
  street: string | null;
  district: string | null;
  postalCode: string | null;
  city: string | null;
  state: string | null;
} {
  const geocodeSnapshot = r?.raw_data?.geo_snapshot?.geocode_snapshot;
  if (!geocodeSnapshot || typeof geocodeSnapshot !== 'object') {
    return { street: null, district: null, postalCode: null, city: null, state: null };
  }
  const street = String(geocodeSnapshot.street ?? '').trim() || null;
  const district = String(geocodeSnapshot.district ?? '').trim() || null;
  const postalCode = String(geocodeSnapshot.postal_code ?? '').trim() || null;
  const city = String(geocodeSnapshot.city ?? '').trim() || null;
  const state = String(geocodeSnapshot.state ?? '').trim() || null;
  return { street, district, postalCode, city, state };
}

function parseInstantSafe(raw: unknown): Date | null {
  const str = String(raw ?? '').trim();
  if (!str) return null;
  const d = new Date(str);
  if (!Number.isFinite(d.getTime())) return null;
  return d;
}

function isRepLikeDashboardRecord(record: any): boolean {
  const s = String(record?.source ?? '')
    .trim()
    .toLowerCase();
  const m = String(record?.method ?? '')
    .trim()
    .toLowerCase();
  return s === 'rep' || m === 'rep' || record?.nsr != null;
}

function resolveDashboardDisplayInstant(record: any): {
  instant: Date | null;
  hasAnomaly: boolean;
  anomalyReason: string | null;
} {
  const primary = parseInstantSafe(record?.timestamp);
  const fallback = parseInstantSafe(record?.created_at);

  if (isRepLikeDashboardRecord(record) && primary) {
    return { instant: primary, hasAnomaly: false, anomalyReason: null };
  }

  if (primary && fallback) {
    const crossDeltaHours = Math.abs(primary.getTime() - fallback.getTime()) / 36e5;
    if (crossDeltaHours <= 24) {
      return { instant: primary, hasAnomaly: false, anomalyReason: null };
    }
    observabilityConsole.info('[TIME DISPLAY BUG]', {
      reason: 'timestamp_created_at_delta_gt_24h',
      source_record_id: String(record?.id ?? ''),
      user_id: String(record?.user_id ?? ''),
      timestamp: String(record?.timestamp ?? ''),
      created_at: String(record?.created_at ?? ''),
      delta_hours: Math.round(crossDeltaHours),
    });
    return {
      instant: primary,
      hasAnomaly: true,
      anomalyReason: 'timestamp fora da janela esperada (>24h)',
    };
  }

  if (primary) {
    return { instant: primary, hasAnomaly: false, anomalyReason: null };
  }

  if (fallback) {
    return { instant: fallback, hasAnomaly: false, anomalyReason: null };
  }

  observabilityConsole.info('[TIME DISPLAY BUG]', {
    reason: 'invalid_timestamp_and_created_at',
    source_record_id: String(record?.id ?? ''),
    user_id: String(record?.user_id ?? ''),
    timestamp: String(record?.timestamp ?? ''),
    created_at: String(record?.created_at ?? ''),
  });
  return { instant: null, hasAnomaly: true, anomalyReason: 'data inválida' };
}

function buildAdminLastRecordsForToday(
  recentRecords: any[],
  users: any[],
  todayLocal: string,
): AdminDashboardLastRecord[] {
  const nameMap = new Map<string, string>(users.map((u: any) => [String(u.id), u.nome || u.email || 'N/A']));
  const inferById = buildAdminLastRecordTypeInferenceMap(recentRecords, todayLocal);
  const todayRecords = filterDashboardTodayRecords(recentRecords, todayLocal);
  const allRecentRecords: AdminDashboardLastRecord[] = todayRecords.map((r: any) => {
    const tInfo = resolveDashboardDisplayInstant(r);
    const t = tInfo.instant;
    const geo = readGeoFromRecord(r);
    const streetAddress = readStreetAddressFromGeoSnapshot(r);
    const geoAddressParts = readGeoAddressPartsFromSnapshot(r);
    const timeStr =
      t && Number.isFinite(t.getTime())
        ? t.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })
        : '—';
    const dateStr =
      t && Number.isFinite(t.getTime())
        ? t.toLocaleDateString('pt-BR', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            timeZone: 'America/Sao_Paulo',
          })
        : '—';
    const rid = String(r.id ?? '').trim();
    const normForLabel = inferById.get(rid) ?? normalizeRecordTypeForMirror(r.type);
    return {
      id: String(r.id ?? ''),
      userId: String(r.user_id ?? ''),
      employeeName: nameMap.get(String(r.user_id)) ?? String(r.user_id ?? '').slice(0, 8) ?? '—',
      type: String(r.type ?? ''),
      typeLabel: typeLabelFromMirrorNorm(normForLabel, r.type),
      date: dateStr,
      time: timeStr,
      location: geo ? `${geo.lat.toFixed(4)}, ${geo.lng.toFixed(4)}` : formatLatLng(r),
      originLabel: resolvePunchOrigin(r).label,
      lat: geo?.lat ?? null,
      lng: geo?.lng ?? null,
      accuracy: geo?.accuracy ?? null,
      sourceRecordId: String(r.id ?? ''),
      hasTimeAnomaly: tInfo.hasAnomaly,
      timeAnomalyReason: tInfo.anomalyReason,
      streetAddress,
      streetResolved: !!streetAddress,
      geoStreet: geoAddressParts.street,
      geoDistrict: geoAddressParts.district,
      geoPostalCode: geoAddressParts.postalCode,
      geoCity: geoAddressParts.city,
      geoState: geoAddressParts.state,
    };
  });
  return allRecentRecords
    .sort((a, b) => {
      const am = parseInt(a.time.replace(':', ''), 10);
      const bm = parseInt(b.time.replace(':', ''), 10);
      return Number.isFinite(bm) && Number.isFinite(am) ? bm - am : 0;
    })
    .slice(0, ADMIN_DASHBOARD_LAST_RECORDS_LIMIT);
}

function mergeAdminLastRecordGeoFromSources(
  row: AdminDashboardLastRecord,
  cos: CurrentOperationalStateRow,
  liveByEmployee: Map<string, LiveEmployeeLocationRow>,
  recentRecord: OperationalPunchRecord | null,
  nowMs: number,
): AdminDashboardLastRecord {
  const punchId = String(row.sourceRecordId ?? '').trim();
  const cosMatchesPunch = Boolean(
    punchId && cos.last_punch_record_id && String(cos.last_punch_record_id) === punchId,
  );
  const live = cosMatchesPunch ? liveByEmployee.get(row.userId) ?? null : null;
  const cosForResolve = cosMatchesPunch ? cos : null;
  const recordGeo = recentRecord ? readGeoSnapshot(recentRecord) : null;
  const record = recordGeo
    ? {
        lat: recordGeo.lat,
        lng: recordGeo.lng,
        accuracy: recordGeo.accuracy,
        capturedAt: recordGeo.capturedAt,
        provider: recordGeo.provider,
        recordId: String(recentRecord!.id),
      }
    : null;
  let previousAccepted: { latitude: number; longitude: number; atMs: number } | null = null;
  if (
    cosMatchesPunch &&
    cos.map_captured_at &&
    cos.map_latitude != null &&
    cos.map_longitude != null
  ) {
    const v = validateOperationalTimestamp(cos.map_captured_at, nowMs);
    previousAccepted = {
      latitude: Number(cos.map_latitude),
      longitude: Number(cos.map_longitude),
      atMs: v.ok ? v.instantMs : nowMs,
    };
  }
  const resolved = resolveRealtimeMonitoringLocation({
    nowMs,
    employeeId: row.userId,
    companyId: cos.company_id,
    live,
    cos: cosForResolve,
    record,
    previousAccepted,
    log: false,
  });
  if (
    !resolved.source ||
    resolved.latitude == null ||
    resolved.longitude == null ||
    resolved.stale ||
    resolved.confidence === 'INVALID'
  ) {
    opLog.diag('DASHBOARD STALE RECORD BLOCKED', {
      user_id: row.userId,
      source: resolved.source,
      invalid_reason: resolved.invalid_reason,
      stale: resolved.stale,
    });
    return row;
  }
  opLog.diag('DASHBOARD GEO CONSISTENCY', {
    user_id: row.userId,
    source: resolved.source,
    freshness_ms: resolved.freshness_ms,
    checksum_note: 'aligns_with_monitoring_resolver',
  });
  return {
    ...row,
    lat: resolved.latitude,
    lng: resolved.longitude,
    accuracy: resolved.accuracy,
    location: `${resolved.latitude.toFixed(4)}, ${resolved.longitude.toFixed(4)}`,
  };
}

/** Enriquece GEO do painel quando o snapshot COS/live corresponde à batida do card (evita misturar última posição com batidas antigas). */
function enrichAdminLastRecordsWithCosGeo(
  base: AdminDashboardLastRecord[],
  cosByEmployee: Map<string, CurrentOperationalStateRow>,
  recordById: Map<string, OperationalPunchRecord>,
  liveByEmployee: Map<string, LiveEmployeeLocationRow>,
  nowMs: number,
): AdminDashboardLastRecord[] {
  return base.map((row) => {
    const cos = cosByEmployee.get(row.userId);
    if (!cos) return row;
    const recId = row.sourceRecordId ? String(row.sourceRecordId) : '';
    const rec = recId ? (recordById.get(recId) as OperationalPunchRecord | undefined) ?? null : null;
    return mergeAdminLastRecordGeoFromSources(row, cos, liveByEmployee, rec, nowMs);
  });
}

/**
 * Cards do painel sem gráfico semanal (primeiro paint mais leve).
 */
function mapLocalLastToAdmin(row: LocalDashboardLastRecord): AdminDashboardLastRecord {
  return {
    id: row.id,
    employeeName: row.employeeName,
    type: row.type,
    typeLabel: row.typeLabel,
    date: row.date,
    time: row.time,
    location: row.location,
    originLabel: row.originLabel,
    userId: row.userId,
    lat: null,
    lng: null,
    accuracy: null,
    sourceRecordId: row.id,
    hasTimeAnomaly: false,
    timeAnomalyReason: null,
    streetAddress: null,
    streetResolved: false,
    geoStreet: null,
    geoDistrict: null,
    geoPostalCode: null,
    geoCity: null,
    geoState: null,
  };
}

export async function getAdminDashboardCardsQuick(companyId: string): Promise<AdminDashboardCards | null> {
  const localFallback = () => getLocalAdminDashboardCards(companyId);
  if (!PlatformService.isDataLayerConfigured()) {
    return await localFallback();
  }
  return runSingleFlight(`adminDashCardsQuick:${companyId}`, async () => {
    recordCriticalRequest('adminDashCardsQuick');
    try {
      const todayLocal = operationalDashboardTodayYmd();
      const { startUtcIso, endUtcIso } = operationalDayQueryBounds(todayLocal);
      const [employeesRows, usersRows, recentRecordsRaw] = await Promise.all([
        fetchDashboardEmployees(companyId),
        queryCache.getOrFetch(
          `users:${companyId}:dashboard-link`,
          () =>
            db.select(
              'users',
              [{ column: 'company_id', operator: 'eq', value: companyId }],
              { columns: 'id,email', limit: 1000 },
            ) as Promise<DbRow[]>,
          TTL.SHORT,
        ),
        queryCache.getOrFetch(
          `time_records:admin_dash:recent:${companyId}`,
          () =>
            fetchAdminDashboardDailyRecordCandidates(
              companyId,
              todayLocal,
              startUtcIso,
              endUtcIso,
            ) as Promise<DbRow[]>,
          TTL.REALTIME,
        ),
      ]);
      const userIdByEmail = buildDashboardUserIdByEmployeeEmail(usersRows ?? []);
      const visibleEmployees = (employeesRows ?? []).filter(isVisibleDashboardEmployee);
      const visibleEmployeeIds = new Set(
        visibleEmployees.flatMap((employee) => recordUserIdsForEmployee(employee, userIdByEmail)),
      );
      const activeEmployees = visibleEmployees.filter(isActiveDashboardEmployee);
      const activeEmployeeIds = new Set(
        activeEmployees.flatMap((employee) => recordUserIdsForEmployee(employee, userIdByEmail)),
      );
      const todayRecords = filterDashboardTodayRecords(
        dedupeTimeRecordsByRepKey(recentRecordsRaw ?? []).filter((record: any) =>
          visibleEmployeeIds.has(String(record?.user_id ?? '')),
        ),
        todayLocal,
      );
      const activeIdsWithPunch = new Set<string>();
      todayRecords.forEach((r: any) => {
        const id = String(r?.user_id ?? '');
        if (activeEmployeeIds.has(id)) activeIdsWithPunch.add(id);
      });
      const absentToday = Math.max(0, activeEmployees.length - activeIdsWithPunch.size);
      return {
        totalEmployees: visibleEmployees.length,
        activeEmployees: activeEmployees.length,
        recordsToday: todayRecords.length,
        absentToday,
      };
    } catch (e) {
      if (isSupabaseBlocked(e)) {
        enableDegradedMode();
        observabilityConsole.warn('[MODO LOCAL] dashboard cards');
        return await localFallback();
      }
      handleError(e, 'getAdminDashboardCardsQuick');
      return await localFallback();
    }
  });
}

/**
 * Últimos registros do dia (GEO/reverse geocode ficam no painel, lazy).
 */
export async function getAdminDashboardLastRecordsOnly(companyId: string): Promise<AdminDashboardLastRecord[]> {
  const localFallback = async () =>
    (await getLocalAdminLastRecords(companyId)).map(mapLocalLastToAdmin);
  if (!PlatformService.isDataLayerConfigured()) return await localFallback();
  return runSingleFlight(`adminDashLastRecOnly:${companyId}`, async () => {
    recordCriticalRequest('adminDashLastRecOnly');
    try {
      const todayLocal = operationalDashboardTodayYmd();
      const { startUtcIso, endUtcIso } = operationalDayQueryBounds(todayLocal);
      const nowMs = operationalClockMs();
      const [usersRows, employeesRows, recentRecordsRaw, cosRows, liveRaw] = await Promise.all([
        queryCache.getOrFetch(
          `users:${companyId}:minimal`,
          () =>
            db.select(
              'users',
              [{ column: 'company_id', operator: 'eq', value: companyId }],
              { columns: 'id,nome,email,role,status', limit: 1000 },
            ) as Promise<DbRow[]>,
          TTL.SHORT,
        ),
        fetchDashboardEmployees(companyId),
        fetchAdminDashboardDailyRecordCandidates(companyId, todayLocal, startUtcIso, endUtcIso),
        queryCache.getOrFetch(
          currentOperationalStateCacheKey(companyId),
          () => fetchCurrentOperationalStateByCompany(companyId),
          TTL.REALTIME,
        ),
        fetchLiveLocationsForCompany(companyId),
      ]);
      const users = [...(usersRows ?? []), ...(employeesRows ?? [])];
      const recentRecords = recentRecordsRaw ?? [];
      const liveBy = new Map(flagStaleLiveLocations(liveRaw, nowMs).map((r) => [r.employee_id, r]));
      const recordById = new Map(recentRecords.map((r: any) => [String(r.id), r]));
      const cosBy = new Map(cosRows.map((c) => [c.employee_id, c]));
      const baseLast = buildAdminLastRecordsForToday(recentRecords, users, todayLocal);
      if (cosRows.length === 0) return baseLast;
      return enrichAdminLastRecordsWithCosGeo(baseLast, cosBy, recordById, liveBy, nowMs);
    } catch (e) {
      if (isSupabaseBlocked(e)) {
        enableDegradedMode();
        observabilityConsole.warn('[MODO LOCAL] dashboard last records');
        return await localFallback();
      }
      handleError(e, 'getAdminDashboardLastRecordsOnly');
      return await localFallback();
    }
  });
}

/**
 * Agrega dados do painel admin em chamadas controladas (evita N queries na UI).
 */
export async function getAdminDashboardData(companyId: string): Promise<AdminDashboardPayload | null> {
  if (!PlatformService.isDataLayerConfigured()) {
    return ({
      cards: {
        totalEmployees: 0,
        activeEmployees: 0,
        recordsToday: 0,
        absentToday: 0,
      },
      users: [],
      weeklyChart: [],
      weeklySummary: {
        total: 0,
        averagePerDay: 0,
        peakDay: '',
        peakCount: 0,
        lowDay: '',
        lowCount: 0,
      },
      previousWeekTotal: 0,
      lastRecords: [],
    });
  }
  return runSingleFlight(`getAdminDashboardData:${companyId}`, async () => {
    recordCriticalRequest('getAdminDashboardData');
    try {
    const todayLocal = operationalDashboardTodayYmd();
    const { startUtcIso, endUtcIso } = operationalDayQueryBounds(todayLocal);
    const startChart = new Date();
    startChart.setDate(startChart.getDate() - 13);
    startChart.setHours(0, 0, 0, 0);
    const minInstantMs = startChart.getTime() - 36e6; // margem TZ

    // Otimização: buscar apenas campos necessários dos usuários
    const [employeesRows, recordsRaw, recentRecordsRaw, cosRows, liveRaw] = await Promise.all([
      fetchDashboardEmployees(companyId),
      // Apenas registros dos últimos 14 dias para o gráfico
      queryCache.getOrFetch(
        `time_records:admin_dash:chart:${companyId}:${todayLocal}`,
        () =>
          db.select(
            'time_records',
            [
              { column: 'company_id', operator: 'eq', value: companyId },
              { column: 'created_at', operator: 'gte', value: new Date(minInstantMs).toISOString() },
            ],
            { column: 'created_at', ascending: false },
            500, // Reduzido de 5000 para 500
          ) as Promise<DbRow[]>,
        TTL.SHORT,
      ),
      fetchAdminDashboardDailyRecordCandidates(companyId, todayLocal, startUtcIso, endUtcIso),
      queryCache.getOrFetch(
        currentOperationalStateCacheKey(companyId),
        () => fetchCurrentOperationalStateByCompany(companyId),
        TTL.REALTIME,
      ),
      fetchLiveLocationsForCompany(companyId),
    ]);

    const visibleEmployees = (employeesRows ?? []).filter(isVisibleDashboardEmployee);
    const visibleEmployeeIds = new Set(visibleEmployees.map((employee) => String(employee.id)));
    const activeEmployees = visibleEmployees.filter(isActiveDashboardEmployee);
    const activeEmployeeIds = new Set(activeEmployees.map((employee) => String(employee.id)));
    const records = dedupeTimeRecordsByRepKey(recordsRaw ?? []).filter((record: any) =>
      visibleEmployeeIds.has(String(record?.user_id ?? '')),
    );
    const recentRecords = (recentRecordsRaw ?? []).filter((record: any) =>
      visibleEmployeeIds.has(String(record?.user_id ?? '')),
    );
    const nowMsDash = operationalClockMs();
    const liveByDash = new Map(flagStaleLiveLocations(liveRaw, nowMsDash).map((r) => [r.employee_id, r]));
    const recordByIdDash = new Map(recentRecords.map((r: any) => [String(r.id), r]));
    const cosByDash = new Map(cosRows.map((c) => [c.employee_id, c]));

    const todayRecords = filterDashboardTodayRecords(records, todayLocal);

    const activeIdsWithPunch = new Set<string>();
    todayRecords.forEach((r: any) => {
      const id = String(r?.user_id ?? '');
      if (activeEmployeeIds.has(id)) activeIdsWithPunch.add(id);
    });
    const absentToday = Math.max(0, activeEmployees.length - activeIdsWithPunch.size);

    const cards: AdminDashboardCards = {
      totalEmployees: visibleEmployees.length,
      activeEmployees: activeEmployees.length,
      recordsToday: todayRecords.length,
      absentToday,
    };

    const weekDays: string[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      weekDays.push(`${y}-${m}-${day}`);
    }

    const previousWeekDays: string[] = [];
    for (let i = 13; i >= 7; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      previousWeekDays.push(`${y}-${m}-${day}`);
    }

    const statsByDay = new Map<string, Omit<AdminWeeklyChartPoint, 'day'>>();
    for (const r of records) {
      const day = extractLocalCalendarDateFromIso(recordPunchInstantIso(r));
      const cur = statsByDay.get(day) ?? {
        count: 0,
        inCount: 0,
        outCount: 0,
        breakCount: 0,
        repCount: 0,
        appCount: 0,
        adminCount: 0,
      };
      cur.count += 1;
      const t = normalizeType(r?.type);
      if (t === 'entrada') cur.inCount += 1;
      else if (t === 'saida') cur.outCount += 1;
      else if (t === 'pausa') cur.breakCount += 1;

      const origin = resolvePunchOrigin(r).kind;
      if (origin === 'rep') cur.repCount += 1;
      else if (origin === 'admin') cur.adminCount += 1;
      else cur.appCount += 1;
      statsByDay.set(day, cur);
    }

    const weeklyChart: AdminWeeklyChartPoint[] = weekDays.map((day) => {
      const s = statsByDay.get(day);
      return {
        day,
        count: s?.count ?? 0,
        inCount: s?.inCount ?? 0,
        outCount: s?.outCount ?? 0,
        breakCount: s?.breakCount ?? 0,
        repCount: s?.repCount ?? 0,
        appCount: s?.appCount ?? 0,
        adminCount: s?.adminCount ?? 0,
      };
    });

    const previousWeekTotal = previousWeekDays.reduce((acc, day) => acc + (statsByDay.get(day)?.count ?? 0), 0);
    const weeklyTotal = weeklyChart.reduce((acc, d) => acc + d.count, 0);
    const peak = weeklyChart.reduce((best, cur) => (cur.count > best.count ? cur : best), weeklyChart[0]);
    const low = weeklyChart.reduce((best, cur) => (cur.count < best.count ? cur : best), weeklyChart[0]);
    const weeklySummary: AdminWeeklySummary = {
      total: weeklyTotal,
      averagePerDay: weeklyTotal / 7,
      peakDay: peak.day,
      peakCount: peak.count,
      lowDay: low.day,
      lowCount: low.count,
    };

    const baseLastRecords = buildAdminLastRecordsForToday(recentRecords, visibleEmployees, todayLocal);
    const lastRecords =
      cosRows.length > 0
        ? enrichAdminLastRecordsWithCosGeo(baseLastRecords, cosByDash, recordByIdDash, liveByDash, nowMsDash)
        : baseLastRecords;

    return { cards, users: visibleEmployees, weeklyChart, weeklySummary, previousWeekTotal, lastRecords };
    } catch (e) {
      handleError(e, 'getAdminDashboardData');
      return null;
    }
  });
}
