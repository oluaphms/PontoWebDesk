import { observabilityConsole } from '../shared/logger/observabilityConsole';
/**
 * Serviço de cálculo de Pré-Folha (jornada de trabalho).
 * Responsável por calcular horas trabalhadas, extras, faltas e noturnas.
 * NÃO calcula valores monetários (salários, impostos) - foco apenas em jornada.
 */

import { db, checkSupabaseConfigured, isSupabaseConfigured, type DbRow } from './supabaseClient';
import { processEmployeeDay } from '../engine/timeEngine';
import {
  buildPersistDayDecisionTree,
  snapshotPunchesFromRecords,
  type CalculationDecisionStep,
  type CalculationTraceSource,
} from './timesheetCalculationAudit';
import {
  fetchUserScheduleId,
  getDayRecords,
  resolveEmployeeScheduleForDate,
  summarizeDayRecords,
} from './timeProcessingService';
import { writeTimesheetsDailyCalculatedRow, type TimesheetWriteOutcome } from './timesheetsDailyWrite';
import { validateTimesheetIntegrity } from './timesheetIntegrity';
import {
  derivePeriodHealth,
  processingStatusFromWrite,
  type PeriodHealthStatus,
  type TimesheetProcessingStatus,
} from './timesheetProcessingStatus';

// ============ TIPOS ============

export interface DailyTimesheet {
  id?: string;
  employee_id: string;
  company_id: string;
  date: string; // YYYY-MM-DD
  worked_minutes: number;
  expected_minutes: number;
  overtime_minutes: number;
  absence_minutes: number;
  night_minutes: number;
  late_minutes: number;
  is_absence: boolean;
  is_holiday: boolean;
  raw_data?: Record<string, unknown>;
  calculation_audit?: {
    punches: unknown[];
    schedule_used: unknown;
    correlation_id?: string;
    calculation_type?: 'normal' | 'fallback';
    used_schedule_id?: string | null;
    ignored_punch_ids?: string[];
    promoted_punch_ids?: string[];
    trace_source?: CalculationTraceSource;
    decision_tree?: CalculationDecisionStep[];
  };
}

export interface PayrollSummary {
  id?: string;
  employee_id: string;
  company_id: string;
  employee_name?: string;
  period_start: string;
  period_end: string;
  total_worked_minutes: number;
  total_expected_minutes: number;
  total_overtime_minutes: number;
  total_absence_minutes: number;
  total_night_minutes: number;
  total_late_minutes: number;
  total_work_days: number;
  total_absence_days: number;
  status: 'draft' | 'calculated' | 'exported';
  calculated_at?: string;
  notes?: string;
}

export interface CalculatedPayrollRow {
  employee_id: string;
  employee_name: string;
  email?: string;
  worked_hours: number;
  expected_hours: number;
  overtime_hours: number;
  absence_hours: number;
  night_hours: number;
  late_hours: number;
  work_days: number;
  absence_days: number;
}

// ============ CONSTANTES ============

const DEFAULT_EXPECTED_MINUTES = 480; // 8 horas
const NIGHT_START_HOUR = 22; // 22:00
const NIGHT_END_HOUR = 5; // 05:00

// ============ FUNÇÕES DE CÁLCULO DIÁRIO ============

/**
 * Calcula o timesheet diário baseado nas batidas do funcionário.
 * Regras:
 * - worked_minutes: total de minutos trabalhados (entrada até saída - intervalos)
 * - expected_minutes: jornada esperada (padrão 8h = 480min)
 * - overtime: excedente sobre esperado
 * - absence: faltante quando não atinge o esperado
 * - night_minutes: minutos entre 22h e 5h
 */
