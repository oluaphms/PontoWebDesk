import { db } from '../../services/supabaseClient';
import { queryCache, TTL } from './queryCache';
import { runSingleFlight } from '../performance/fetchSingleFlight';
import { recordCriticalRequest } from '../performance/requestBudget';
import { handleError } from '../utils/handleError';
import { recordPunchInstantIso, recordPunchInstantMs, resolvePunchOrigin } from '../utils/punchOrigin';
import { extractLocalCalendarDateFromIso } from '../utils/timesheetMirror';
import {
  currentOperationalStateCacheKey,
  fetchCurrentOperationalStateByCompany,
  type CurrentOperationalStateRow,
} from './currentOperationalState.service';
import { fetchLiveLocationsForCompany, flagStaleLiveLocations } from './liveEmployeeLocation.service';
import {
  punchInstantOperationalYmd,
  readGeoSnapshot,
  validateOperationalTimestamp,
  type OperationalPunchRecord,
} from './monitoring/monitoringGeoHardLock.service';
import { resolveBestRealtimeLocation } from './geolocation/realtimeGeoSourcePriority.service';
import { buildOperationalDayRange, getOperationalTodayYmd } from '../utils/operationalDateHardLock';
import type { LiveEmployeeLocationRow } from './liveEmployeeLocation.service';

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

function operationalDashboardTodayYmd(): string {
  return getOperationalTodayYmd();
}

