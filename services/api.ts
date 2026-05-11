/**
 * Camada única de chamadas ao backend (Supabase) para espelho de ponto e listas relacionadas.
 * Centraliza Promise.all e evita fetch duplicado / ordem inconsistente entre telas.
 */

import { db, type DbRow, type Filter } from './supabaseClient';
import { localCalendarDayEndUtc, localCalendarDayStartUtc } from '../src/utils/calendarUtils';
import { getNationalHolidayDatesForPeriod } from '../src/engine/timeEngine';

/**
 * Espelho de ponto: priorizar o instante da batida (`timestamp`) no intervalo civil local.
 * - `main`: `timestamp` dentro do período (caso normal).
 * - `legacy`: sem `timestamp`, mas `created_at` no período.
 * - `beforeStart` / `afterEnd`: `created_at` no período e `timestamp` **fora** do intervalo (relógio/AFD com
 *   data errada, importação tardia, ou `source` ≠ `rep` — não depender de `source` para a linha aparecer).
 */
export async function fetchTimeRecordsForMirrorWindow(
  baseFilters: Filter[],
  periodStartYmd: string,
  periodEndYmd: string,
  orderAscending: boolean,
  limit: number
): Promise<DbRow[]> {
  const periodStartTs = localCalendarDayStartUtc(periodStartYmd);
  const periodEndTs = localCalendarDayEndUtc(periodEndYmd);
  const cap = Math.min(2000, limit);

  const [main, legacy, beforeStart, afterEnd] = await Promise.all([
    db.select(
      'time_records',
      [
        ...baseFilters,
        { column: 'timestamp', operator: 'gte', value: periodStartTs },
        { column: 'timestamp', operator: 'lte', value: periodEndTs },
      ],
      { column: 'timestamp', ascending: orderAscending },
      limit
    ),
    db.select(
      'time_records',
      [
        ...baseFilters,
        { column: 'timestamp', operator: 'is', value: null },
        { column: 'created_at', operator: 'gte', value: periodStartTs },
        { column: 'created_at', operator: 'lte', value: periodEndTs },
      ],
      { column: 'created_at', ascending: orderAscending },
      cap
    ),
    db.select(
      'time_records',
      [
        ...baseFilters,
        { column: 'timestamp', operator: 'lt', value: periodStartTs },
        { column: 'created_at', operator: 'gte', value: periodStartTs },
        { column: 'created_at', operator: 'lte', value: periodEndTs },
      ],
      { column: 'created_at', ascending: orderAscending },
      cap
    ),
    db.select(
      'time_records',
      [
        ...baseFilters,
        { column: 'timestamp', operator: 'gt', value: periodEndTs },
        { column: 'created_at', operator: 'gte', value: periodStartTs },
        { column: 'created_at', operator: 'lte', value: periodEndTs },
      ],
      { column: 'created_at', ascending: orderAscending },
      cap
    ),
  ]);

  const byId = new Map<string, DbRow>();
  for (const r of [...(main ?? []), ...(legacy ?? []), ...(beforeStart ?? []), ...(afterEnd ?? [])]) {
    if (r?.id) byId.set(String(r.id), r);
  }
  return Array.from(byId.values()).sort((a, b) => {
    const ta = new Date(String(a.timestamp ?? a.created_at ?? 0)).getTime();
    const tb = new Date(String(b.timestamp ?? b.created_at ?? 0)).getTime();
    return orderAscending ? ta - tb : tb - ta;
  });
}

export type AdminTimesheetEmployee = { id: string; nome: string; department_id?: string; role?: string };
export type AdminTimesheetDepartment = { id: string; name: string };
export type AdminHolidayRow = { id: string; date: string; name: string };

/** Colaboradores da empresa (admin / espelho). */
export async function buscarColaboradores(companyId: string): Promise<AdminTimesheetEmployee[]> {
  const cid = String(companyId).trim();
  const rows = (await db.select('users', [{ column: 'company_id', operator: 'eq', value: cid }])) as DbRow[];
  return (rows ?? []).map((u: DbRow) => ({
    id: String(u.id ?? ''),
    nome: String(u.nome ?? u.email ?? ''),
    department_id: u.department_id != null ? String(u.department_id) : undefined,
  }));
}

/** Departamentos da empresa. */
export async function buscarDepartamentos(companyId: string): Promise<AdminTimesheetDepartment[]> {
  const cid = String(companyId).trim();
  const rows = (await db.select('departments', [{ column: 'company_id', operator: 'eq', value: cid }])) as DbRow[];
  return (rows ?? []).map((d: DbRow) => ({ id: String(d.id ?? ''), name: String(d.name ?? '') }));
}