export async function calculateDailyTimesheet(
  employeeId: string,
  companyId: string,
  dateStr: string,
  expectedMinutes: number = DEFAULT_EXPECTED_MINUTES
): Promise<DailyTimesheet> {
  const day = await processEmployeeDay(employeeId, companyId, dateStr);
  const [records, resolvedSch, usedScheduleId] = await Promise.all([
    getDayRecords(employeeId, dateStr),
    resolveEmployeeScheduleForDate(employeeId, companyId, dateStr),
    fetchUserScheduleId(employeeId),
  ]);
  const expectedMin =
    typeof day.daily.expected_minutes === 'number' && Number.isFinite(day.daily.expected_minutes)
      ? day.daily.expected_minutes
      : expectedMinutes;
  const isAbsence = day.daily.absence_minutes > 0;
  const calculation_type = day.daily.contingency_schedule_fallback ? ('fallback' as const) : ('normal' as const);
  const schedule_used =
    resolvedSch.schedule != null
      ? { ...resolvedSch.schedule }
      : { no_schedule: true, js_day_of_week: resolvedSch.jsDayOfWeek };
  const punchSummary = summarizeDayRecords(records);
  const hadEntradaSaidaPair = Boolean(punchSummary.entrada && punchSummary.saida);
  const missingClockOut = Boolean(punchSummary.entrada && !punchSummary.saida);
  const decision_tree = buildPersistDayDecisionTree({
    hasScheduleForDay: resolvedSch.schedule != null,
    usedScheduleId: usedScheduleId,
    punchCount: records.length,
    hadEntradaSaidaPair,
    contingencyScheduleFallback: day.daily.contingency_schedule_fallback === true,
    incomplete: day.daily.incomplete === true,
    missingClockOut,
  });

  return {
    employee_id: employeeId,
    company_id: companyId,
    date: dateStr,
    worked_minutes: day.daily.total_worked_minutes,
    expected_minutes: expectedMin,
    overtime_minutes: (day.overtime?.overtime_50_minutes ?? 0) + (day.overtime?.overtime_100_minutes ?? 0),
    absence_minutes: day.daily.absence_minutes,
    night_minutes: day.night_minutes,
    late_minutes: day.daily.late_minutes,
    is_absence: isAbsence,
    is_holiday: day.daily.day_type === 'HOLIDAY',
    raw_data: {
      day_type: day.daily.day_type,
      overtime_50_minutes: day.daily.extra_50_minutes,
      overtime_100_minutes: day.daily.extra_100_minutes,
      entrada: day.daily.entrada,
      saida: day.daily.saida,
      inicio_intervalo: day.daily.inicio_intervalo,
      fim_intervalo: day.daily.fim_intervalo,
      incomplete: day.daily.incomplete,
      has_schedule_issue: day.daily.contingency_schedule_fallback === true,
      contingency_schedule_fallback: day.daily.contingency_schedule_fallback === true,
    },
    calculation_audit: {
      punches: snapshotPunchesFromRecords(records),
      schedule_used,
      calculation_type,
      used_schedule_id: usedScheduleId,
      decision_tree,
    },
  };
}

/**
 * Salva ou atualiza o cálculo diário no banco de dados.
 */
export async function saveDailyTimesheet(data: DailyTimesheet): Promise<{
  id: string;
  outcome: TimesheetWriteOutcome;
  processing_status: TimesheetProcessingStatus;
}> {
  if (!checkSupabaseConfigured()) throw new Error('Supabase não configurado.');

  const payload = {
    employee_id: data.employee_id,
    company_id: data.company_id,
    date: data.date,
    worked_minutes: data.worked_minutes,
    expected_minutes: data.expected_minutes,
    overtime_minutes: data.overtime_minutes,
    absence_minutes: data.absence_minutes,
    night_minutes: data.night_minutes,
    late_minutes: data.late_minutes,
    is_absence: data.is_absence,
    is_holiday: data.is_holiday,
    raw_data: data.raw_data || {},
    updated_at: new Date().toISOString(),
    calculation_audit: data.calculation_audit,
  };

  try {
    const wr = await writeTimesheetsDailyCalculatedRow(payload);
    const id = wr.id ?? `temp-${data.employee_id}-${data.date}`;
    return { id, outcome: wr.outcome, processing_status: wr.processing_status };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const raw = data.raw_data || {};
    if (msg.includes('relation') || msg.includes('does not exist')) {
      observabilityConsole.warn('[saveDailyTimesheet] Tabela timesheets_daily não existe. Execute a migração: 20260417230000_pre_folha_tables.sql');
      return {
        id: `temp-${data.employee_id}-${data.date}`,
        outcome: 'skipped_integrity',
        processing_status: processingStatusFromWrite('skipped_integrity', raw as Record<string, unknown>),
      };
    }
    observabilityConsole.info('[CALC INFO] saveDailyTimesheet_failed', { date: data.date, message: msg });
    return {
      id: `temp-${data.employee_id}-${data.date}`,
      outcome: 'skipped_integrity',
      processing_status: processingStatusFromWrite('skipped_integrity', raw as Record<string, unknown>),
    };
  }
}

