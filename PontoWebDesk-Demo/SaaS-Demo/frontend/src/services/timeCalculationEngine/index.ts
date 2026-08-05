/**
 * Engine de cálculo trabalhista
 * Fluxo: time_records → punchInterpreter → escala → jornada → banco de horas
 */

import { db, isSupabaseConfigured } from '../../../services/supabaseClient';
import { interpretPunchSequence } from '../punchInterpreter';
import { processEmployeeDay } from '../../engine/timeEngine';

export interface WorkdayCalculationResult {
  employee_id: string;
  date: string;
  company_id: string;
  horas_trabalhadas: number;
  horas_extras: number;
  atrasos: number;
  faltas: number;
  saldo_banco_horas: number;
  interpretation_status: 'normal' | 'corrigido' | 'suspeito';
  pairs: { entrada: string; saida: string }[];
}

/**
 * Calcula a jornada do dia para um funcionário: horas trabalhadas, extras, atrasos, faltas, banco.
 */
export async function calculateWorkday(
  employeeId: string,
  date: string,
  companyId: string
): Promise<WorkdayCalculationResult> {
  const unifiedDay = await processEmployeeDay(employeeId, companyId, date);
  const result: WorkdayCalculationResult = {
    employee_id: employeeId,
    date,
    company_id: companyId,
    horas_trabalhadas: 0,
    horas_extras: 0,
    atrasos: 0,
    faltas: 0,
    saldo_banco_horas: 0,
    interpretation_status: 'normal',
    pairs: [],
  };

  const interpretation = await interpretPunchSequence(employeeId, date);
  result.interpretation_status = interpretation.status;
  result.pairs = interpretation.pairs;

  result.horas_trabalhadas = Math.round(unifiedDay.daily.total_worked_minutes) / 60;
  result.horas_extras = Math.round(unifiedDay.daily.extra_minutes) / 60;
  result.atrasos = Math.round(unifiedDay.daily.late_minutes) / 60;
  result.faltas = Math.round(unifiedDay.daily.absence_minutes) / 60;

  // Escala esperada (work_shifts via user -> schedule -> shift)
  const userRows = (await db.select('users', [{ column: 'id', operator: 'eq', value: employeeId }], undefined, 1)) as { schedule_id?: string }[];
  const scheduleId = userRows?.[0]?.schedule_id;
  if (!scheduleId) return result;

  const scheduleRows = (await db.select('schedules', [{ column: 'id', operator: 'eq', value: scheduleId }], undefined, 1)) as { shift_id?: string }[];
  const shiftId = scheduleRows?.[0]?.shift_id;
  if (!shiftId) return result;

  const shiftRows = (await db.select('work_shifts', [{ column: 'id', operator: 'eq', value: shiftId }], undefined, 1)) as {
    start_time?: string;
    end_time?: string;
    break_minutes?: number;
    tolerancia_entrada?: number;
    limite_horas_dia?: number;
    banco_horas?: boolean;
  }[];
  const shift = shiftRows?.[0];
  if (!shift) return result;

  // Saldo banco de horas (último registro da tabela bank_hours para o funcionário até a data)
  if (shift.banco_horas && isSupabaseConfigured()) {
    const bankRows = (await db.select(
      'bank_hours',
      [
        { column: 'employee_id', operator: 'eq', value: employeeId },
        { column: 'date', operator: 'lte', value: date },
      ],
      { column: 'date', ascending: false },
      1
    )) as { balance?: number }[];
    result.saldo_banco_horas = bankRows?.[0]?.balance ?? 0;
  }

  return result;
}
