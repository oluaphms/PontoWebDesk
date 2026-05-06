import { db, isSupabaseConfigured } from '../../services/supabaseClient';
import { localCalendarDayEndUtc, localCalendarDayStartUtc } from '../utils/calendarUtils';

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

/** Batidas do espelho no dia civil (filtro alinhado à jornada). */
export async function fetchDayTimeRecordsForAudit(
  companyId: string,
  employeeId: string,
  dateYmd: string,
): Promise<Record<string, unknown>[]> {
  if (!isSupabaseConfigured() || !companyId || !employeeId) return [];
  const day = String(dateYmd).slice(0, 10);
  try {
    const start = localCalendarDayStartUtc(day);
    const end = localCalendarDayEndUtc(day);
    return await db.select(
      'time_records',
      [
        { column: 'company_id', operator: 'eq', value: companyId },
        { column: 'user_id', operator: 'eq', value: employeeId },
        { column: 'created_at', operator: 'gte', value: start },
        { column: 'created_at', operator: 'lte', value: end },
      ],
      {
        columns: 'id,type,created_at,timestamp,origin,source,method,nsr,manual_reason',
        orderBy: { column: 'created_at', ascending: true },
        limit: 2000,
      },
    );
  } catch {
    try {
      const start = localCalendarDayStartUtc(day);
      const end = localCalendarDayEndUtc(day);
      return await db.select(
        'time_records',
        [
          { column: 'company_id', operator: 'eq', value: companyId },
          { column: 'user_id', operator: 'eq', value: employeeId },
          { column: 'created_at', operator: 'gte', value: start },
          { column: 'created_at', operator: 'lte', value: end },
        ],
        {
          columns: 'id,type,created_at,timestamp,nsr',
          orderBy: { column: 'created_at', ascending: true },
          limit: 2000,
        },
      );
    } catch {
      return [];
    }
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