// ============ FUNÇÕES DE CONSOLIDAÇÃO ============

/**
 * Gera o resumo de pré-folha para um funcionário no período.
 * Consolida todos os cálculos diários em totais.
 */
export async function generatePayrollSummary(
  employeeId: string,
  companyId: string,
  startDate: string,
  endDate: string,
  autoCalculate: boolean = true
): Promise<PayrollSummary> {
  if (!checkSupabaseConfigured()) throw new Error('Supabase não configurado.');

  // Se solicitado, calcula todos os dias do período primeiro
  if (autoCalculate) {
    await calculatePeriodTimesheets(employeeId, companyId, startDate, endDate);
  }

  // Busca os dados consolidados
  const result = await db.rpc?.('calculate_payroll_summary', {
    p_employee_id: employeeId,
    p_company_id: companyId,
    p_start_date: startDate,
    p_end_date: endDate,
  }) as any;

  // Se a função RPC não existir, calcula manualmente
  if (!result?.data) {
    return await calculatePayrollSummaryManual(employeeId, companyId, startDate, endDate);
  }

  const data = result.data;
  
  return {
    employee_id: data.employee_id,
    company_id: companyId,
    period_start: data.period_start,
    period_end: data.period_end,
    total_worked_minutes: data.total_worked_minutes,
    total_expected_minutes: data.total_expected_minutes,
    total_overtime_minutes: data.total_overtime_minutes,
    total_absence_minutes: data.total_absence_minutes,
    total_night_minutes: data.total_night_minutes,
    total_late_minutes: data.total_late_minutes,
    total_work_days: data.total_work_days,
    total_absence_days: data.total_absence_days,
    status: 'calculated',
    calculated_at: new Date().toISOString(),
  };
}

/**
 * Calcula manualmente o resumo (fallback se RPC não disponível).
 */
async function calculatePayrollSummaryManual(
  employeeId: string,
  companyId: string,
  startDate: string,
  endDate: string
): Promise<PayrollSummary> {
  let dailyRecords: any[] = [];
  
  try {
    dailyRecords = await db.select('timesheets_daily', [
      { column: 'employee_id', operator: 'eq', value: employeeId },
      { column: 'company_id', operator: 'eq', value: companyId },
      { column: 'date', operator: 'gte', value: startDate },
      { column: 'date', operator: 'lte', value: endDate },
    ]) as any[];
  } catch (err: any) {
    // Se a tabela não existe ou há erro de permissão, continua com array vazio
    if (err?.message?.includes('relation') || 
        err?.message?.includes('does not exist') ||
        err?.status === 400 ||
        err?.status === 404) {
      observabilityConsole.warn(`[calculatePayrollSummaryManual] Tabela timesheets_daily não acessível para ${employeeId}:`, err?.message || 'Erro 400');
      dailyRecords = [];
    } else {
      throw err;
    }
  }

  let totalWorked = 0;
  let totalExpected = 0;
  let totalOvertime = 0;
  let totalAbsence = 0;
  let totalNight = 0;
  let totalLate = 0;
  let workDays = 0;
  let absenceDays = 0;

  for (const record of dailyRecords || []) {
    totalWorked += record.worked_minutes || 0;
    totalExpected += record.expected_minutes || 0;
    totalOvertime += record.overtime_minutes || 0;
    totalAbsence += record.absence_minutes || 0;
    totalNight += record.night_minutes || 0;
    totalLate += record.late_minutes || 0;
    
    if (record.worked_minutes > 0) workDays++;
    if (record.is_absence) absenceDays++;
  }

  return {
    employee_id: employeeId,
    company_id: companyId,
    period_start: startDate,
    period_end: endDate,
    total_worked_minutes: totalWorked,
    total_expected_minutes: totalExpected,
    total_overtime_minutes: totalOvertime,
    total_absence_minutes: totalAbsence,
    total_night_minutes: totalNight,
    total_late_minutes: totalLate,
    total_work_days: workDays,
    total_absence_days: absenceDays,
    status: 'calculated',
    calculated_at: new Date().toISOString(),
  };
}

