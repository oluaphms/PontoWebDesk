import { db, isSupabaseConfigured, type Filter } from '../../services/supabaseClient';
import { localCalendarDayEndUtc, localCalendarDayStartUtc } from '../utils/calendarUtils';
import {
  addDaysYmd,
  filterRecordsByOperationalDate,
  type DayScheduleSlots,
} from '../utils/resolveOperationalDate';
import {
  resolveEmployeeScheduleForDate,
  workScheduleToDayScheduleSlots,
} from './timeProcessingService';

export function auditDayReviewKey(employeeId: string, dateYmd: string): string {
  return `${employeeId}|${String(dateYmd).slice(0, 10)}`;
}

export async function fetchTimeAttendanceAuditReviews(
  companyId: string,
  periodStart: string,
  periodEnd: string,
): Promise<Set<string>> {
  if (!isSupabaseConfigured() || !String(companyId || '').trim()) return new Set();
  try {
    const rows = await db.select(
      'time_attendance_audit_reviews',
      [
        { column: 'company_id', operator: 'eq', value: companyId },
        { column: 'date', operator: 'gte', value: periodStart.slice(0, 10) },
        { column: 'date', operator: 'lte', value: periodEnd.slice(0, 10) },
      ],
      {
        columns: 'employee_id,date',
        orderBy: { column: 'date', ascending: true },
        limit: 50000,
      },
    );
    const s = new Set<string>();
    for (const r of rows ?? []) {
      const row = r as { employee_id?: string; date?: string };
      const eid = String(row.employee_id ?? '');
      const d = String(row.date ?? '').slice(0, 10);
      if (eid && d) s.add(auditDayReviewKey(eid, d));
    }
    return s;
  } catch {
    return new Set();
  }
}

async function buildAuditScheduleByDay(
  employeeId: string,
  companyId: string,
  operationalDateYmd: string,
): Promise<(date: string) => DayScheduleSlots | null> {
  const cache = new Map<string, DayScheduleSlots | null>();
  const dates = [
    addDaysYmd(operationalDateYmd, -1),
    operationalDateYmd,
    addDaysYmd(operationalDateYmd, 1),
  ];
  await Promise.all(
    dates.map(async (d) => {
      const resolved = await resolveEmployeeScheduleForDate(employeeId, companyId, d);
      cache.set(d, resolved.schedule ? workScheduleToDayScheduleSlots(resolved.schedule) : null);
    }),
  );
  return (date: string) => cache.get(date.slice(0, 10)) ?? null;
}

/** Batidas do dia operacional (jornada noturna unificada via `resolveOperationalDate`). */
export async function fetchDayTimeRecordsForAudit(
  companyId: string,
  employeeId: string,
  dateYmd: string,
): Promise<Record<string, unknown>[]> {
  if (!isSupabaseConfigured() || !companyId || !employeeId) return [];
  const day = String(dateYmd).slice(0, 10);
  const prev = addDaysYmd(day, -1);
  const next = addDaysYmd(day, 1);
  const start = localCalendarDayStartUtc(prev);
  const end = localCalendarDayEndUtc(next);
  const baseFilters: Filter[] = [
    { column: 'company_id', operator: 'eq', value: companyId },
    { column: 'user_id', operator: 'eq', value: employeeId },
  ];
  const columns = 'id,type,created_at,timestamp,origin,source,method,nsr,manual_reason,metadata,raw_data';
  try {
    const [byTimestamp, legacyCreated] = await Promise.all([
      db.select(
        'time_records',
        [
          ...baseFilters,
          { column: 'timestamp', operator: 'gte', value: start },
          { column: 'timestamp', operator: 'lte', value: end },
        ],
        {
          columns,
          orderBy: { column: 'timestamp', ascending: true },
          limit: 2000,
        },
      ),
      db.select(
        'time_records',
        [
          ...baseFilters,
          { column: 'timestamp', operator: 'is', value: null },
          { column: 'created_at', operator: 'gte', value: start },
          { column: 'created_at', operator: 'lte', value: end },
        ],
        {
          columns,
          orderBy: { column: 'created_at', ascending: true },
          limit: 2000,
        },
      ),
    ]);
    const byId = new Map<string, Record<string, unknown>>();
    for (const row of [...(byTimestamp ?? []), ...(legacyCreated ?? [])]) {
      const id = String((row as { id?: string }).id ?? '').trim();
      if (id) byId.set(id, row as Record<string, unknown>);
    }
    const merged = Array.from(byId.values());
    const scheduleByDay = await buildAuditScheduleByDay(employeeId, companyId, day);
    const filtered = filterRecordsByOperationalDate(
      merged.map((r) => ({
        id: String(r.id ?? ''),
        timestamp: (r.timestamp as string | null) ?? null,
        created_at: String(r.created_at ?? ''),
        type: String(r.type ?? ''),
        metadata: r.metadata,
        raw_data: r.raw_data,
        source: (r.source as string | null) ?? null,
        method: (r.method as string | null) ?? null,
        manual_reason: (r.manual_reason as string | null) ?? null,
      })),
      day,
      { periodStartYmd: prev, periodEndYmd: next, scheduleByDay },
    );
    const filteredIds = new Set(filtered.map((r) => r.id));
    return merged
      .filter((r) => filteredIds.has(String(r.id ?? '')))
      .sort((a, b) => {
        const ta = new Date(String(a.timestamp ?? a.created_at ?? 0)).getTime();
        const tb = new Date(String(b.timestamp ?? b.created_at ?? 0)).getTime();
        return ta - tb;
      });
  } catch {
    return [];
  }
}

export async function upsertTimeAttendanceAuditReview(params: {
  companyId: string;
  employeeId: string;
  dateYmd: string;
  reviewedBy: string;
}): Promise<void> {
  const { companyId, employeeId, dateYmd, reviewedBy } = params;
  if (!isSupabaseConfigured()) throw new Error('Supabase não configurado');
  await db.upsert(
    'time_attendance_audit_reviews',
    {
      company_id: companyId,
      employee_id: employeeId,
      date: dateYmd.slice(0, 10),
      reviewed_by: reviewedBy,
      created_at: new Date().toISOString(),
    },
    'company_id,employee_id,date',
  );
}