/** Junta `users` + `employees` (legacy) como na tela Colaboradores — sem excluir admin. */
function mergeEmployeesForEspelho(usersRows: DbRow[], legacyRows: DbRow[]): AdminTimesheetEmployee[] {
  const byEmail = new Map(
    (usersRows ?? [])
      .filter((u: DbRow) => u?.email)
      .map((u: DbRow) => [String(u.email).toLowerCase().trim(), String(u.id ?? '')]),
  );
  const fromUsers: AdminTimesheetEmployee[] = (usersRows ?? []).map((u: DbRow) => ({
    id: String(u.id ?? ''),
    nome: String(u.nome ?? u.email ?? 'Colaborador'),
    department_id: u.department_id != null ? String(u.department_id) : undefined,
    role: u.role != null ? String(u.role) : undefined,
  }));
  const fromLegacy: AdminTimesheetEmployee[] = (legacyRows ?? [])
    .filter((e: DbRow) => {
      const email = String(e?.email || '')
        .trim()
        .toLowerCase();
      if (!email) return false;
      return !byEmail.has(email);
    })
    .map((e: DbRow) => ({
      id: String(e.id ?? ''),
      nome: String(e.nome ?? e.nome_completo ?? e.email ?? 'Colaborador'),
      department_id: (e.department_id ?? e.departamento_id) != null ? String(e.department_id ?? e.departamento_id) : undefined,
      role: e.role != null ? String(e.role) : undefined,
    }))
    .filter((e) => e.id);

  const seen = new Set<string>();
  const out: AdminTimesheetEmployee[] = [];
  for (const e of [...fromUsers, ...fromLegacy]) {
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    out.push(e);
  }
  return out;
}

/**
 * Colaboradores e departamentos para os filtros do espelho — **não depende do período**
 * (evita dropdown vazio antes de escolher datas).
 */
export async function buscarFiltrosEspelhoAdmin(companyId: string): Promise<{
  employees: AdminTimesheetEmployee[];
  departments: AdminTimesheetDepartment[];
}> {
  const cid = String(companyId).trim();
  const [usersRows, departmentsRows, legacyRows] = await Promise.all([
    db.select('users', [{ column: 'company_id', operator: 'eq', value: cid }]) as Promise<DbRow[]>,
    db.select('departments', [{ column: 'company_id', operator: 'eq', value: cid }]) as Promise<DbRow[]>,
    db.select('employees', [{ column: 'company_id', operator: 'eq', value: cid }]).catch(() => []) as Promise<DbRow[]>,
  ]);
  return {
    employees: mergeEmployeesForEspelho(usersRows, legacyRows),
    departments: (departmentsRows ?? []).map((d: DbRow) => ({ id: String(d.id ?? ''), name: String(d.name ?? '') })),
  };
}

/** Registros de ponto no período (empresa). */
export async function buscarEspelhoRegistros(
  companyId: string,
  periodStart: string,
  periodEnd: string,
): Promise<DbRow[]> {
  const cid = String(companyId).trim();
  return fetchTimeRecordsForMirrorWindow(
    [{ column: 'company_id', operator: 'eq', value: cid }],
    periodStart,
    periodEnd,
    false,
    1000
  );
}

/** Carga completa do Espelho de Ponto (admin): colaboradores, departamentos, batidas, escalas e feriados em paralelo. */
export async function buscarEspelhoAdmin(
  companyId: string,
  periodStart: string,
  periodEnd: string,
): Promise<{
  employees: AdminTimesheetEmployee[];
  departments: AdminTimesheetDepartment[];
  records: DbRow[];
  shiftSchedules: DbRow[];
  holidays: AdminHolidayRow[];
}> {
  const cid = String(companyId).trim();

  const [usersRows, recordsRows, departmentsRows, legacyEmployeesRows, shiftsRows, holidaysRows] = await Promise.all([
    db.select('users', [{ column: 'company_id', operator: 'eq', value: cid }]) as Promise<DbRow[]>,
    fetchTimeRecordsForMirrorWindow(
      [{ column: 'company_id', operator: 'eq', value: cid }],
      periodStart,
      periodEnd,
      true,
      8000
    ) as Promise<DbRow[]>,
    db.select('departments', [{ column: 'company_id', operator: 'eq', value: cid }]) as Promise<DbRow[]>,
    db.select('employees', [{ column: 'company_id', operator: 'eq', value: cid }]).catch(() => []) as Promise<DbRow[]>,
    db.select('employee_shift_schedule', [{ column: 'company_id', operator: 'eq', value: cid }]).catch(() => []) as Promise<DbRow[]>,
    db
      .select('holidays', [{ column: 'company_id', operator: 'eq', value: cid }])
      .catch(() =>
        db.select('feriados', [{ column: 'company_id', operator: 'eq', value: cid }]).catch(() => []),
      ) as Promise<DbRow[]>,
  ]);

  const employees = mergeEmployeesForEspelho(usersRows, legacyEmployeesRows);
  const departments: AdminTimesheetDepartment[] = (departmentsRows ?? []).map((d: DbRow) => ({
    id: String(d.id ?? ''),
    name: String(d.name ?? ''),
  }));
  const holidays: AdminHolidayRow[] = (holidaysRows ?? []).map((h: DbRow) => ({
    id: String(h.id ?? ''),
    date: String(h.date ?? h.data ?? '').slice(0, 10),
    name: String(h.name ?? h.descricao ?? 'Feriado'),
  }));
  const holidayDates = new Set(holidays.map((h) => h.date));
  for (const date of getNationalHolidayDatesForPeriod(periodStart, periodEnd)) {
    if (!holidayDates.has(date)) {
      holidays.push({
        id: `national-${date}`,
        date,
        name: 'Feriado nacional',
      });
      holidayDates.add(date);
    }
  }

  return {
    employees,
    departments,
    records: recordsRows ?? [],
    shiftSchedules: shiftsRows ?? [],
    holidays,
  };
}