export type PeriodCalcSummaryFinal = {
  total_processed: number;
  success_count: number;
  skipped_count: number;
  error_count: number;
  schedule_missing_count: number;
  fk_avoided_count: number;
  duration_ms: number;
  degraded: boolean;
  period_status: PeriodHealthStatus;
  reliability_score: number;
};

/**
 * Calcula o período e devolve linhas + telemetria (`period_status`, `reliability_score`).
 */
export async function calculatePeriodTimesheetsWithSummary(
  employeeId: string,
  companyId: string,
  startDate: string,
  endDate: string,
): Promise<{ rows: DailyTimesheet[]; summary: PeriodCalcSummaryFinal }> {
  const gate = await validateTimesheetIntegrity({ employee_id: employeeId, company_id: companyId });
  if (!gate.ok) {
    observabilityConsole.info('[CALC SKIP] period_calc_blocked', {
      employee_id: employeeId,
      company_id: companyId,
      reason: gate.reason,
    });
    throw new Error(`TIMESHEET_EMPLOYEE_INVALID:${gate.reason ?? 'unknown'}`);
  }

  const results: DailyTimesheet[] = [];
  const start = new Date(startDate);
  const end = new Date(endDate);
  const t0 = Date.now();

  let total_processed = 0;
  let success_count = 0;
  let skipped_count = 0;
  let error_count = 0;
  let schedule_missing_count = 0;
  let fk_avoided_count = 0;
  let degraded = false;

  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dateStr = d.toISOString().slice(0, 10);
    total_processed += 1;
    try {
      const timesheet = await calculateDailyTimesheet(employeeId, companyId, dateStr);
      if ((timesheet.raw_data as { has_schedule_issue?: boolean })?.has_schedule_issue) {
        schedule_missing_count += 1;
      }
      const save = await saveDailyTimesheet(timesheet);
      if (save.outcome === 'written') {
        success_count += 1;
      } else {
        skipped_count += 1;
      }
      if (save.outcome === 'skipped_integrity') {
        fk_avoided_count += 1;
      }
      results.push(timesheet);
    } catch (err: unknown) {
      error_count += 1;
      const msg = err instanceof Error ? err.message : String(err);
      observabilityConsole.info('[CALC INFO] period_day_failed', { date: dateStr, message: msg });
      results.push({
        employee_id: employeeId,
        company_id: companyId,
        date: dateStr,
        worked_minutes: 0,
        expected_minutes: 480,
        overtime_minutes: 0,
        absence_minutes: 0,
        night_minutes: 0,
        late_minutes: 0,
        is_absence: false,
        is_holiday: false,
        raw_data: { error: msg },
      });
    }

    if (total_processed >= 3 && error_count / total_processed > 0.3) {
      degraded = true;
      observabilityConsole.info('[CALC DEGRADED MODE]', {
        employee_id: employeeId,
        company_id: companyId,
        total_processed,
        error_count,
        threshold: '30%',
      });
      break;
    }
  }

  const duration_ms = Date.now() - t0;
  const baseMetrics = {
    total_processed,
    success_count,
    skipped_count,
    error_count,
    schedule_missing_count,
    fk_avoided_count,
    duration_ms,
    degraded,
  };
  const period_status = derivePeriodHealth({
    total_processed,
    success_count,
    skipped_count,
    error_count,
    schedule_missing_count,
    fk_avoided_count,
    duration_ms,
    degraded,
  });
  const reliability_score = total_processed > 0 ? success_count / total_processed : 1;

  const summary: PeriodCalcSummaryFinal = {
    ...baseMetrics,
    period_status,
    reliability_score,
  };

  observabilityConsole.info('[CALC PERIOD STATUS]', {
    employee_id: employeeId,
    company_id: companyId,
    start_date: startDate,
    end_date: endDate,
    period_status,
    reliability_score,
    total_processed,
    success_count,
    skipped_count,
    error_count,
    degraded,
  });

  if (period_status !== 'complete') {
    observabilityConsole.warn('[UI WARNING] dados incompletos no período', {
      employee_id: employeeId,
      company_id: companyId,
      period_status,
      reliability_score,
    });
  }

  observabilityConsole.log('[CALC SUMMARY FINAL]', {
    employee_id: employeeId,
    company_id: companyId,
    start_date: startDate,
    end_date: endDate,
    ...summary,
  });

  return { rows: results, summary };
}