function operationalDayQueryBounds(todayYmd: string): { startUtcIso: string; endUtcIso: string } {
  const r = buildOperationalDayRange(todayYmd);
  return { startUtcIso: r.startUtcIso, endUtcIso: r.endUtcIso };
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

function typeLabel(rawType: unknown): string {
  const t = normalizeType(rawType);
  if (t === 'entrada') return 'Entrada';
  if (t === 'saida') return 'Saída';
  if (t === 'pausa') return 'Pausa';
  if (t === 'intervalo_saida') return 'Volta intervalo';
  return String(rawType ?? '—');
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

function resolveDashboardDisplayInstant(record: any): {
  instant: Date | null;
  hasAnomaly: boolean;
  anomalyReason: string | null;
} {
  const primary = parseInstantSafe(record?.timestamp);
  const fallback = parseInstantSafe(record?.created_at);
  const now = Date.now();
  const primaryDeltaHours = primary ? (primary.getTime() - now) / 36e5 : null;
  const fallbackDeltaHours = fallback ? (fallback.getTime() - now) / 36e5 : null;

  if (primary && Math.abs(primaryDeltaHours ?? 0) <= 24) {
    return { instant: primary, hasAnomaly: false, anomalyReason: null };
  }

  if (primary && Math.abs(primaryDeltaHours ?? 0) > 24) {
    console.info('[TIME DISPLAY BUG]', {
      reason: 'timestamp_delta_gt_24h',
      source_record_id: String(record?.id ?? ''),
      user_id: String(record?.user_id ?? ''),
      timestamp: String(record?.timestamp ?? ''),
      created_at: String(record?.created_at ?? ''),
      delta_hours: Math.round(primaryDeltaHours ?? 0),
    });
    if (fallback) {
      console.info('[TIMEZONE NORMALIZATION]', {
        source_record_id: String(record?.id ?? ''),
        chosen_source: 'created_at_due_to_timestamp_anomaly',
        timezone: 'America/Sao_Paulo',
      });
      return {
        instant: fallback,
        hasAnomaly: true,
        anomalyReason: 'timestamp fora da janela esperada (>24h)',
      };
    }
    return {
      instant: primary,
      hasAnomaly: true,
      anomalyReason: 'timestamp fora da janela esperada (>24h)',
    };
  }

  if (fallback) {
    if (Math.abs(fallbackDeltaHours ?? 0) > 24) {
      console.info('[TIME DISPLAY BUG]', {
        reason: 'created_at_delta_gt_24h',
        source_record_id: String(record?.id ?? ''),
        user_id: String(record?.user_id ?? ''),
        created_at: String(record?.created_at ?? ''),
        delta_hours: Math.round(fallbackDeltaHours ?? 0),
      });
      return {
        instant: fallback,
        hasAnomaly: true,
        anomalyReason: 'created_at fora da janela esperada (>24h)',
      };
    }
    console.info('[TIMEZONE NORMALIZATION]', {
      source_record_id: String(record?.id ?? ''),
      chosen_source: 'created_at',
      timezone: 'America/Sao_Paulo',
    });
    return { instant: fallback, hasAnomaly: false, anomalyReason: null };
  }

  console.info('[TIME DISPLAY BUG]', {
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
  const allRecentRecords: AdminDashboardLastRecord[] = recentRecords.map((r: any) => {
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
    return {
      id: String(r.id ?? ''),
      userId: String(r.user_id ?? ''),
      employeeName: nameMap.get(String(r.user_id)) ?? String(r.user_id ?? '').slice(0, 8) ?? '—',
      type: String(r.type ?? ''),
      typeLabel: typeLabel(r.type),
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
    .filter((r) => {
      if (r.date === '—') return false;
      const [dd, mm, yyyy] = r.date.split('/');
      const ymd = `${yyyy}-${mm}-${dd}`;
      return ymd === todayLocal;
    })
    .sort((a, b) => {
      const am = parseInt(a.time.replace(':', ''), 10);
      const bm = parseInt(b.time.replace(':', ''), 10);
      return Number.isFinite(bm) && Number.isFinite(am) ? bm - am : 0;
    })
    .slice(0, ADMIN_DASHBOARD_LAST_RECORDS_LIMIT);
}

function originLabelFromOperationalSnapshot(origin: string | null | undefined, method: string | null | undefined): string {
  const o = String(origin ?? '').trim().toLowerCase();
  if (o === 'rep') return 'Relógio';
  if (o === 'admin') return 'Manual / RH';
  if (o === 'mobile' || o === 'app') return 'App';
  const m = String(method ?? '').trim().toLowerCase();
  if (m === 'rep') return 'Relógio';
  if (m === 'admin' || m === 'manual') return 'Manual / RH';
  return 'App';
}

function mergeAdminLastRecordGeoFromSources(
  row: AdminDashboardLastRecord,
  cos: CurrentOperationalStateRow,
  liveByEmployee: Map<string, LiveEmployeeLocationRow>,
  recentRecord: OperationalPunchRecord | null,
  nowMs: number,
): AdminDashboardLastRecord {
  const live = liveByEmployee.get(row.userId) ?? null;
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
  if (cos.map_captured_at && cos.map_latitude != null && cos.map_longitude != null) {
    const v = validateOperationalTimestamp(cos.map_captured_at, nowMs);
    previousAccepted = {
      latitude: Number(cos.map_latitude),
      longitude: Number(cos.map_longitude),
      atMs: v.ok ? v.instantMs : nowMs,
    };
  }
  const resolved = resolveBestRealtimeLocation({
    nowMs,
    employeeId: row.userId,
    companyId: cos.company_id,
    live,
    cos,
    record,
    previousAccepted,
    log: false,
  });
  if (!resolved || resolved.geoConfidence === 'INVALID') {
    return row;
  }
  return {
    ...row,
    lat: resolved.latitude,
    lng: resolved.longitude,
    accuracy: resolved.accuracy,
    location: `${resolved.latitude.toFixed(4)}, ${resolved.longitude.toFixed(4)}`,
  };
}

/** Últimos registros do dia a partir de `current_operational_state` (fonte única com monitoramento). */
function buildAdminLastRecordsFromOperationalState(
  cosRows: CurrentOperationalStateRow[],
  users: any[],
  todayLocal: string,
): AdminDashboardLastRecord[] {
  const nameMap = new Map<string, string>(users.map((u: any) => [String(u.id), u.nome || u.email || 'N/A']));
  const filtered = cosRows.filter((r) => {
    if (!r.last_punch_at) return false;
    const ymd = punchInstantOperationalYmd({ timestamp: r.last_punch_at, created_at: r.last_punch_at });
    return ymd === todayLocal;
  });
  filtered.sort((a, b) => {
    const ta = new Date(a.last_punch_at!).getTime();
    const tb = new Date(b.last_punch_at!).getTime();
    return tb - ta;
  });
  return filtered.slice(0, ADMIN_DASHBOARD_LAST_RECORDS_LIMIT).map((r) => {
    const t = r.last_punch_at ? new Date(r.last_punch_at) : null;
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
    const hasGeo = r.map_latitude != null && r.map_longitude != null;
    return {
      id: String(r.last_punch_record_id ?? ''),
      userId: String(r.employee_id ?? ''),
      employeeName: nameMap.get(String(r.employee_id)) ?? String(r.employee_id ?? '').slice(0, 8) ?? '—',
      type: String(r.last_punch_type ?? ''),
      typeLabel: typeLabel(r.last_punch_type),
      date: dateStr,
      time: timeStr,
      location: hasGeo ? `${Number(r.map_latitude).toFixed(4)}, ${Number(r.map_longitude).toFixed(4)}` : '—',
      originLabel: originLabelFromOperationalSnapshot(r.last_punch_origin, r.last_punch_method),
      lat: r.map_latitude != null ? Number(r.map_latitude) : null,
      lng: r.map_longitude != null ? Number(r.map_longitude) : null,
      accuracy: r.map_accuracy != null ? Number(r.map_accuracy) : null,
      sourceRecordId: String(r.last_punch_record_id ?? ''),
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
  });
}

/**
 * Cards do painel sem gráfico semanal (primeiro paint mais leve).
 */
export async function getAdminDashboardCardsQuick(companyId: string): Promise<AdminDashboardCards | null> {
  return runSingleFlight(`adminDashCardsQuick:${companyId}`, async () => {
    recordCriticalRequest('adminDashCardsQuick');
    try {
      const todayLocal = operationalDashboardTodayYmd();
      const { startUtcIso, endUtcIso } = operationalDayQueryBounds(todayLocal);
      const [usersRows, recentRecordsRaw] = await Promise.all([
        queryCache.getOrFetch(
          `users:${companyId}:minimal`,
          () =>
            db.select(
              'users',
              [{ column: 'company_id', operator: 'eq', value: companyId }],
              undefined,
              1000,
              'id,nome,email,role,status',
            ) as Promise<any[]>,
          TTL.SHORT,
        ),
        queryCache.getOrFetch(
          `time_records:admin_dash:recent:${companyId}`,
          () =>
            db.select(
              'time_records',
              [
                { column: 'company_id', operator: 'eq', value: companyId },
                { column: 'created_at', operator: 'gte', value: startUtcIso },
                { column: 'created_at', operator: 'lte', value: endUtcIso },
              ],
              { column: 'created_at', ascending: false },
              40,
            ) as Promise<any[]>,
          TTL.REALTIME,
        ),
      ]);
      const users = usersRows ?? [];
      const todayRecords = dedupeTimeRecordsByRepKey(recentRecordsRaw ?? []);
      const activeIds = new Set<string>();
      todayRecords.forEach((r: any) => {
        if (r?.user_id) activeIds.add(String(r.user_id));
      });
      const expectedEmployees = users.filter((u: any) => u.role !== 'admin' && u.role !== 'hr').length;
      const absentToday = Math.max(0, expectedEmployees - activeIds.size);
      return {
        totalEmployees: users.length,
        activeEmployees: users.filter((u: any) => u.status !== 'inactive').length,
        recordsToday: todayRecords.length,
        absentToday,
      };
    } catch (e) {
      handleError(e, 'getAdminDashboardCardsQuick');
      return null;
    }
  });
}

/**
 * Últimos registros do dia (GEO/reverse geocode ficam no painel, lazy).
 */
export async function getAdminDashboardLastRecordsOnly(companyId: string): Promise<AdminDashboardLastRecord[]> {
  return runSingleFlight(`adminDashLastRecOnly:${companyId}`, async () => {
    recordCriticalRequest('adminDashLastRecOnly');
    try {
      const todayLocal = operationalDashboardTodayYmd();
      const { startUtcIso, endUtcIso } = operationalDayQueryBounds(todayLocal);
      const nowMs = Date.now();
      const [usersRows, recentRecordsRaw, cosRows, liveRaw] = await Promise.all([
        queryCache.getOrFetch(
          `users:${companyId}:minimal`,
          () =>
            db.select(
              'users',
              [{ column: 'company_id', operator: 'eq', value: companyId }],
              undefined,
              1000,
              'id,nome,email,role,status',
            ) as Promise<any[]>,
          TTL.SHORT,
        ),
        queryCache.getOrFetch(
          `time_records:admin_dash:recent:${companyId}`,
          () =>
            db.select(
              'time_records',
              [
                { column: 'company_id', operator: 'eq', value: companyId },
                { column: 'created_at', operator: 'gte', value: startUtcIso },
                { column: 'created_at', operator: 'lte', value: endUtcIso },
              ],
              { column: 'created_at', ascending: false },
              40,
            ) as Promise<any[]>,
          TTL.REALTIME,
        ),
        queryCache.getOrFetch(
          currentOperationalStateCacheKey(companyId),
          () => fetchCurrentOperationalStateByCompany(companyId),
          TTL.REALTIME,
        ),
        fetchLiveLocationsForCompany(companyId),
      ]);
      const users = usersRows ?? [];
      const recentRecords = recentRecordsRaw ?? [];
      const liveBy = new Map(flagStaleLiveLocations(liveRaw, nowMs).map((r) => [r.employee_id, r]));
      const recordById = new Map(recentRecords.map((r: any) => [String(r.id), r]));
      const cosBy = new Map(cosRows.map((c) => [c.employee_id, c]));
      if (cosRows.length > 0) {
        const built = buildAdminLastRecordsFromOperationalState(cosRows, users, todayLocal);
        return built.map((row) => {
          const cos = cosBy.get(row.userId);
          if (!cos) return row;
          const recId = cos.last_punch_record_id ? String(cos.last_punch_record_id) : '';
          const rec = recId ? (recordById.get(recId) as OperationalPunchRecord | undefined) ?? null : null;
          return mergeAdminLastRecordGeoFromSources(row, cos, liveBy, rec, nowMs);
        });
      }
      return buildAdminLastRecordsForToday(recentRecords, users, todayLocal);
    } catch (e) {
      handleError(e, 'getAdminDashboardLastRecordsOnly');
      return [];
    }
  });
}

/**
 * Agrega dados do painel admin em chamadas controladas (evita N queries na UI).
 */
export async function getAdminDashboardData(companyId: string): Promise<AdminDashboardPayload | null> {
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
    const [usersRows, recordsRaw, recentRecordsRaw, cosRows, liveRaw] = await Promise.all([
      queryCache.getOrFetch(
        `users:${companyId}:minimal`,
        () => db.select('users', 
          [{ column: 'company_id', operator: 'eq', value: companyId }],
          undefined,
          1000,
          'id,nome,email,role,status'
        ) as Promise<any[]>,
        TTL.SHORT,
      ),
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
          ) as Promise<any[]>,
        TTL.SHORT,
      ),
      // Apenas 5 registros mais recentes para "lastRecords"
      queryCache.getOrFetch(
        `time_records:admin_dash:recent:${companyId}`,
        () =>
          db.select(
            'time_records',
            [
              { column: 'company_id', operator: 'eq', value: companyId },
              { column: 'created_at', operator: 'gte', value: startUtcIso },
              { column: 'created_at', operator: 'lte', value: endUtcIso },
            ],
            { column: 'created_at', ascending: false },
            40,
          ) as Promise<any[]>,
        TTL.REALTIME,
      ),
      queryCache.getOrFetch(
        currentOperationalStateCacheKey(companyId),
        () => fetchCurrentOperationalStateByCompany(companyId),
        TTL.REALTIME,
      ),
      fetchLiveLocationsForCompany(companyId),
    ]);

    const users = usersRows ?? [];
    const records = dedupeTimeRecordsByRepKey(recordsRaw ?? []);
    const recentRecords = recentRecordsRaw ?? [];
    const nowMsDash = Date.now();
    const liveByDash = new Map(flagStaleLiveLocations(liveRaw, nowMsDash).map((r) => [r.employee_id, r]));
    const recordByIdDash = new Map(recentRecords.map((r: any) => [String(r.id), r]));
    const cosByDash = new Map(cosRows.map((c) => [c.employee_id, c]));

    const todayRecords = records.filter((r: any) => {
      const ymd = punchInstantOperationalYmd(r);
      return ymd === todayLocal;
    });

    const activeIds = new Set<string>();
    todayRecords.forEach((r: any) => {
      if (r?.user_id) activeIds.add(String(r.user_id));
    });
    const expectedEmployees = users.filter((u: any) => u.role !== 'admin' && u.role !== 'hr').length;
    const absentToday = Math.max(0, expectedEmployees - activeIds.size);

    const cards: AdminDashboardCards = {
      totalEmployees: users.length,
      activeEmployees: users.filter((u: any) => u.status !== 'inactive').length,
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

    const lastRecords =
      cosRows.length > 0
        ? buildAdminLastRecordsFromOperationalState(cosRows, users, todayLocal).map((row) => {
            const cos = cosByDash.get(row.userId);
            if (!cos) return row;
            const recId = cos.last_punch_record_id ? String(cos.last_punch_record_id) : '';
            const rec = recId ? (recordByIdDash.get(recId) as OperationalPunchRecord | undefined) ?? null : null;
            return mergeAdminLastRecordGeoFromSources(row, cos, liveByDash, rec, nowMsDash);
          })
        : buildAdminLastRecordsForToday(recentRecords, users, todayLocal);

    return { cards, users, weeklyChart, weeklySummary, previousWeekTotal, lastRecords };
    } catch (e) {
      handleError(e, 'getAdminDashboardData');
      return null;
    }
  });
}
