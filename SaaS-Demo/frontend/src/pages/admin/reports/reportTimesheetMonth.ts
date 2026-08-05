import { db, isSupabaseConfigured } from '../../../services/supabaseClient';

export type TimesheetMonthDay = {
  date: string;
  worked_minutes: number;
  expected_minutes: number;
  extra_50_minutes: number;
  extra_100_minutes: number;
  day_type: string;
};

export type WorkHoursMonthRow = {
  employeeId: string;
  employeeName: string;
  totalHours: number;
  expectedHours: number;
  balance: number;
};

export type OvertimeMonthDay = {
  date: string;
  overtime50: number;
  overtime100: number;
  total: number;
  isHolidayOrOff: boolean;
};

export type OvertimeMonthRow = {
  employeeId: string;
  employeeName: string;
  departmentId: string;
  overtime50: number;
  overtime100: number;
  total: number;
  workDays: number;
  overtimeDays: number;
  daily: OvertimeMonthDay[];
};

type ApiEmployeeLike = { id: string; nome?: string | null; email?: string | null; department_id?: string | null };
type UserLike = { id?: string; email?: string | null };

function normalizeEmail(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

function monthBounds(year: number, month: number): { start: string; end: string } {
  const lastDay = new Date(year, month, 0).getDate();
  const mm = String(month).padStart(2, '0');
  return {
    start: `${year}-${mm}-01`,
    end: `${year}-${mm}-${String(lastDay).padStart(2, '0')}`,
  };
}

/** IDs em `timesheets_daily` (user) ↔ colaborador da API. */
export function buildEmployeeRecordIdMap(
  apiEmployees: ApiEmployeeLike[],
  users: UserLike[],
): Map<string, string[]> {
  const userIdByEmail = new Map<string, string>();
  for (const u of users) {
    const email = normalizeEmail(u.email);
    const id = String(u.id ?? '').trim();
    if (email && id) userIdByEmail.set(email, id);
  }
  const out = new Map<string, string[]>();
  for (const e of apiEmployees) {
    const ids = new Set<string>();
    const apiId = String(e.id ?? '').trim();
    if (apiId) ids.add(apiId);
    const linked = userIdByEmail.get(normalizeEmail(e.email));
    if (linked) ids.add(linked);
    out.set(apiId, [...ids]);
  }
  return out;
}

function parseTimesheetRow(row: Record<string, unknown>): TimesheetMonthDay {
  const raw =
    row.raw_data && typeof row.raw_data === 'object' && !Array.isArray(row.raw_data)
      ? (row.raw_data as Record<string, unknown>)
      : {};
  return {
    date: String(row.date ?? '').slice(0, 10),
    worked_minutes: Math.max(0, Number(row.worked_minutes ?? 0) || 0),
    expected_minutes: Math.max(0, Number(row.expected_minutes ?? 0) || 0),
    extra_50_minutes: Math.max(
      0,
      Number(raw.extra_50_minutes ?? raw.extra_folha_50_minutes ?? 0) || 0,
    ),
    extra_100_minutes: Math.max(
      0,
      Number(raw.extra_100_minutes ?? raw.extra_folha_100_minutes ?? 0) || 0,
    ),
    day_type: String(raw.day_type ?? ''),
  };
}

function isHolidayOrOffDay(day: TimesheetMonthDay): boolean {
  if (day.extra_100_minutes > 0 && day.extra_50_minutes === 0) return true;
  const t = day.day_type.toUpperCase();
  return t === 'HOLIDAY' || t === 'SUNDAY' || t === 'OFF' || t === 'FOLGA';
}

function indexSheetByRecordId(rows: Record<string, unknown>[]): Map<string, TimesheetMonthDay[]> {
  const map = new Map<string, TimesheetMonthDay[]>();
  for (const row of rows) {
    const employeeId = String(row.employee_id ?? '').trim();
    if (!employeeId) continue;
    const day = parseTimesheetRow(row);
    if (!day.date) continue;
    if (!map.has(employeeId)) map.set(employeeId, []);
    const list = map.get(employeeId)!;
    const existing = list.find((d) => d.date === day.date);
    if (!existing || day.worked_minutes >= existing.worked_minutes) {
      if (existing) {
        list[list.indexOf(existing)] = day;
      } else {
        list.push(day);
      }
    }
  }
  for (const list of map.values()) {
    list.sort((a, b) => a.date.localeCompare(b.date));
  }
  return map;
}

function daysForEmployee(
  recordIds: string[],
  sheetByRecordId: Map<string, TimesheetMonthDay[]>,
): TimesheetMonthDay[] {
  const out: TimesheetMonthDay[] = [];
  const seen = new Set<string>();
  for (const rid of recordIds) {
    for (const d of sheetByRecordId.get(rid) ?? []) {
      if (seen.has(d.date)) continue;
      seen.add(d.date);
      out.push(d);
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

export function buildWorkHoursMonthReport(
  apiEmployees: ApiEmployeeLike[],
  recordIdMap: Map<string, string[]>,
  sheetByRecordId: Map<string, TimesheetMonthDay[]>,
): WorkHoursMonthRow[] {
  return apiEmployees.map((emp) => {
    const recordIds = recordIdMap.get(emp.id) ?? [emp.id];
    const days = daysForEmployee(recordIds, sheetByRecordId);
    const totalMinutes = days.reduce((s, d) => s + d.worked_minutes, 0);
    const expectedMinutes = days.reduce((s, d) => s + d.expected_minutes, 0);
    const totalHours = totalMinutes / 60;
    const expectedHours = expectedMinutes / 60;
    return {
      employeeId: emp.id,
      employeeName: String(emp.nome || emp.email || 'Sem nome'),
      totalHours,
      expectedHours,
      balance: totalHours - expectedHours,
    };
  });
}

export function buildOvertimeMonthReport(
  apiEmployees: ApiEmployeeLike[],
  recordIdMap: Map<string, string[]>,
  sheetByRecordId: Map<string, TimesheetMonthDay[]>,
): OvertimeMonthRow[] {
  return apiEmployees.map((emp) => {
    const recordIds = recordIdMap.get(emp.id) ?? [emp.id];
    const days = daysForEmployee(recordIds, sheetByRecordId);
    let overtime50 = 0;
    let overtime100 = 0;
    let workDays = 0;
    let overtimeDays = 0;
    const daily: OvertimeMonthDay[] = [];

    for (const d of days) {
      if (d.worked_minutes > 0) workDays += 1;
      const day50 = d.extra_50_minutes / 60;
      const day100 = d.extra_100_minutes / 60;
      overtime50 += day50;
      overtime100 += day100;
      if (day50 > 0 || day100 > 0) {
        overtimeDays += 1;
        daily.push({
          date: d.date,
          overtime50: day50,
          overtime100: day100,
          total: day50 + day100,
          isHolidayOrOff: isHolidayOrOffDay(d),
        });
      }
    }

    return {
      employeeId: emp.id,
      employeeName: String(emp.nome || emp.email || 'Sem nome'),
      departmentId: String(emp.department_id ?? ''),
      overtime50,
      overtime100,
      total: overtime50 + overtime100,
      workDays,
      overtimeDays,
      daily,
    };
  });
}

export async function loadTimesheetMonthContext(
  companyId: string,
  year: number,
  month: number,
  apiEmployees: ApiEmployeeLike[],
): Promise<{
  sheetByRecordId: Map<string, TimesheetMonthDay[]>;
  recordIdMap: Map<string, string[]>;
}> {
  if (!isSupabaseConfigured() || !companyId) {
    return { sheetByRecordId: new Map(), recordIdMap: buildEmployeeRecordIdMap(apiEmployees, []) };
  }
  const { start, end } = monthBounds(year, month);
  const [rawRows, users] = await Promise.all([
    db.select(
      'timesheets_daily',
      [
        { column: 'company_id', operator: 'eq', value: companyId },
        { column: 'date', operator: 'gte', value: start },
        { column: 'date', operator: 'lte', value: end },
      ],
      {
        columns: 'employee_id,date,worked_minutes,expected_minutes,raw_data',
        orderBy: { column: 'date', ascending: true },
        limit: 20000,
      },
    ).catch(() => []) as Promise<Record<string, unknown>[]>,
    db.select(
      'users',
      [{ column: 'company_id', operator: 'eq', value: companyId }],
      { columns: 'id,email', limit: 1000 },
    ).catch(() => []) as Promise<UserLike[]>,
  ]);

  return {
    sheetByRecordId: indexSheetByRecordId(rawRows ?? []),
    recordIdMap: buildEmployeeRecordIdMap(apiEmployees, users ?? []),
  };
}