/**
 * Calcula o timesheet para todos os dias de um período.
 */
export async function calculatePeriodTimesheets(
  employeeId: string,
  companyId: string,
  startDate: string,
  endDate: string,
): Promise<DailyTimesheet[]> {
  const { rows } = await calculatePeriodTimesheetsWithSummary(employeeId, companyId, startDate, endDate);
  return rows;
}

/**
 * Salva o resumo de pré-folha no banco.
 */
export async function savePayrollSummary(summary: PayrollSummary): Promise<string> {
  if (!checkSupabaseConfigured()) throw new Error('Supabase não configurado.');

  const payload = {
    employee_id: summary.employee_id,
    company_id: summary.company_id,
    period_start: summary.period_start,
    period_end: summary.period_end,
    total_worked_minutes: summary.total_worked_minutes,
    total_expected_minutes: summary.total_expected_minutes,
    total_overtime_minutes: summary.total_overtime_minutes,
    total_absence_minutes: summary.total_absence_minutes,
    total_night_minutes: summary.total_night_minutes,
    total_late_minutes: summary.total_late_minutes,
    total_work_days: summary.total_work_days,
    total_absence_days: summary.total_absence_days,
    status: summary.status,
    calculated_at: summary.calculated_at,
    notes: summary.notes,
    updated_at: new Date().toISOString(),
  };

  try {
    const existing = await db.select('payroll_summaries', [
      { column: 'employee_id', operator: 'eq', value: summary.employee_id },
      { column: 'period_start', operator: 'eq', value: summary.period_start },
      { column: 'period_end', operator: 'eq', value: summary.period_end },
    ]) as DbRow[];

    if (existing?.[0]?.id) {
      await db.update('payroll_summaries', String(existing[0].id), payload);
      return String(existing[0].id);
    } else {
      const result = (await db.insert('payroll_summaries', {
        ...payload,
        created_at: new Date().toISOString(),
      })) as DbRow;
      return result?.id != null ? String(result.id) : undefined;
    }
  } catch (err: unknown) {
    // Se a tabela não existe, loga e retorna ID simulado
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('relation') || msg.includes('does not exist')) {
      observabilityConsole.warn('[savePayrollSummary] Tabela payroll_summaries não existe. Execute a migração: 20260417230000_pre_folha_tables.sql');
      return `temp-${summary.employee_id}-${summary.period_start}`;
    }
    throw err;
  }
}

// ============ FUNÇÕES PARA MÚLTIPLOS FUNCIONÁRIOS ============

/**
 * Gera a pré-folha para todos os funcionários de uma empresa no período.
 */
