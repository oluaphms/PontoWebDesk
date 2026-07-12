/**
 * Camada única de chamadas ao backend (Supabase) para espelho de ponto e listas relacionadas.
 * Centraliza Promise.all e evita fetch duplicado / ordem inconsistente entre telas.
 */

import { db, type DbRow, type Filter } from './supabaseClient';
import { fetchEmployees } from '../src/services/employeesApi.service';
import { localCalendarDayEndUtc, localCalendarDayStartUtc } from '../src/utils/calendarUtils';
import { addDaysYmd } from '../src/utils/resolveOperationalDate';
import { getNationalHolidayDatesForPeriod } from '../src/engine/timeEngine';
import { observabilityConsole } from '../src/shared/logger/observabilityConsole';
import { isAdminGerente } from '../src/utils/accessProfile';
import { queryCache, TTL } from '../src/services/queryCache';

/**
 * Espelho de ponto: janela ampliada (D-1 … D+1) para capturar madrugada de jornadas noturnas.
 * O agrupamento por data operacional ocorre em `buildDayMirrorSummary` / `getOperationalDate`.
 */
export async function fetchTimeRecordsForMirrorWindow(
  baseFilters: Filter[],
  periodStartYmd: string,
  periodEndYmd: string,
  orderAscending: boolean,
  limit: number
): Promise<DbRow[]> {
  const periodStartTs = localCalendarDayStartUtc(addDaysYmd(periodStartYmd, -1));
  const periodEndTs = localCalendarDayEndUtc(addDaysYmd(periodEndYmd, 1));
  const cap = Math.min(2000, limit);

  const [main, legacy] = await Promise.all([
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
  ]);

  const byId = new Map<string, DbRow>();
  for (const r of [...(main ?? []), ...(legacy ?? [])]) {
    if (r?.id) byId.set(String(r.id), r);
  }
  const merged = Array.from(byId.values()).sort((a, b) => {
    const ta = new Date(String(a.timestamp ?? a.created_at ?? 0)).getTime();
    const tb = new Date(String(b.timestamp ?? b.created_at ?? 0)).getTime();
    return orderAscending ? ta - tb : tb - ta;
  });

  const employeeFilter = baseFilters.find((f) => f.column === 'user_id' && f.operator === 'eq');
  observabilityConsole.log('[TIMESHEET QUERY]', {
    employee_id: employeeFilter?.value ?? null,
    periodo: `${periodStartYmd}..${periodEndYmd}`,
    batidas_encontradas: merged.length,
    source: 'time_records',
  });

  return merged;
}

export type AdminTimesheetEmployee = {
  id: string;
  nome: string;
  email?: string | null;
  department_id?: string | null;
  role?: string;
  record_user_ids?: string[];
};
export type AdminTimesheetDepartment = { id: string; name: string };
export type AdminHolidayRow = { id: string; date: string; name: string };

