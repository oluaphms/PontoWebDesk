/**
 * Camada única de chamadas ao backend (Supabase) para espelho de ponto e listas relacionadas.
 * Centraliza Promise.all e evita fetch duplicado / ordem inconsistente entre telas.
 */

import { db } from './supabaseClient';

export type AdminTimesheetEmployee = { id: string; nome: string; department_id?: string };
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

/** Registros de ponto no período (empresa). */
export async function buscarEspelhoRegistros(
  companyId: string,
  periodStart: string,
  periodEnd: string,
): Promise<any[]> {
  const periodStartTs = `${periodStart}T00:00:00`;
  const periodEndTs = `${periodEnd}T23:59:59.999`;
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
  const periodStartTs = `${periodStart}T00:00:00`;
  const periodEndTs = `${periodEnd}T23:59:59.999`;

  const [usersRows, recordsRows, departmentsRows, shiftsRows, holidaysRows] = await Promise.all([
    db.select('users', [{ column: 'company_id', operator: 'eq', value: companyId }]) as Promise<any[]>,
    db.select(
      'time_records',
      [
        { column: 'company_id', operator: 'eq', value: companyId },
        { column: 'created_at', operator: 'gte', value: periodStartTs },
        { column: 'created_at', operator: 'lte', value: periodEndTs },
      ],
      { column: 'created_at', ascending: false },
      1000,
    ) as Promise<any[]>,
    db.select('departments', [{ column: 'company_id', operator: 'eq', value: companyId }]) as Promise<any[]>,
    db.select('employee_shift_schedule', [{ column: 'company_id', operator: 'eq', value: companyId }]).catch(() => []) as Promise<any[]>,
    db.select('feriados', [{ column: 'company_id', operator: 'eq', value: companyId }]).catch(() => []) as Promise<any[]>,
  ]);

  const employees: AdminTimesheetEmployee[] = (usersRows ?? []).map((u: any) => ({
    id: u.id,
    nome: u.nome || u.email,
    department_id: u.department_id,
  }));
  const departments: AdminTimesheetDepartment[] = (departmentsRows ?? []).map((d: any) => ({
    id: d.id,
    name: d.name,
  }));
  const holidays: AdminHolidayRow[] = (holidaysRows ?? []).map((h: any) => ({
    id: h.id,
    date: (h.data || h.date || '').slice(0, 10),
    name: h.descricao || h.name || 'Feriado',
  }));

  return {
    employees,
    departments,
    records: recordsRows ?? [],
    shiftSchedules: shiftsRows ?? [],
    holidays,
  };
}
