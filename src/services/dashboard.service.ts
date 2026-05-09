import { db } from '../../services/supabaseClient';
import { queryCache, TTL } from './queryCache';
import { handleError } from '../utils/handleError';
import { recordPunchInstantIso, recordPunchInstantMs, resolvePunchOrigin } from '../utils/punchOrigin';
import { extractLocalCalendarDateFromIso } from '../utils/timesheetMirror';
import { localCalendarDayEndUtc, localCalendarDayStartUtc } from '../utils/localDateTimeToIso';

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

function localTodayYmd(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
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

/**
 * Agrega dados do painel admin em chamadas controladas (evita N queries na UI).
 */
export async function getAdminDashboardData(companyId: string): Promise<AdminDashboardPayload | null> {
  try {
    const todayLocal = localTodayYmd();
    const startChart = new Date();
    startChart.setDate(startChart.getDate() - 13);
    startChart.setHours(0, 0, 0, 0);
    const minInstantMs = startChart.getTime() - 36e6; // margem TZ

    // Otimização: buscar apenas campos necessários dos usuários
    const [usersRows, recordsRaw, recentRecordsRaw] = await Promise.all([
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
              { column: 'created_at', operator: 'gte', value: localCalendarDayStartUtc(todayLocal) },
              { column: 'created_at', operator: 'lte', value: localCalendarDayEndUtc(todayLocal) },
            ],
            { column: 'created_at', ascending: false },
            40,
          ) as Promise<any[]>,
        TTL.REALTIME,
      ),
    ]);

    const users = usersRows ?? [];
    const records = dedupeTimeRecordsByRepKey(recordsRaw ?? []);
    const recentRecords = recentRecordsRaw ?? [];

    const todayRecords = records.filter((r: any) => {
      const iso = recordPunchInstantIso(r);
      return extractLocalCalendarDateFromIso(iso) === todayLocal;
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

    const nameMap = new Map<string, string>(users.map((u: any) => [String(u.id), u.nome || u.email || 'N/A']));

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

    // Usar recentRecords diretamente (já vem ordenado do banco)
    const allRecentRecords: AdminDashboardLastRecord[] = recentRecords.map((r: any) => {
      const tInfo = resolveDashboardDisplayInstant(r);
      const t = tInfo.instant;
      const geo = readGeoFromRecord(r);
      const streetAddress = readStreetAddressFromGeoSnapshot(r);
      const geoAddressParts = readGeoAddressPartsFromSnapshot(r);
      const timeStr = t && Number.isFinite(t.getTime())
        ? t.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })
        : '—';
      const dateStr = t && Number.isFinite(t.getTime())
        ? t.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'America/Sao_Paulo' })
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
    const lastRecords = allRecentRecords
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

    return { cards, users, weeklyChart, weeklySummary, previousWeekTotal, lastRecords };
  } catch (e) {
    handleError(e, 'getAdminDashboardData');
    return null;
  }
}