function normalizeEmail(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

/** Espelho operacional: colaboradores + Admin/RH (com ponto). Exclui só Admin/Gerente. */
function isTimesheetVisibleEmployee(row: { role?: unknown; status?: unknown; invisivel?: unknown }): boolean {
  if (isAdminGerente(row.role)) return false;
  return row.invisivel !== true;
}

function uniqueIds(ids: unknown[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of ids) {
    const id = String(raw ?? '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/** Colaboradores da empresa (admin / espelho) — API VPS. */
export async function buscarColaboradores(companyId: string): Promise<AdminTimesheetEmployee[]> {
  const cid = String(companyId).trim();
  const rows = await fetchEmployees(cid);
  return mapApiEmployeesToEspelho(rows, []);
}

/** Departamentos da empresa. */
export async function buscarDepartamentos(companyId: string): Promise<AdminTimesheetDepartment[]> {
  const cid = String(companyId).trim();
  const rows = (await db.select('departments', [{ column: 'company_id', operator: 'eq', value: cid }])) as DbRow[];
  return (rows ?? []).map((d: DbRow) => ({ id: String(d.id ?? ''), name: String(d.name ?? '') }));
}

/** Colunas mínimas + limite — evita timeout em `db.select(users)` no espelho. */
const ESPELHO_USERS_SELECT_OPTS = {
  columns: 'id,nome,email,department_id,role',
  limit: 500,
  orderBy: { column: 'nome', ascending: true },
} as const;

async function fetchEspelhoUsers(cid: string): Promise<DbRow[]> {
  return queryCache.getOrFetch(
    `espelho-users:${cid}`,
    () =>
      db
        .select('users', [{ column: 'company_id', operator: 'eq', value: cid }], ESPELHO_USERS_SELECT_OPTS)
        .catch(() => []) as Promise<DbRow[]>,
    TTL.NORMAL,
  );
}

async function fetchEspelhoDepartments(cid: string): Promise<DbRow[]> {
  return queryCache.getOrFetch(
    `espelho-departments:${cid}`,
    () => db.select('departments', [{ column: 'company_id', operator: 'eq', value: cid }]) as Promise<DbRow[]>,
    TTL.STATIC,
  );
}

function mapApiEmployeesToEspelho(
  rows: Awaited<ReturnType<typeof fetchEmployees>>,
  userRows: DbRow[],
): AdminTimesheetEmployee[] {
  const userIdByEmail = new Map<string, string>();
  for (const user of userRows ?? []) {
    const email = normalizeEmail(user.email);
    const id = String(user.id ?? '').trim();
    if (email && id && !userIdByEmail.has(email)) userIdByEmail.set(email, id);
  }
  return rows
    .filter(isTimesheetVisibleEmployee)
    .map((u) => {
      const linkedUserId = userIdByEmail.get(normalizeEmail(u.email));
      const ids = uniqueIds([u.id, linkedUserId]);
      return {
        id: u.id,
        nome: u.nome || u.email || 'Colaborador',
        email: u.email ?? null,
        department_id: u.department_id ?? null,
        role: u.role,
        record_user_ids: ids,
      };
    });
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
  const [apiEmployees, userRows, departmentsRows] = await Promise.all([
    fetchEmployees(cid),
    fetchEspelhoUsers(cid),
    fetchEspelhoDepartments(cid),
  ]);
  return {
    employees: mapApiEmployeesToEspelho(apiEmployees, userRows ?? []),
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
  employeeId?: string,
): Promise<{
  employees: AdminTimesheetEmployee[];
  departments: AdminTimesheetDepartment[];
  records: DbRow[];
  shiftSchedules: DbRow[];
  holidays: AdminHolidayRow[];
}> {
  const cid = String(companyId).trim();
  const uid = String(employeeId || '').trim();

  const [apiEmployees, userRows, departmentsRows, shiftsRows, holidaysRows] = await Promise.all([
    fetchEmployees(cid),
    fetchEspelhoUsers(cid),
    fetchEspelhoDepartments(cid),
    db.select('employee_shift_schedule', [{ column: 'company_id', operator: 'eq', value: cid }]).catch(() => []) as Promise<DbRow[]>,
    db
      .select('holidays', [{ column: 'company_id', operator: 'eq', value: cid }])
      .catch(() =>
        db.select('feriados', [{ column: 'company_id', operator: 'eq', value: cid }]).catch(() => []),
      ) as Promise<DbRow[]>,
  ]);

  const employees = mapApiEmployeesToEspelho(apiEmployees, userRows ?? []);
  const selectedEmployee = uid ? employees.find((employee) => employee.id === uid) : null;
  const recordUserIds = selectedEmployee?.record_user_ids?.length ? selectedEmployee.record_user_ids : uid ? [uid] : [];
  const recordFiltersBase: Filter[] = [{ column: 'company_id', operator: 'eq', value: cid }];
  const recordsRows = uid
    ? (
        await Promise.all(
          recordUserIds.map((recordUserId) =>
            fetchTimeRecordsForMirrorWindow(
              [...recordFiltersBase, { column: 'user_id', operator: 'eq', value: recordUserId }],
              periodStart,
              periodEnd,
              true,
              2000,
            ),
          ),
        )
      ).flat()
    : await fetchTimeRecordsForMirrorWindow(recordFiltersBase, periodStart, periodEnd, true, 8000);
  const recordsById = new Map<string, DbRow>();
  for (const row of recordsRows ?? []) {
    const id = String(row?.id ?? '').trim();
    if (id) recordsById.set(id, row);
  }
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
    records: Array.from(recordsById.values()),
    shiftSchedules: shiftsRows ?? [],
    holidays,
  };
}
