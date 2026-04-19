/**
 * Camada única de chamadas ao backend (Supabase) para espelho de ponto e listas relacionadas.
 * Centraliza Promise.all e evita fetch duplicado / ordem inconsistente entre telas.
 */

import { db } from './supabaseClient';
import {
  localCalendarDayEndUtc,
  localCalendarDayStartUtc,
} from '../src/utils/localDateTimeToIso';

export type AdminTimesheetEmployee = { id: string; nome: string; department_id?: string; role?: string };
export type AdminTimesheetDepartment = { id: string; name: string };
export type AdminHolidayRow = { id: string; date: string; name: string };

/** Colaboradores da empresa (admin / espelho). */
export async function buscarColaboradores(companyId: string): Promise<AdminTimesheetEmployee[]> {
  const rows = (await db.select('users', [{ column: 'company_id', operator: 'eq', value: companyId }])) as any[];
  return (rows ?? []).map((u: any) => ({
    id: u.id,
    nome: u.nome || u.email,
    department_id: u.department_id,
  }));
}

/** Departamentos da empresa. */
export async function buscarDepartamentos(companyId: string): Promise<AdminTimesheetDepartment[]> {
  const rows = (await db.select('departments', [{ column: 'company_id', operator: 'eq', value: companyId }])) as any[];
  return (rows ?? []).map((d: any) => ({ id: d.id, name: d.name }));
}

/** Junta `users` + `employees` (legacy) como na tela Colaboradores — sem excluir admin. */
function mergeEmployeesForEspelho(usersRows: any[], legacyRows: any[]): AdminTimesheetEmployee[] {
  const byEmail = new Map(
    (usersRows ?? [])
      .filter((u: any) => u?.email)
      .map((u: any) => [String(u.email).toLowerCase().trim(), u.id as string]),
  );
  const fromUsers: AdminTimesheetEmployee[] = (usersRows ?? []).map((u: any) => ({
    id: u.id,
    nome: u.nome || u.email || 'Colaborador',
    department_id: u.department_id,
    role: u.role,
  }));
  const fromLegacy: AdminTimesheetEmployee[] = (legacyRows ?? [])
    .filter((e: any) => {
      const email = String(e?.email || '')
        .trim()
        .toLowerCase();
      if (!email) return false;
      return !byEmail.has(email);
    })
    .map((e: any) => ({
      id: String(e.id || ''),
      nome: e.nome || e.nome_completo || e.email || 'Colaborador',
      department_id: e.department_id || e.departamento_id,
      role: e.role,
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
  const [usersRows, departmentsRows, legacyRows] = await Promise.all([
    db.select('users', [{ column: 'company_id', operator: 'eq', value: companyId }]) as Promise<any[]>,
    db.select('departments', [{ column: 'company_id', operator: 'eq', value: companyId }]) as Promise<any[]>,
    db.select('employees', [{ column: 'company_id', operator: 'eq', value: companyId }]).catch(() => []) as Promise<any[]>,
  ]);
  return {
    employees: mergeEmployeesForEspelho(usersRows, legacyRows),
    departments: (departmentsRows ?? []).map((d: any) => ({ id: d.id, name: d.name })),
  };
}

/** Registros de ponto no período (empresa). */
export async function buscarEspelhoRegistros(
  companyId: string,
  periodStart: string,
  periodEnd: string,
): Promise<any[]> {
  const periodStartTs = localCalendarDayStartUtc(periodStart);
  const periodEndTs = localCalendarDayEndUtc(periodEnd);
  return (
    (await db.select(
      'time_records',
      [
        { column: 'company_id', operator: 'eq', value: companyId },
        { column: 'created_at', operator: 'gte', value: periodStartTs },
        { column: 'created_at', operator: 'lte', value: periodEndTs },
      ],
      { column: 'created_at', ascending: false },
      1000,
    )) ?? []
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
  records: any[];
  shiftSchedules: any[];
  holidays: AdminHolidayRow[];
}> {
  const periodStartTs = localCalendarDayStartUtc(periodStart);
  const periodEndTs = localCalendarDayEndUtc(periodEnd);

  const [usersRows, recordsRows, departmentsRows, legacyEmployeesRows, shiftsRows, holidaysRows] = await Promise.all([
    db.select('users', [{ column: 'company_id', operator: 'eq', value: companyId }]) as Promise<any[]>,
    db.select(
      'time_records',
      [
        { column: 'company_id', operator: 'eq', value: companyId },
        { column: 'created_at', operator: 'gte', value: periodStartTs },
        { column: 'created_at', operator: 'lte', value: periodEndTs },
      ],
      { column: 'created_at', ascending: true },
      8000,
    ) as Promise<any[]>,
    db.select('departments', [{ column: 'company_id', operator: 'eq', value: companyId }]) as Promise<any[]>,
    db.select('employees', [{ column: 'company_id', operator: 'eq', value: companyId }]).catch(() => []) as Promise<any[]>,
    db.select('employee_shift_schedule', [{ column: 'company_id', operator: 'eq', value: companyId }]).catch(() => []) as Promise<any[]>,
    db
      .select('holidays', [{ column: 'company_id', operator: 'eq', value: companyId }])
      .catch(() =>
        db.select('feriados', [{ column: 'company_id', operator: 'eq', value: companyId }]).catch(() => []),
      ) as Promise<any[]>,
  ]);

  const employees = mergeEmployeesForEspelho(usersRows, legacyEmployeesRows);
  const departments: AdminTimesheetDepartment[] = (departmentsRows ?? []).map((d: any) => ({
    id: d.id,
    name: d.name,
  }));
  const holidays: AdminHolidayRow[] = (holidaysRows ?? []).map((h: any) => ({
    id: h.id,
    date: String(h.date || h.data || '').slice(0, 10),
    name: h.name || h.descricao || 'Feriado',
  }));

  return {
    employees,
    departments,
    records: recordsRows ?? [],
    shiftSchedules: shiftsRows ?? [],
    holidays,
  };
}