export async function generateCompanyPayroll(
  companyId: string,
  startDate: string,
  endDate: string
): Promise<{ summaries: PayrollSummary[]; errors: string[] }> {
  if (!checkSupabaseConfigured()) throw new Error('Supabase não configurado.');
  
  // Validação de datas
  if (!startDate || !endDate || typeof startDate !== 'string' || typeof endDate !== 'string') {
    throw new Error('Período inválido. Datas de início e fim são obrigatórias.');
  }

  const errors: string[] = [];
  const summaries: PayrollSummary[] = [];

  // Busca funcionários ativos
  const users = await db.select('users', [
    { column: 'company_id', operator: 'eq', value: companyId },
  ]) as any[];

  const employees = (users || []).filter((u: any) => 
    u.role === 'employee' || u.role === 'hr'
  );

  for (const emp of employees) {
    try {
      // Calcula e salva o resumo
      const summary = await generatePayrollSummary(
        emp.id,
        companyId,
        startDate,
        endDate,
        true // auto-calculate
      );
      summary.employee_name = emp.nome || emp.email || 'Sem nome';
      
      await savePayrollSummary(summary);
      summaries.push(summary);
    } catch (e: any) {
      errors.push(`${emp.nome || emp.id}: ${e.message || 'Erro'}`);
    }
  }

  return { summaries, errors };
}

/**
 * Busca resumos de pré-folha já calculados.
 */
export async function getPayrollSummaries(
  companyId: string,
  startDate: string,
  endDate: string
): Promise<CalculatedPayrollRow[]> {
  if (!isSupabaseConfigured()) return [];
  
  // Validação de datas
  if (!startDate || !endDate || typeof startDate !== 'string' || typeof endDate !== 'string') {
    observabilityConsole.warn('[getPayrollSummaries] Datas inválidas:', { startDate, endDate });
    return [];
  }

  // Busca resumos calculados
  let summaries: any[] = [];
  try {
    summaries = await db.select('payroll_summaries', [
      { column: 'company_id', operator: 'eq', value: companyId },
      { column: 'period_start', operator: 'eq', value: startDate },
      { column: 'period_end', operator: 'eq', value: endDate },
    ]) as any[];
  } catch (err: any) {
    // Se a tabela não existe, retorna array vazio
    if (err?.message?.includes('relation') || err?.message?.includes('does not exist')) {
      observabilityConsole.warn('[getPayrollSummaries] Tabela payroll_summaries não existe. Execute a migração.');
      return [];
    }
    throw err;
  }

  if (summaries?.length > 0) {
    // Busca nomes dos funcionários
    const employeeIds = summaries.map(s => s.employee_id);
    const users = await db.select('users', [
      { column: 'company_id', operator: 'eq', value: companyId },
    ]) as any[];

    const userMap = new Map((users || []).map((u: any) => [u.id, u]));

    return summaries.map(s => {
      const user = userMap.get(s.employee_id);
      return {
        employee_id: s.employee_id,
        employee_name: user?.nome || user?.email || 'Sem nome',
        email: user?.email,
        worked_hours: Math.round((s.total_worked_minutes / 60) * 100) / 100,
        expected_hours: Math.round((s.total_expected_minutes / 60) * 100) / 100,
        overtime_hours: Math.round((s.total_overtime_minutes / 60) * 100) / 100,
        absence_hours: Math.round((s.total_absence_minutes / 60) * 100) / 100,
        night_hours: Math.round((s.total_night_minutes / 60) * 100) / 100,
        late_hours: Math.round((s.total_late_minutes / 60) * 100) / 100,
        work_days: s.total_work_days || 0,
        absence_days: s.total_absence_days || 0,
      };
    });
  }

  return [];
}

/**
 * Marca um resumo como exportado.
 */
export async function markAsExported(
  summaryId: string,
  notes?: string
): Promise<void> {
  if (!isSupabaseConfigured()) return;
  
  await db.update('payroll_summaries', summaryId, {
    status: 'exported',
    exported_at: new Date().toISOString(),
    notes: notes || null,
  });
}

// ============ UTILITÁRIOS ============

/**
 * Converte minutos para formato de horas (ex: 480 -> "08:00").
 */
export function minutesToHours(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

/**
 * Converte minutos para horas decimais (ex: 480 -> 8.00).
 */
export function minutesToDecimalHours(minutes: number): number {
  return Math.round((minutes / 60) * 100) / 100;
}

/**
 * Retorna o intervalo de datas de um mês.
 */
export function getMonthPeriod(year: number, month: number): { start: string; end: string } {
  const start = `${year}-${String(month).padStart(2, '0')}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const end = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  return { start, end };
}
