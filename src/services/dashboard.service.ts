import { db } from '../../services/supabaseClient';
import { queryCache, TTL } from './queryCache';
import { handleError } from '../utils/handleError';
import { recordPunchInstantIso, recordPunchInstantMs, resolvePunchOrigin } from '../utils/punchOrigin';
import { extractLocalCalendarDateFromIso } from '../utils/timesheetMirror';

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
  /** HH:mm */
  time: string;
  location: string;
  originLabel: string;
  userId: string;
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

    const [usersRows, recordsRaw] = await Promise.all([
      queryCache.getOrFetch(
        `users:${companyId}`,
        () => db.select('users', [{ column: 'company_id', operator: 'eq', value: companyId }]) as Promise<any[]>,
        TTL.NORMAL,
      ),
      queryCache.getOrFetch(
        `time_records:admin_dash:v3:${companyId}:${todayLocal}`,
        () =>
          db.select(
            'time_records',
            [
              { column: 'company_id', operator: 'eq', value: companyId },
              { column: 'created_at', operator: 'gte', value: new Date(minInstantMs).toISOString() },
            ],
            { column: 'created_at', ascending: false },
            5000,
          ) as Promise<any[]>,
        TTL.REALTIME,
      ),
    ]);

    const users = usersRows ?? [];
    const records = dedupeTimeRecordsByRepKey(recordsRaw ?? []);

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

    const normalizeType = (raw: unknown): string =>
      String(raw ?? '')
        .trim()
        .toLowerCase()
        .normalize('NFD')
        .replace(/\p{M}/gu, '');

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

    const sortedNewest = [...records].sort((a, b) => recordPunchInstantMs(b) - recordPunchInstantMs(a));
    const lastFive = sortedNewest.slice(0, 5);

    const lastRecords: AdminDashboardLastRecord[] = lastFive.map((r: any) => {
      const iso = recordPunchInstantIso(r);
      const t = new Date(iso);
      const timeStr = Number.isFinite(t.getTime())
        ? t.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
        : '—';
      return {
        id: String(r.id ?? ''),
        userId: String(r.user_id ?? ''),
        employeeName: nameMap.get(String(r.user_id)) ?? String(r.user_id ?? '').slice(0, 8) ?? '—',
        type: String(r.type ?? ''),
        time: timeStr,
        location: formatLatLng(r),
        originLabel: resolvePunchOrigin(r).label,
      };
    });

    return { cards, users, weeklyChart, weeklySummary, previousWeekTotal, lastRecords };
  } catch (e) {
    handleError(e, 'getAdminDashboardData');
    return null;
  }
}
