import { observabilityConsole } from '../shared/logger/observabilityConsole';
/**
 * Motor avançado de jornada e escalas (SmartPonto).
 * Interpreta escalas, valida marcações, detecta inconsistências,
 * calcula jornada, horas extras, noturnas, DSR e banco de horas.
 */

import { db, isSupabaseConfigured } from '../services/supabaseClient';
import { buildPersistDayDecisionTree, snapshotPunchesFromRecords } from '../services/timesheetCalculationAudit';
import { writeTimesheetsDailyCalculatedRow } from '../services/timesheetsDailyWrite';
import { appendAfdTimeEngineAudit } from './afdTimeEngineAudit';
import { appendEngineCalcAudit } from './engineCalcAudit';
import { applyDailyBankLedger, getBankExpiredToPayroll50ForPeriod } from './bankLedger';
import {
  getDayRecords,
  fetchUserScheduleId,
  processDailyTime,
  resolveEmployeeScheduleForDate,
  summarizeDayRecords,
  updateBankHours,
  type RawTimeRecord,
  type WorkScheduleInfo,
  type DailyProcessResult,
  normalizePunchType,
} from '../services/timeProcessingService';

export type ShiftType = 'fixed' | 'flexible' | '6x1' | '5x2' | '12x36' | '24x72' | 'custom';

export type ParsedPunchType = 'entrada' | 'saida' | 'inicio_intervalo' | 'fim_intervalo';

export interface ParsedSegment {
  type: ParsedPunchType;
  at: Date;
  recordId: string;
}

/** Sequência interpretada: um ou mais pares entrada->saída, com opcional inicio_intervalo->fim_intervalo */
export interface ParsedDay {
  date: string;
  segments: ParsedSegment[];
  sequences: { entrada: Date; saida: Date; inicioIntervalo?: Date; fimIntervalo?: Date }[];
  totalWorkedMinutes: number;
  breakMinutes: number;
}

export type InconsistencyType =
  | 'missing_entry'
  | 'missing_exit'
  | 'missing_break'
  | 'duplicate_records'
  | 'invalid_sequence';

export interface TimeInconsistency {
  employee_id: string;
  date: string;
  type: InconsistencyType;
  description: string;
}

export interface OvertimeResult {
  date: string;
  overtime_50_minutes: number;
  overtime_100_minutes: number;
  is_holiday_or_off: boolean;
}

export type DayType = 'HOLIDAY' | 'SUNDAY' | 'SATURDAY' | 'WEEKDAY';

export interface CompanyRules {
  work_on_saturday: boolean;
  saturday_overtime_type: '50' | '100';
  time_bank_enabled: boolean;
  tolerance_minutes: number;
  night_additional_percent: number;
  dsr_enabled: boolean;
  /** Se false, negativa não usa saldo BH (vai inteira como desconto). */
  allow_auto_compensation: boolean;
  /** Excedente além das primeiras 2h úteis: 50% ou 100% conforme política. */
  weekday_extra_above_120: '50' | '100';
  bank_hours_expiry_months: number;
  /** Destino HE: BH, folha ou misto (teto BH/dia antes da folha). */
  extra_payroll_policy: 'bank' | 'payroll' | 'mixed';
  /** Em `mixed`: minutos de extra máximos no BH naquele dia; resto vai à folha. */
  mixed_extra_bank_cap_minutes: number;
}

export interface DayClassificationInput {
  date: string;
  employee?: { id?: string; city?: string; state?: string } | null;
  company: { id?: string; city?: string; state?: string };
}

export interface OvertimeCalculationContext {
  date: string;
  dayType: DayType;
  workedMinutes: number;
  expectedMinutes: number;
  companyRules: CompanyRules;
  schedule: WorkScheduleInfo | null;
}

export interface NightRuleResult {
  payableNightMinutes: number;
  reducedNightMinutes: number;
  additionalMinutes: number;
}

export function getBrazilianFixedHolidays(): string[] {
  return ['01-01', '04-21', '05-01', '09-07', '10-12', '11-02', '11-15', '12-25'];
}

export function isNationalHoliday(date: string): boolean {
  const dateStr = date.slice(0, 10);
  const md = dateStr.slice(5);
  return getBrazilianFixedHolidays().includes(md);
}

export function getNationalHolidayDatesForPeriod(startDate: string, endDate: string): Set<string> {
  const startYear = Number(startDate.slice(0, 4));
  const endYear = Number(endDate.slice(0, 4));
  const out = new Set<string>();
  if (!Number.isFinite(startYear) || !Number.isFinite(endYear)) return out;
  const fixed = getBrazilianFixedHolidays();
  for (let year = startYear; year <= endYear; year++) {
    for (const md of fixed) {
      const dateStr = `${year}-${md}`;
      if (dateStr >= startDate && dateStr <= endDate) {
        out.add(dateStr);
      }
    }
  }
  return out;
}

const DEFAULT_COMPANY_RULES: CompanyRules = {
  work_on_saturday: false,
  saturday_overtime_type: '100',
  time_bank_enabled: false,
  tolerance_minutes: 10,
  night_additional_percent: 20,
  dsr_enabled: true,
  allow_auto_compensation: true,
  weekday_extra_above_120: '50',
  bank_hours_expiry_months: 6,
  extra_payroll_policy: 'bank',
  mixed_extra_bank_cap_minutes: 120,
};

/** Produção HARD LOCK — `false` apenas via env explícito. */
export const STRICT_SCHEDULE_MODE =
  import.meta.env?.VITE_STRICT_SCHEDULE_MODE !== 'false';

function contingencyFallbackExpectedMinutes(dayType: DayType): number {
  return dayType === 'SATURDAY' ? 240 : 480;
}

export interface DaySummary {
  date: string;
  daily: DailyProcessResult & {
    missing_minutes: number;
    negative_minutes: number;
    extra_minutes: number;
    extra_50_minutes: number;
    extra_100_minutes: number;
    absence_minutes: number;
    incomplete: boolean;
    day_type: DayType;
    /** Extra enviado ao BH (motor separa de folha). */
    extra_banco_minutes?: number;
    /** HE 50%/100% apenas na folha (pós‑roteamento de política). */
    extra_folha_50_minutes?: number;
    extra_folha_100_minutes?: number;
    negativo_banco_minutes?: number;
    negativo_folha_minutes?: number;
    /** Fallback 480/240 — existe só se STRICT_SCHEDULE_MODE=false; sempre audível. */
    contingency_schedule_fallback?: boolean;
    /** Gap após abatimento do BH (valor que segue como desconto em folha). */
    payroll_negative_after_bank_minutes?: number;
    bank_compensated_minutes?: number;
    /** Adicional noturno (52m30s) associado ao trecho extraordinário do dia (minutos pagáveis). */
    extra_noturna_payable_minutes?: number;
    /** Crédito lançado no BH neste dia (min). */
    bank_credited_minutes?: number;
  };
  inconsistencies: TimeInconsistency[];
  overtime: OvertimeResult | null;
  night_minutes: number;
  night_normal_reduced_minutes?: number;
  night_extra_reduced_minutes?: number;
  dsr_minutes?: number;
  dsr_extra_50_minutes?: number;
  dsr_extra_100_minutes?: number;
  bank_hours_delta?: number;
}

const MS_PER_MINUTE = 60 * 1000;
const NIGHT_START_MIN = 22 * 60;
const NIGHT_END_MIN = 5 * 60;
const MAX_WORK_MINUTES_PER_DAY = 16 * 60;
const MIN_BREAK_IF_WORK_OVER = 6 * 60;
const FRAUD_MIN_INTERVAL_MS = 60 * 1000;
const HOLIDAY_CACHE = new Map<string, Set<string>>();

type CalcMetrics = {
  schedule_missing_count: number;
  fk_avoided_count: number;
  calc_errors: number;
};

let calcMetrics: CalcMetrics = {
  schedule_missing_count: 0,
  fk_avoided_count: 0,
  calc_errors: 0,
};

function resetCalcMetrics(): void {
  calcMetrics = {
    schedule_missing_count: 0,
    fk_avoided_count: 0,
    calc_errors: 0,
  };
}

function logCalcSummaryFinal(context: Record<string, unknown>): void {
  observabilityConsole.log('[CALC SUMMARY FINAL]', {
    ...context,
    ...calcMetrics,
  });
}

function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

function ymdFromUtc(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function addDaysUtc(base: Date, days: number): Date {
  const out = new Date(base);
  out.setUTCDate(out.getUTCDate() + days);
  return out;
}

export function getBrazilianHolidays(year: number, location?: string): Set<string> {
  const key = `${year}:${(location || 'BR').toUpperCase()}`;
  const cached = HOLIDAY_CACHE.get(key);
  if (cached) return cached;

  const holidays = new Set<string>();
  // Feriados nacionais fixos
  getBrazilianFixedHolidays().forEach((md) => {
    holidays.add(`${year}-${md}`);
  });

  // Feriados móveis nacionais
  const easter = easterSunday(year);
  holidays.add(ymdFromUtc(addDaysUtc(easter, -47))); // Carnaval (terça)
  holidays.add(ymdFromUtc(addDaysUtc(easter, -2))); // Sexta-feira Santa
  holidays.add(ymdFromUtc(addDaysUtc(easter, 60))); // Corpus Christi

  HOLIDAY_CACHE.set(key, holidays);
  return holidays;
}

async function getManualHolidayDates(companyId: string, year: number): Promise<Set<string>> {
  if (!isSupabaseConfigured() || !companyId) return new Set();
  const out = new Set<string>();
  const start = `${year}-01-01`;
  const end = `${year}-12-31`;
  const normalize = (v: unknown): string | null => {
    if (!v) return null;
    const s = String(v).slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
  };
  try {
    const holidayRows = (await db.select(
      'holidays',
      [
        { column: 'company_id', operator: 'eq', value: companyId },
        { column: 'date', operator: 'gte', value: start },
        { column: 'date', operator: 'lte', value: end },
      ]
    )) as Array<{ date?: string }>;
    for (const h of holidayRows || []) {
      const d = normalize(h.date);
      if (d) out.add(d);
    }
  } catch (err) {
    if (import.meta.env?.DEV) {
      observabilityConsole.warn('[timeEngine] Falha ao buscar feriados (holidays):', err);
    }
  }

  try {
    const legacyRows = (await db.select(
      'feriados',
      [
        { column: 'company_id', operator: 'eq', value: companyId },
        { column: 'data', operator: 'gte', value: start },
        { column: 'data', operator: 'lte', value: end },
      ]
    )) as Array<{ data?: string }>;
    for (const h of legacyRows || []) {
      const d = normalize(h.data);
      if (d) out.add(d);
    }
  } catch (err) {
    if (import.meta.env?.DEV) {
      observabilityConsole.warn('[timeEngine] Falha ao buscar feriados (feriados):', err);
    }
  }
  return out;
}

export async function isHoliday(date: string, company: { id?: string; city?: string; state?: string }): Promise<boolean> {
  const dateStr = date.slice(0, 10);
  const year = Number(dateStr.slice(0, 4));
  const manual = await getManualHolidayDates(company.id || '', year);
  return isNationalHoliday(dateStr) || manual.has(dateStr);
}

export async function classifyDay(input: DayClassificationInput): Promise<DayType> {
  const dateStr = input.date.slice(0, 10);
  const company = {
    id: input.company.id,
    city: input.employee?.city || input.company.city,
    state: input.employee?.state || input.company.state,
  };
  if (await isHoliday(dateStr, company)) return 'HOLIDAY';

  const dayOfWeek = new Date(`${dateStr}T12:00:00`).getDay();
  if (dayOfWeek === 0) return 'SUNDAY';
  if (dayOfWeek === 6) return 'SATURDAY';
  return 'WEEKDAY';
}

export async function getCompanyRules(companyId: string): Promise<CompanyRules> {
  if (!isSupabaseConfigured() || !companyId) return { ...DEFAULT_COMPANY_RULES };

  let fromCompanyRules: any = null;
  try {
    const rows = (await db.select('company_rules', [{ column: 'company_id', operator: 'eq', value: companyId }], undefined, 1)) as any[];
    fromCompanyRules = rows?.[0] ?? null;
  } catch (err) {
    if (import.meta.env?.DEV) {
      observabilityConsole.warn('[timeEngine] Falha ao buscar company_rules:', err);
    }
  }

  let overtimeRules: any = null;
  try {
    const rows = (await db.select('overtime_rules', [{ column: 'company_id', operator: 'eq', value: companyId }], undefined, 1)) as any[];
    overtimeRules = rows?.[0] ?? null;
  } catch (err) {
    if (import.meta.env?.DEV) {
      observabilityConsole.warn('[timeEngine] Falha ao buscar overtime_rules:', err);
    }
  }

  let globalSettings: any = null;
  try {
    const rows = (await db.select('global_settings', [], undefined, 1)) as any[];
    globalSettings = rows?.[0] ?? null;
  } catch (err) {
    if (import.meta.env?.DEV) {
      observabilityConsole.warn('[timeEngine] Falha ao buscar global_settings:', err);
    }
  }

  const workOnSaturday = Boolean(
    fromCompanyRules?.work_on_saturday ??
      overtimeRules?.work_on_saturday ??
      overtimeRules?.saturday_is_workday ??
      false
  );
  const saturdayTypeRaw = String(
    fromCompanyRules?.saturday_overtime_type ??
      overtimeRules?.saturday_overtime_type ??
      (workOnSaturday ? '50' : '100')
  );
  const saturdayType: '50' | '100' = saturdayTypeRaw.includes('50') ? '50' : '100';

  return {
    work_on_saturday: workOnSaturday,
    saturday_overtime_type: saturdayType,
    time_bank_enabled: Boolean(
      fromCompanyRules?.time_bank_enabled ??
        overtimeRules?.bank_hours_enabled ??
        globalSettings?.allow_time_bank ??
        false
    ),
    tolerance_minutes: Number(
      fromCompanyRules?.tolerance_minutes ??
        overtimeRules?.tolerance_minutes ??
        globalSettings?.late_tolerance_minutes ??
        DEFAULT_COMPANY_RULES.tolerance_minutes
    ),
    night_additional_percent: Number(
      fromCompanyRules?.night_additional_percent ??
        overtimeRules?.night_additional_percent ??
        DEFAULT_COMPANY_RULES.night_additional_percent
    ),
    dsr_enabled: Boolean(fromCompanyRules?.dsr_enabled ?? overtimeRules?.dsr_enabled ?? true),
    allow_auto_compensation:
      typeof fromCompanyRules?.allow_auto_compensation === 'boolean'
        ? fromCompanyRules.allow_auto_compensation
        : typeof overtimeRules?.allow_auto_compensation === 'boolean'
          ? overtimeRules.allow_auto_compensation
          : true,
    weekday_extra_above_120: (
      String(
        fromCompanyRules?.weekday_extra_above_120 ?? overtimeRules?.weekday_extra_above_120 ?? '50',
      ).includes('100')
        ? '100'
        : '50'
    ) as '50' | '100',
    bank_hours_expiry_months: Math.min(
      60,
      Math.max(
        1,
        Number(fromCompanyRules?.bank_hours_expiry_months ?? overtimeRules?.bank_hours_expiry_months ?? 6) || 6,
      ),
    ),
    extra_payroll_policy: ((): 'bank' | 'payroll' | 'mixed' => {
      const raw = String(
        fromCompanyRules?.extra_payroll_policy ?? overtimeRules?.extra_payroll_policy ?? DEFAULT_COMPANY_RULES.extra_payroll_policy,
      ).toLowerCase();
      if (raw === 'payroll' || raw === 'folha') return 'payroll';
      if (raw === 'mixed' || raw === 'misto') return 'mixed';
      return 'bank';
    })(),
    mixed_extra_bank_cap_minutes: Math.max(
      0,
      Number(
        fromCompanyRules?.mixed_extra_bank_cap_minutes ??
          overtimeRules?.mixed_extra_bank_cap_minutes ??
          DEFAULT_COMPANY_RULES.mixed_extra_bank_cap_minutes,
      ) || DEFAULT_COMPANY_RULES.mixed_extra_bank_cap_minutes,
    ),
  };
}

/**
 * Corta HE em 50% nas primeiras 2h sobre o excedente e aplica política da empresa no restante.
 * Domingos/feriados com jornada 0: 100% sobre everything worked (equivale a excesso total).
 */
export function splitOvertimeForProduction(
  dayType: DayType,
  workedMinutes: number,
  expectedMinutes: number,
  extraTotal: number,
  rules: Pick<CompanyRules, 'saturday_overtime_type' | 'weekday_extra_above_120'>
): { extra50: number; extra100: number } {
  const ex = Math.max(0, Math.round(extraTotal));
  if (dayType === 'SUNDAY' || dayType === 'HOLIDAY') {
    if (Math.round(expectedMinutes) === 0) {
      return { extra50: 0, extra100: Math.max(0, Math.round(workedMinutes)) };
    }
    return { extra50: 0, extra100: ex };
  }
  if (ex === 0) return { extra50: 0, extra100: 0 };
  const band50 = Math.min(ex, 120);
  const rest = Math.max(0, ex - 120);
  if (dayType === 'SATURDAY') {
    const pol = rules.saturday_overtime_type;
    return {
      extra50: band50 + (pol === '50' ? rest : 0),
      extra100: pol === '100' ? rest : 0,
    };
  }
  const pol = rules.weekday_extra_above_120;
  return {
    extra50: band50 + (pol === '50' ? rest : 0),
    extra100: pol === '100' ? rest : 0,
  };
}

/** Validação matemática pós‑cálculo (folha auditável). */
export function assertDailyMathematicalConsistency(params: {
  worked: number;
  expected: number;
  extra: number;
  negative: number;
  falta: number;
  dateStr: string;
}): void {
  const { worked, expected, extra, negative, falta, dateStr } = params;
  const w = Math.round(worked);
  const e = Math.round(expected);
  const x = Math.round(extra);
  const n = Math.round(negative);
  const f = Math.round(falta);
  if (f > 0 && n > 0) {
    throw new Error(`ENGINE_INCONSISTENT_STATE: falta e negativa juntas em ${dateStr}`);
  }
  if (f > 0 && w !== 0) {
    throw new Error(`ENGINE_INCONSISTENT_STATE: falta registrada com worked≠0 (${dateStr})`);
  }
  if (worked !== 0 && w + n !== e + x) {
    throw new Error(
      `ENGINE_INCONSISTENT_STATE: inconsistência matemática em ${dateStr} (worked+neg≠expected+extra | ${w}+${n}≠${e}+${x})`
    );
  }
}

function normalizeType(type: string): string {
  const t = (type || '').toLowerCase();
  if (t === 'saída' || t === 'saida') return 'saida';
  if (t === 'entrada') return 'entrada';
  if (t === 'pausa') return 'pausa';
  return t;
}

/** Intervalo mínimo (ms) para tratar segunda «entrada» como saída implícita (alinhado ao trigger SQL). */
export const SEQUENCE_TOLERANCE_MIN_GAP_MS = 5 * 60 * 1000;

/**
 * Segunda entrada após entrada com > 5 min → interpretada como saída (dados legados ou pré-persistência).
 * Define raw_data.sequence_adjusted na cópia usada pelo motor.
 */
export function applyEntradaDuplicationTolerance(records: RawTimeRecord[]): {
  records: RawTimeRecord[];
  hadAdjustment: boolean;
} {
  if (records.length < 2) return { records, hadAdjustment: false };
  const order = records.map((_, i) => i).sort((a, b) => {
    const ta = new Date(records[a].timestamp || records[a].created_at).getTime();
    const tb = new Date(records[b].timestamp || records[b].created_at).getTime();
    return ta - tb || a - b;
  });
  const out = records.map((r) => ({ ...r }));
  let hadAdjustment = false;
  let prevIdx: number | null = null;

  for (const idx of order) {
    const sem = normalizePunchType(out[idx].type);
    if (prevIdx === null) {
      prevIdx = idx;
      continue;
    }
    const prevSem = normalizePunchType(out[prevIdx].type);
    const tPrev = new Date(out[prevIdx].timestamp || out[prevIdx].created_at).getTime();
    const tCur = new Date(out[idx].timestamp || out[idx].created_at).getTime();
    if (prevSem === 'entrada' && sem === 'entrada' && tCur - tPrev > SEQUENCE_TOLERANCE_MIN_GAP_MS) {
      const prevRd =
        typeof out[idx].raw_data === 'object' && out[idx].raw_data && !Array.isArray(out[idx].raw_data)
          ? (out[idx].raw_data as Record<string, unknown>)
          : {};
      out[idx] = {
        ...out[idx],
        type: 'saida',
        raw_data: {
          ...prevRd,
          sequence_adjusted: true,
          sequence_fix: 'entrada_duplicada_para_saida',
        },
      };
      hadAdjustment = true;
      if (typeof globalThis !== 'undefined' && globalThis.console) {
        observabilityConsole.warn('[CALC FIX] entrada duplicada convertida em saída', {
          recordId: out[idx].id,
          gapMin: Math.round((tCur - tPrev) / 60000),
        });
      }
    }
    prevIdx = idx;
  }

  if (hadAdjustment && typeof globalThis !== 'undefined' && globalThis.console) {
    observabilityConsole.warn('[CALC WARNING] sequência corrigida automaticamente');
  }
  return { records: out, hadAdjustment };
}

/** Mapeia pausa/entrada para inicio_intervalo e fim_intervalo na sequência do dia */
function mapToStandardTypes(records: RawTimeRecord[]): ParsedSegment[] {
  const sorted = [...records].sort(
    (a, b) => new Date(a.created_at || a.timestamp || 0).getTime() - new Date(b.created_at || b.timestamp || 0).getTime()
  );
  const out: ParsedSegment[] = [];
  let lastWasPausa = false;
  for (const r of sorted) {
    const at = new Date(r.timestamp || r.created_at);
    const raw = (r.type || '').toLowerCase();
    const type = normalizeType(r.type);
    // Tipos do banco (Portaria / app web)
    if (raw === 'intervalo_saida') {
      out.push({ type: 'inicio_intervalo', at, recordId: r.id });
      lastWasPausa = true;
      continue;
    }
    if (raw === 'intervalo_volta') {
      out.push({ type: 'fim_intervalo', at, recordId: r.id });
      lastWasPausa = false;
      continue;
    }
    if (type === 'entrada') {
      if (lastWasPausa) {
        out.push({ type: 'fim_intervalo', at, recordId: r.id });
      } else {
        out.push({ type: 'entrada', at, recordId: r.id });
      }
      lastWasPausa = false;
    } else if (type === 'pausa') {
      out.push({ type: 'inicio_intervalo', at, recordId: r.id });
      lastWasPausa = true;
    } else if (type === 'saida') {
      out.push({ type: 'saida', at, recordId: r.id });
      lastWasPausa = false;
    }
  }
  return out;
}

/**
 * Interpreta marcações do dia em sequências válidas: entrada [inicio_intervalo fim_intervalo] saida.
 * Suporta múltiplos turnos: entrada saida entrada saida.
 */
export function parseTimeRecords(records: RawTimeRecord[]): ParsedDay {
  const { records: tolerant } = applyEntradaDuplicationTolerance(records);
  const segments = mapToStandardTypes(tolerant);
  const date = segments[0]?.at?.toISOString().slice(0, 10) || new Date().toISOString().slice(0, 10);
  const sequences: ParsedDay['sequences'] = [];
  let totalWorkedMinutes = 0;
  let breakMinutes = 0;
  let i = 0;
  while (i < segments.length) {
    const ent = segments[i];
    if (ent.type !== 'entrada') {
      i++;
      continue;
    }
    let saida: Date | undefined;
    let inicioIntervalo: Date | undefined;
    let fimIntervalo: Date | undefined;
    let j = i + 1;
    while (j < segments.length) {
      const s = segments[j];
      if (s.type === 'inicio_intervalo') {
        inicioIntervalo = s.at;
        totalWorkedMinutes += (s.at.getTime() - ent.at.getTime()) / MS_PER_MINUTE;
        j++;
      } else if (s.type === 'fim_intervalo') {
        fimIntervalo = s.at;
        if (inicioIntervalo) breakMinutes += (s.at.getTime() - inicioIntervalo.getTime()) / MS_PER_MINUTE;
        j++;
      } else if (s.type === 'saida') {
        saida = s.at;
        if (fimIntervalo) totalWorkedMinutes += (s.at.getTime() - fimIntervalo.getTime()) / MS_PER_MINUTE;
        else if (inicioIntervalo) {
          // saida sem fim_intervalo: conta até saida como trabalho (inconsistência tratada depois)
          totalWorkedMinutes += (s.at.getTime() - inicioIntervalo.getTime()) / MS_PER_MINUTE;
        } else totalWorkedMinutes += (s.at.getTime() - ent.at.getTime()) / MS_PER_MINUTE;
        j++;
        break;
      } else {
        j++;
      }
    }
    sequences.push({
      entrada: ent.at,
      saida: saida || ent.at,
      inicioIntervalo,
      fimIntervalo,
    });
    i = j;
  }
  return {
    date,
    segments,
    sequences,
    totalWorkedMinutes: Math.round(totalWorkedMinutes),
    breakMinutes: Math.round(breakMinutes),
  };
}

/**
 * Detecta inconsistências: falta entrada/saída, intervalo incompleto, duplicadas, sequência inválida.
 */
export function detectInconsistencies(
  employeeId: string,
  dateStr: string,
  records: RawTimeRecord[],
  schedule: WorkScheduleInfo | null,
  /** Quando informado, ignora `schedule.work_days` (ex.: escala por `employee_shift_schedule`). */
  explicitIsWorkDay?: boolean
): TimeInconsistency[] {
  const list: TimeInconsistency[] = [];
  const parsed = parseTimeRecords(records);
  const dayOfWeek = new Date(`${dateStr}T12:00:00`).getDay();
  const isWorkDay =
    explicitIsWorkDay !== undefined
      ? explicitIsWorkDay
      : schedule
        ? schedule.work_days.includes(dayOfWeek)
        : false;

  if (records.length === 0) {
    if (isWorkDay) list.push({ employee_id: employeeId, date: dateStr, type: 'missing_entry', description: 'Falta de entrada (dia de trabalho sem marcação)' });
    return list;
  }

  for (let i = 0; i < parsed.segments.length; i++) {
    const curr = parsed.segments[i];
    const prev = parsed.segments[i - 1];
    if (prev && prev.type === curr.type) {
      list.push({
        employee_id: employeeId,
        date: dateStr,
        type: 'duplicate_records',
        description: `Duas marcações seguidas do mesmo tipo: ${curr.type}`,
      });
    }
  }

  if (parsed.segments[0]?.type !== 'entrada') {
    list.push({ employee_id: employeeId, date: dateStr, type: 'invalid_sequence', description: 'Primeira marcação do dia deve ser entrada' });
  }

  const last = parsed.segments[parsed.segments.length - 1];
  if (last?.type === 'entrada' || last?.type === 'inicio_intervalo') {
    list.push({ employee_id: employeeId, date: dateStr, type: 'missing_exit', description: 'Falta de saída (entrada ou intervalo sem saída)' });
  }

  const hasInicio = parsed.segments.some((s) => s.type === 'inicio_intervalo');
  const hasFim = parsed.segments.some((s) => s.type === 'fim_intervalo');
  if (hasInicio && !hasFim) {
    list.push({ employee_id: employeeId, date: dateStr, type: 'missing_break', description: 'Intervalo incompleto (início sem fim)' });
  }

  const workedMin = parsed.totalWorkedMinutes;
  if (schedule && isWorkDay && schedule.break_start && schedule.break_end && workedMin > MIN_BREAK_IF_WORK_OVER && parsed.breakMinutes < 30) {
    list.push({ employee_id: employeeId, date: dateStr, type: 'missing_break', description: 'Jornada > 6h sem intervalo mínimo' });
  }

  return list;
}

/** Calcula minutos no período noturno (22:00–05:00) entre dois instantes */
function nightMinutesBetween(from: Date, to: Date): number {
  let min = 0;
  const step = 60 * 1000;
  let t = from.getTime();
  const end = to.getTime();
  while (t < end) {
    const d = new Date(t);
    const m = d.getHours() * 60 + d.getMinutes();
    if (m >= NIGHT_START_MIN || m < NIGHT_END_MIN) min += 1;
    t += step;
  }
  return min;
}

/**
 * Calcula horas noturnas do dia (22h–05h) a partir das marcações.
 */
export function calculateNightHours(records: RawTimeRecord[]): number {
  const parsed = parseTimeRecords(records);
  let total = 0;
  for (const seq of parsed.sequences) {
    if (!seq.saida) continue;
    if (seq.inicioIntervalo && seq.fimIntervalo) {
      total += nightMinutesBetween(seq.entrada, seq.inicioIntervalo);
      total += nightMinutesBetween(seq.fimIntervalo, seq.saida);
      continue;
    }
    if (seq.inicioIntervalo && !seq.fimIntervalo) {
      total += nightMinutesBetween(seq.entrada, seq.inicioIntervalo);
      continue;
    }
    total += nightMinutesBetween(seq.entrada, seq.saida);
  }
  return total;
}

function isWithinWorkDateWindow(iso: string, workDate: string): boolean {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  const start = new Date(`${workDate}T00:00:00`);
  const end = new Date(`${workDate}T23:59:59.999`);
  return d >= start && d <= end;
}

/** Calcula noturno usando instantes saneados para a data civil processada. */
export function calculateNightHoursForDate(records: RawTimeRecord[], workDate: string): number {
  const sanitized: RawTimeRecord[] = records.map((r) => {
    const createdAt = r.created_at;
    const ts = r.timestamp ?? null;
    const useCreatedAt = !ts || !isWithinWorkDateWindow(ts, workDate);
    return {
      ...r,
      timestamp: useCreatedAt ? createdAt : ts,
    };
  });
  const total = calculateNightHours(sanitized);
  // Trava defensiva para impedir propagação de valores absurdos.
  return Math.min(total, 12 * 60);
}

/**
 * Noturno 22–05 já contabilizado pelo motor; distribui proporcionalmente entre “parte até o teto esperado” e excedente.
 */
export function splitNightMinutesNormalVsExtraForDate(
  records: RawTimeRecord[],
  workDate: string,
  expectedWorkedCapMinutes: number
): { nightNormal: number; nightExtra: number } {
  const sanitized: RawTimeRecord[] = records.map((r) => {
    const createdAt = r.created_at;
    const ts = r.timestamp ?? null;
    const useCreatedAt = !ts || !isWithinWorkDateWindow(ts, workDate);
    return {
      ...r,
      timestamp: useCreatedAt ? createdAt : ts,
    };
  });
  const parsed = parseTimeRecords(sanitized);
  const nightTotal = Math.min(calculateNightHours(sanitized), 12 * 60);
  const worked = Math.max(0, parsed.totalWorkedMinutes);
  const cap = Math.max(0, Math.round(Number(expectedWorkedCapMinutes) || 0));
  if (worked === 0) return { nightNormal: nightTotal ? nightTotal : 0, nightExtra: 0 };
  const share = Math.min(worked, cap) / worked;
  const nightNormal = Math.round(nightTotal * share);
  return { nightNormal, nightExtra: Math.max(0, nightTotal - nightNormal) };
}

export function applyNightRules(nightMinutes: number, companyRules: CompanyRules): NightRuleResult {
  const reducedNightMinutes = Math.round(Math.max(0, nightMinutes) * (60 / 52.5));
  const additionalMinutes = Math.round(
    reducedNightMinutes * (Math.max(0, companyRules.night_additional_percent) / 100)
  );
  return {
    payableNightMinutes: reducedNightMinutes + additionalMinutes,
    reducedNightMinutes,
    additionalMinutes,
  };
}

/**
 * Calcula horas extras: 50% (seg–sáb) e 100% (domingo/feriado/folga).
 */
export function calculateOvertime(context: OvertimeCalculationContext): OvertimeResult;
export function calculateOvertime(dateStr: string, workedMinutes: number, expectedMinutes: number, isHolidayOrDayOff: boolean): OvertimeResult;
export function calculateOvertime(
  contextOrDate: OvertimeCalculationContext | string,
  workedMinutesArg?: number,
  expectedMinutesArg?: number,
  isHolidayOrDayOffArg?: boolean
): OvertimeResult {
  if (typeof contextOrDate === 'string') {
    const dateStr = contextOrDate;
    const workedMinutes = workedMinutesArg || 0;
    const expectedMinutes = expectedMinutesArg || 0;
    const isHolidayOrDayOff = Boolean(isHolidayOrDayOffArg);
    const overtime = Math.max(0, workedMinutes - expectedMinutes);
    return {
      date: dateStr,
      overtime_50_minutes: isHolidayOrDayOff ? 0 : overtime,
      overtime_100_minutes: isHolidayOrDayOff ? overtime : 0,
      is_holiday_or_off: isHolidayOrDayOff,
    };
  }

  const { date, dayType, workedMinutes, expectedMinutes, companyRules } = contextOrDate;
  const overtime = Math.max(0, workedMinutes - expectedMinutes);
  let overtime50 = 0;
  let overtime100 = 0;
  if (dayType === 'HOLIDAY' || dayType === 'SUNDAY') {
    overtime100 = overtime;
  } else if (dayType === 'SATURDAY') {
    overtime50 = overtime;
  } else {
    overtime50 = overtime;
  }
  return {
    date,
    overtime_50_minutes: overtime50,
    overtime_100_minutes: overtime100,
    is_holiday_or_off: dayType === 'HOLIDAY' || dayType === 'SUNDAY',
  };
}

function hhmmToMinutes(hhmm: string | null | undefined): number | null {
  if (!hhmm || !/^\d{1,2}:\d{2}$/.test(hhmm)) return null;
  const [h, m] = hhmm.split(':').map((v) => Number(v));
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m;
}

function isDayIncomplete(daily: DailyProcessResult): boolean {
  const present = [daily.entrada, daily.inicio_intervalo, daily.fim_intervalo, daily.saida].filter(Boolean).length;
  if (present === 0) return false;
  return !(daily.entrada && daily.saida);
}

export async function get_day_type(
  dateStr: string,
  companyId?: string
): Promise<DayType> {
  return classifyDay({ date: dateStr, company: { id: companyId } });
}

/** Esperado oficial a partir da escala resolvida (sem contingência nem STRICT). */
export function computeScheduledExpectedMinutes(dayType: DayType, schedule: WorkScheduleInfo | null): number {
  if (!schedule || dayType === 'HOLIDAY' || dayType === 'SUNDAY') return 0;
  const computeSpan = (start: number | null, end: number | null, breakStart: number | null, breakEnd: number | null, dailyHoursFallback: number): number => {
    if (start == null || end == null) return Math.round(dailyHoursFallback * 60);
    const isOvernight = end < start;
    let breakMinutes = 0;
    if (breakStart != null && breakEnd != null && breakEnd > breakStart) {
      if (!isOvernight && breakStart >= start && breakEnd <= end) {
        breakMinutes = breakEnd - breakStart;
      } else if (isOvernight && (breakStart >= start || breakStart <= end) && (breakEnd >= start || breakEnd <= end)) {
        breakMinutes = breakEnd - breakStart;
      }
    }
    const span = isOvernight ? (24 * 60 - start) + end : end - start;
    if (span > 0) return Math.max(0, span - breakMinutes);
    return Math.round(dailyHoursFallback * 60);
  };
  if (dayType === 'SATURDAY') {
    return computeSpan(
      hhmmToMinutes(schedule.start_time),
      hhmmToMinutes(schedule.end_time),
      hhmmToMinutes(schedule.break_start),
      hhmmToMinutes(schedule.break_end),
      Number(schedule.daily_hours || 4) || 4,
    );
  }
  return computeSpan(
    hhmmToMinutes(schedule.start_time),
    hhmmToMinutes(schedule.end_time),
    hhmmToMinutes(schedule.break_start),
    hhmmToMinutes(schedule.break_end),
    Number(schedule.daily_hours || 8) || 8,
  );
}

export async function get_expected_hours(
  employeeId: string,
  companyId: string,
  dateStr: string,
  dayType?: DayType
): Promise<number> {
  const resolvedType = dayType ?? (await get_day_type(dateStr, companyId));
  const resolved = await resolveEmployeeScheduleForDate(employeeId, companyId, dateStr);
  return computeScheduledExpectedMinutes(resolvedType, resolved.schedule);
}

async function resolveExpectedMinutesForCalculateDay(
  employeeId: string,
  companyId: string,
  dateStr: string,
  dayType: DayType,
  resolved: Awaited<ReturnType<typeof resolveEmployeeScheduleForDate>>,
): Promise<{ expected: number; contingencyFallback: boolean }> {
  const base = computeScheduledExpectedMinutes(dayType, resolved.schedule);
  if (dayType !== 'WEEKDAY' && dayType !== 'SATURDAY') {
    if (!Number.isFinite(base) || base < 0) {
      observabilityConsole.info('[CALC INFO] schedule_fallback_applied', {
        date: dateStr,
        employee_id: employeeId,
        company_id: companyId,
        reason: 'non_weekday_invalid_expected',
      });
      return { expected: 0, contingencyFallback: true };
    }
    return { expected: base, contingencyFallback: false };
  }

  if (!resolved.schedule) {
    calcMetrics.schedule_missing_count += 1;
    observabilityConsole.info('[CALC INFO] schedule_fallback_applied', {
      date: dateStr,
      employee_id: employeeId,
      company_id: companyId,
      reason: 'no_schedule',
    });
    return { expected: 0, contingencyFallback: true };
  }

  const invalid = !Number.isFinite(base) || base <= 0;
  if (!invalid) return { expected: base, contingencyFallback: false };

  calcMetrics.schedule_missing_count += 1;
  observabilityConsole.info('[CALC INFO] schedule_fallback_applied', {
    date: dateStr,
    employee_id: employeeId,
    company_id: companyId,
    reason: 'invalid_expected',
    strict_schedule_env: STRICT_SCHEDULE_MODE,
  });
  return { expected: contingencyFallbackExpectedMinutes(dayType), contingencyFallback: true };
}

export async function calculate_day(
  employeeId: string,
  companyId: string,
  dateStr: string
): Promise<DaySummary['daily']> {
  const companyRules = await getCompanyRules(companyId);
  const dayType = await get_day_type(dateStr, companyId);
  const records = await getDayRecords(employeeId, dateStr, companyId);
  const base = await processDailyTime(employeeId, companyId, dateStr, {
    toleranceOverride: companyRules.tolerance_minutes,
  });
  const resolved = await resolveEmployeeScheduleForDate(employeeId, companyId, dateStr);
  const resolvedExpected = await resolveExpectedMinutesForCalculateDay(
    employeeId,
    companyId,
    dateStr,
    dayType,
    resolved,
  );
  const expected = resolvedExpected.expected;

  const worked = base.total_worked_minutes;

  /** Falta CLT: worked===0 e jornada prevista positiva → falta esperada inteira (nunca negativa). */
  if (worked === 0 && expected > 0) {
    const faltaEarly = Math.round(expected);
    const absenceRow = {
      ...base,
      total_worked_minutes: 0,
      expected_minutes: faltaEarly,
      overtime_minutes: 0,
      late_minutes: 0,
      missing_minutes: 0,
      negative_minutes: 0,
      extra_minutes: 0,
      extra_50_minutes: 0,
      extra_100_minutes: 0,
      absence_minutes: faltaEarly,
      incomplete: records.length > 0,
      day_type: dayType,
      contingency_schedule_fallback: resolvedExpected.contingencyFallback,
    };
    assertDailyMathematicalConsistency({
      worked: 0,
      expected: faltaEarly,
      extra: 0,
      negative: 0,
      falta: faltaEarly,
      dateStr,
    });
    observabilityConsole.log('[CALC]', {
      date: dateStr,
      expected: faltaEarly,
      worked: 0,
      extra_hours: 0,
      negative_hours: 0,
      falta: faltaEarly,
      modo: 'absence_clt',
    });
    return absenceRow;
  }

  // Fórmula central obrigatória (expected vs worked).
  let extraMinutes = Math.max(0, worked - expected);
  const negativeMinutes = Math.max(0, expected - worked);
  if (worked < expected) {
    extraMinutes = 0;
  }
  const incomplete = isDayIncomplete(base);
  const absenceMinutes = 0;
  const entrySchedule = resolved.schedule?.start_time ?? null;
  const entryExpectedMin = hhmmToMinutes(entrySchedule);
  const entryActualMin = hhmmToMinutes(base.entrada);
  const lateMinutes =
    entryExpectedMin != null && entryActualMin != null && entryActualMin > entryExpectedMin + companyRules.tolerance_minutes
      ? entryActualMin - entryExpectedMin - companyRules.tolerance_minutes
      : 0;
  const { extra50, extra100 } = splitOvertimeForProduction(
    dayType,
    worked,
    expected,
    extraMinutes,
    companyRules,
  );
  const consistencyLeft = worked;
  const consistencyExpected = expected;
  const consistencyRight = consistencyExpected - negativeMinutes + extraMinutes;
  if (worked <= expected && extraMinutes > 0) {
    throw new Error(`Extra inválida: jornada não excedida (${dateStr})`);
  }
  if (worked >= expected && negativeMinutes > 0) {
    throw new Error(`Negativa inválida: jornada não deficitária (${dateStr})`);
  }
  if (absenceMinutes > 0 && negativeMinutes > 0) {
    throw new Error(`Regra violada: falta e negativa simultâneas (${dateStr})`);
  }
  if (worked === expected && extraMinutes !== 0) {
    throw new Error(`Extra inválida em jornada normal (${dateStr})`);
  }
  if (extraMinutes > worked) {
    throw new Error(`Extra inválida em ${dateStr}: extra=${extraMinutes} worked=${worked}`);
  }
  if (worked < expected && extraMinutes > 0) {
    throw new Error(`Extra indevida em ${dateStr}: worked<expected e extra>0`);
  }
  if (consistencyLeft !== consistencyRight) {
    throw new Error(`Inconsistência diária em ${dateStr}: worked=${consistencyLeft} esperado=${consistencyRight}`);
  }
  assertDailyMathematicalConsistency({
    worked,
    expected,
    extra: extraMinutes,
    negative: negativeMinutes,
    falta: absenceMinutes,
    dateStr,
  });
  observabilityConsole.log('[CALC]', {
    date: dateStr,
    expected,
    worked,
    extra_minutes: extraMinutes,
    negative_minutes: negativeMinutes,
    contingencia_escala: resolvedExpected.contingencyFallback ? 1 : 0,
  });
  return {
    ...base,
    expected_minutes: expected,
    overtime_minutes: extraMinutes,
    late_minutes: lateMinutes,
    missing_minutes: negativeMinutes,
    negative_minutes: negativeMinutes,
    extra_minutes: extraMinutes,
    extra_50_minutes: extra50,
    extra_100_minutes: extra100,
    absence_minutes: absenceMinutes,
    incomplete,
    day_type: dayType,
    contingency_schedule_fallback: resolvedExpected.contingencyFallback,
  };
}

export interface MonthlySummary {
  worked_total: number;
  extra_50: number;
  extra_100: number;
  negative_total: number;
  falta_total: number;
  /** Atraso (entrada após tolerância), minutos acumulados no período. */
  total_atrasos_minutes: number;
  /** Noturno efetivo pagável (hora reduzida + adicional quando aplicável). */
  total_noturno: number;
  /** Saldo BH real ao fim do período (wallet ledger). */
  bank_balance_approx: number;
  /** BH expirado no período → conversão em HE 50% para folha (min). */
  bank_expired_to_extra50_minutes: number;
  /** Total créditos automáticos no BH no período. */
  total_banco_credito_minutes: number;
  /** Total consumido do BH compensando negativa (FIFO) no período. */
  total_banco_debit_fifo_minutes: number;
  /** Reflexo DSR (extra_100 apenas; modelo produção HARD LOCK). */
  dsr_extra_total: number;
  dsr_extra_50: number;
  dsr_extra_100: number;
}

function emptyMonthlySummary(): MonthlySummary {
  return {
    worked_total: 0,
    extra_50: 0,
    extra_100: 0,
    negative_total: 0,
    falta_total: 0,
    total_atrasos_minutes: 0,
    total_noturno: 0,
    bank_balance_approx: 0,
    bank_expired_to_extra50_minutes: 0,
    total_banco_credito_minutes: 0,
    total_banco_debit_fifo_minutes: 0,
    dsr_extra_total: 0,
    dsr_extra_50: 0,
    dsr_extra_100: 0,
  };
}

/** Segunda-feira (YYYY-MM-DD) da semana ISO do dia informado no fuso interpretado pelo `Date` local. */
export function weekMondayKey(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00`);
  const dow = d.getDay();
  const delta = dow === 0 ? -6 : 1 - dow;
  const m = new Date(d);
  m.setDate(m.getDate() + delta);
  return m.toISOString().slice(0, 10);
}

function routeExtraBankVsPayroll(extraTotal: number, rules: CompanyRules): { bank: number; payroll: number } {
  const x = Math.max(0, Math.round(extraTotal));
  if (!rules.time_bank_enabled || x <= 0) return { bank: 0, payroll: x };
  if (rules.extra_payroll_policy === 'payroll') return { bank: 0, payroll: x };
  if (rules.extra_payroll_policy === 'mixed') {
    const cap = Math.max(0, Math.round(rules.mixed_extra_bank_cap_minutes));
    const b = Math.min(x, cap);
    return { bank: b, payroll: Math.max(0, x - b) };
  }
  return { bank: x, payroll: 0 };
}

async function applyBankNightAndExtras(
  employeeId: string,
  companyId: string,
  dateStr: string,
  companyRules: CompanyRules,
  records: RawTimeRecord[],
  dailyBase: DaySummary['daily']
): Promise<{
  daily: DaySummary['daily'];
  overtime: OvertimeResult;
  bank_hours_delta: number;
  nightPayableTotal: number;
  nightNormalReduced: number;
  nightExtraReduced: number;
}> {
  const splitNight = splitNightMinutesNormalVsExtraForDate(records, dateStr, dailyBase.expected_minutes);
  const rn = applyNightRules(splitNight.nightNormal, companyRules);
  const rx = applyNightRules(splitNight.nightExtra, companyRules);
  const { bank: bankExtra, payroll: payrollExtra } = routeExtraBankVsPayroll(
    dailyBase.extra_minutes,
    companyRules,
  );
  const folhaSplit =
    payrollExtra <= 0
      ? { extra50: 0, extra100: 0 }
      : splitOvertimeForProduction(
          dailyBase.day_type,
          dailyBase.total_worked_minutes,
          dailyBase.expected_minutes,
          payrollExtra,
          companyRules,
        );

  let daily: DaySummary['daily'] = {
    ...dailyBase,
    extra_banco_minutes: bankExtra,
    extra_folha_50_minutes: folhaSplit.extra50,
    extra_folha_100_minutes: folhaSplit.extra100,
    extra_50_minutes: folhaSplit.extra50,
    extra_100_minutes: folhaSplit.extra100,
    payroll_negative_after_bank_minutes: dailyBase.negative_minutes,
    bank_compensated_minutes: 0,
    bank_credited_minutes: 0,
    negativo_banco_minutes: 0,
    negativo_folha_minutes: dailyBase.negative_minutes,
    extra_noturna_payable_minutes: rx.payableNightMinutes,
  };
  let overtime: OvertimeResult = {
    date: dateStr,
    overtime_50_minutes: folhaSplit.extra50,
    overtime_100_minutes: folhaSplit.extra100,
    is_holiday_or_off: dailyBase.day_type === 'HOLIDAY' || dailyBase.day_type === 'SUNDAY',
  };
  let bank_hours_delta = 0;
  if (companyRules.time_bank_enabled) {
    const bh = await applyDailyBankLedger({
      employeeId,
      companyId,
      dateStr,
      extraDay: bankExtra,
      negativeDay: dailyBase.negative_minutes,
      allowAutoCompensation: companyRules.allow_auto_compensation,
      bankHoursExpiryMonths: companyRules.bank_hours_expiry_months,
    });
    daily = {
      ...daily,
      payroll_negative_after_bank_minutes: bh.payrollNegativeMinutes,
      bank_compensated_minutes: bh.compensatedFromBank,
      bank_credited_minutes: bh.creditedExtra,
      negativo_banco_minutes: bh.compensatedFromBank,
      negativo_folha_minutes: bh.payrollNegativeMinutes,
      extra_noturna_payable_minutes: rx.payableNightMinutes,
    };
    overtime = { ...overtime, overtime_50_minutes: folhaSplit.extra50, overtime_100_minutes: folhaSplit.extra100 };
    bank_hours_delta = bh.creditedExtra - bh.compensatedFromBank;
  }
  return {
    daily,
    overtime,
    bank_hours_delta,
    nightPayableTotal: rn.payableNightMinutes + rx.payableNightMinutes,
    nightNormalReduced: rn.reducedNightMinutes,
    nightExtraReduced: rx.reducedNightMinutes,
  };
}

function weekDsrExtraMinutesFromGroup(group: DaySummary[]): number {
  if (
    group.some((r) => r.daily.expected_minutes > 0 && (r.daily.absence_minutes || 0) > 0)
  )
    return 0;
  const extrasMonFriOnly = group.reduce((a, r) => {
    const dowJS = new Date(`${r.date}T12:00:00`).getDay();
    if (dowJS < 1 || dowJS > 5 || r.daily.day_type !== 'WEEKDAY') return a;
    return a + Math.max(0, r.daily.extra_minutes || 0);
  }, 0);
  const diasUteisTrabalhou = group.filter((r) => {
    const dowJS = new Date(`${r.date}T12:00:00`).getDay();
    return (
      dowJS >= 1 &&
      dowJS <= 5 &&
      r.daily.day_type === 'WEEKDAY' &&
      r.daily.expected_minutes > 0 &&
      (r.daily.total_worked_minutes || 0) > 0
    );
  }).length;
  if (diasUteisTrabalhou <= 0) return 0;
  const sundaysCount = group.filter((r) => new Date(`${r.date}T12:00:00`).getDay() === 0).length;
  const raw = (extrasMonFriOnly / Math.max(1, diasUteisTrabalhou)) * sundaysCount;
  const rounded = Math.round(raw);
  observabilityConsole.log('[DSR]', {
    semana_hint: group[0]?.date,
    extras_seg_sex: extrasMonFriOnly,
    dias_uteis_trabalhados: diasUteisTrabalhou,
    domingos: sundaysCount,
    dsr_minutes: rounded,
  });
  return rounded;
}

function weekDsrSplitFromGroup(group: DaySummary[]): { total: number; dsr50: number; dsr100: number } {
  const total = weekDsrExtraMinutesFromGroup(group);
  return { total, dsr50: 0, dsr100: total };
}

function aggregateMonthlyDsrSplit(groups: Map<string, DaySummary[]>): {
  total: number;
  dsr50: number;
  dsr100: number;
} {
  let total = 0,
    dsr50 = 0,
    dsr100 = 0;
  for (const group of groups.values()) {
    const w = weekDsrSplitFromGroup(group);
    total += w.total;
    dsr50 += w.dsr50;
    dsr100 += w.dsr100;
  }
  return { total, dsr50, dsr100 };
}

function generateRecalcRunId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `run-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

async function persistRecalculatedDay(params: {
  employeeId: string;
  companyId: string;
  date: string;
  daily: DaySummary['daily'];
  nightMinutes: number;
  nightNormalReduced: number;
  nightExtraReduced: number;
  bank_hours_delta?: number;
  /** Agrupa todas as linhas geradas pela mesma execução de `recalculate_period`. */
  recalcRunId?: string;
  dayRecords: RawTimeRecord[];
  scheduleForAudit: { schedule: WorkScheduleInfo | null; jsDayOfWeek: number };
}): Promise<void> {
  const { employeeId, companyId, date, daily, nightMinutes, nightNormalReduced, nightExtraReduced, bank_hours_delta } =
    params;
  const recalc_run_id = params.recalcRunId ?? generateRecalcRunId();
  const sch = params.scheduleForAudit;
  const schedule_used =
    sch.schedule != null
      ? { ...sch.schedule }
      : { no_schedule: true, js_day_of_week: sch.jsDayOfWeek };
  const calculation_type: 'fallback' | 'normal' = daily.contingency_schedule_fallback ? 'fallback' : 'normal';
  const used_schedule_id = await fetchUserScheduleId(employeeId);
  const punchSummary = summarizeDayRecords(params.dayRecords);
  const hadEntradaSaidaPair = Boolean(punchSummary.entrada && punchSummary.saida);
  const missingClockOut = Boolean(punchSummary.entrada && !punchSummary.saida);
  const decision_tree = buildPersistDayDecisionTree({
    hasScheduleForDay: sch.schedule != null,
    usedScheduleId: used_schedule_id,
    punchCount: params.dayRecords.length,
    hadEntradaSaidaPair,
    contingencyScheduleFallback: daily.contingency_schedule_fallback === true,
    incomplete: daily.incomplete === true,
    missingClockOut,
  });
  const calculation_audit = {
    punches: snapshotPunchesFromRecords(params.dayRecords),
    schedule_used,
    correlation_id: recalc_run_id,
    calculation_type,
    used_schedule_id,
    decision_tree,
  };
  const payload = {
    employee_id: employeeId,
    company_id: companyId,
    date,
    worked_minutes: daily.total_worked_minutes,
    expected_minutes: daily.expected_minutes,
    overtime_minutes: daily.extra_minutes,
    absence_minutes: daily.absence_minutes,
    night_minutes: nightMinutes,
    late_minutes: daily.late_minutes,
    is_absence: daily.absence_minutes > 0,
    is_holiday: daily.day_type === 'HOLIDAY',
    raw_data: {
      day_type: daily.day_type,
      extra_50_minutes: daily.extra_50_minutes,
      extra_100_minutes: daily.extra_100_minutes,
      negative_minutes: daily.negative_minutes,
      incomplete: daily.incomplete,
      night_normal_reduced_minutes: nightNormalReduced,
      night_extra_reduced_minutes: nightExtraReduced,
      bank_hours_delta: bank_hours_delta ?? null,
      payroll_negative_after_bank_minutes: daily.payroll_negative_after_bank_minutes ?? null,
      bank_compensated_minutes: daily.bank_compensated_minutes ?? null,
      bank_credited_minutes: daily.bank_credited_minutes ?? null,
      extra_noturna_payable_minutes: daily.extra_noturna_payable_minutes ?? null,
      extra_banco_minutes: daily.extra_banco_minutes ?? null,
      extra_folha_50_minutes: daily.extra_folha_50_minutes ?? null,
      extra_folha_100_minutes: daily.extra_folha_100_minutes ?? null,
      negativo_banco_minutes: daily.negativo_banco_minutes ?? null,
      negativo_folha_minutes: daily.negativo_folha_minutes ?? null,
      has_schedule_issue: daily.contingency_schedule_fallback === true,
    },
    updated_at: new Date().toISOString(),
    calculation_audit,
  };
  const writeResult = await writeTimesheetsDailyCalculatedRow(payload);
  if (writeResult.outcome === 'skipped_integrity') {
    calcMetrics.fk_avoided_count += 1;
    return;
  }

  if (writeResult.outcome === 'written') {
    try {
      await db.insert('timesheets_daily_snapshots', {
        employee_id: employeeId,
        company_id: companyId,
        date,
        recalc_run_id,
        snapshot: {
          ...payload,
          snapshot_recorded_at: new Date().toISOString(),
          engine: 'timeEngine.persistRecalculatedDay',
        },
      });
    } catch {
      // Tabela opcional até migração aplicada ou RLS.
    }
  }
}

export async function recalculate_period(
  employeeId: string,
  companyId: string,
  startDate: string,
  endDate: string
): Promise<{
  total_days: number;
  inconsistent_days: number;
  violations: Array<{ date: string; reason: string }>;
  case_checks: Array<{ date: string; worked: number; expected: number; extra: number; negative: number }>;
  monthly_summary: MonthlySummary;
}> {
  resetCalcMetrics();
  const days: string[] = [];
  const d = new Date(`${startDate}T12:00:00`);
  const end = new Date(`${endDate}T12:00:00`);
  while (d <= end) {
    days.push(d.toISOString().slice(0, 10));
    d.setDate(d.getDate() + 1);
  }

  const companyRules = await getCompanyRules(companyId);
  const monthly_summary = emptyMonthlySummary();
  const byWeek = new Map<string, DaySummary[]>();
  const recalcRunId = generateRecalcRunId();

  const violations: Array<{ date: string; reason: string }> = [];
  const case_checks: Array<{ date: string; worked: number; expected: number; extra: number; negative: number }> = [];
  for (const date of days) {
    try {
      const dailyBase = await calculate_day(employeeId, companyId, date);
      const dayRecords = await getDayRecords(employeeId, date, companyId);
      const scheduleForAudit = await resolveEmployeeScheduleForDate(employeeId, companyId, date);
      const nightRaw = calculateNightHoursForDate(dayRecords, date);
      const core = await applyBankNightAndExtras(
        employeeId,
        companyId,
        date,
        companyRules,
        dayRecords,
        dailyBase,
      );
      const daily = core.daily;
      await persistRecalculatedDay({
        employeeId,
        companyId,
        date,
        daily,
        nightMinutes: core.nightPayableTotal,
        nightNormalReduced: core.nightNormalReduced,
        nightExtraReduced: core.nightExtraReduced,
        bank_hours_delta: core.bank_hours_delta,
        recalcRunId,
        dayRecords,
        scheduleForAudit,
      });
    await appendEngineCalcAudit({
      employeeId,
      companyId,
      payload: {
        date,
        expected: daily.expected_minutes,
        worked: daily.total_worked_minutes,
        extra: daily.extra_minutes,
        negative: daily.negative_minutes,
        falta: daily.absence_minutes,
        extra_50: daily.extra_50_minutes,
        extra_100: daily.extra_100_minutes,
        extra_noturna_payable: daily.extra_noturna_payable_minutes ?? 0,
        banco_creditado: daily.bank_credited_minutes ?? 0,
        banco_utilizado: daily.bank_compensated_minutes ?? 0,
        extra_banco: daily.extra_banco_minutes ?? 0,
        extra_folha_50: daily.extra_folha_50_minutes ?? daily.extra_50_minutes,
        extra_folha_100: daily.extra_folha_100_minutes ?? daily.extra_100_minutes,
        origem: 'calc_engine',
        timestamp: new Date().toISOString(),
      },
    });
    monthly_summary.worked_total += daily.total_worked_minutes;
    monthly_summary.extra_50 += core.overtime.overtime_50_minutes;
    monthly_summary.extra_100 += core.overtime.overtime_100_minutes;
    monthly_summary.negative_total +=
      daily.payroll_negative_after_bank_minutes ?? daily.negative_minutes;
    monthly_summary.falta_total += daily.absence_minutes;
    monthly_summary.total_atrasos_minutes += daily.late_minutes;
    monthly_summary.total_noturno += core.nightPayableTotal;
    monthly_summary.total_banco_credito_minutes += daily.bank_credited_minutes ?? 0;
    monthly_summary.total_banco_debit_fifo_minutes += daily.bank_compensated_minutes ?? 0;
    const wk = weekMondayKey(date);
    if (!byWeek.has(wk)) byWeek.set(wk, []);
    byWeek.get(wk)!.push({
      date,
      daily,
      inconsistencies: [],
      overtime: core.overtime,
      night_minutes: core.nightPayableTotal,
      bank_hours_delta: core.bank_hours_delta,
    });
    const dayType = daily.day_type;
    if (daily.extra_minutes > daily.total_worked_minutes) {
      violations.push({ date, reason: 'extra_gt_worked' });
    }
    if (daily.total_worked_minutes < daily.expected_minutes && daily.extra_minutes > 0) {
      violations.push({ date, reason: 'extra_with_worked_lt_expected' });
    }
    if (
      (daily.day_type === 'WEEKDAY' || daily.day_type === 'SATURDAY') &&
      daily.extra_minutes === daily.total_worked_minutes &&
      daily.expected_minutes > 0
    ) {
      violations.push({ date, reason: 'extra_equal_worked_on_non_holiday' });
    }
    if ((dayType === 'WEEKDAY' || dayType === 'SATURDAY') && daily.extra_100_minutes > 0) {
      violations.push({ date, reason: 'extra_100_in_non_100_day' });
    }
    if (daily.absence_minutes > 0 && daily.negative_minutes > 0) {
      violations.push({ date, reason: 'absence_and_negative_together' });
    }
    if (nightRaw > 12 * 60) {
      violations.push({ date, reason: 'night_gt_12h' });
    }
    case_checks.push({
      date,
      worked: daily.total_worked_minutes,
      expected: daily.expected_minutes,
      extra: daily.extra_minutes,
      negative: daily.negative_minutes,
    });
    } catch (e) {
      calcMetrics.calc_errors += 1;
      const message = e instanceof Error ? e.message : String(e);
      observabilityConsole.info('[CALC INFO] day_processing_failed', { date, employee_id: employeeId, message });
      violations.push({ date, reason: 'CALC_ERROR' });
      continue;
    }
  }

  await appendAfdTimeEngineAudit({
    employeeId,
    companyId,
    action: 'RECALC_PERIOD',
    payload: {
      employee_id: employeeId,
      company_id: companyId,
      description: 'Fechamento de recálculo de período',
      startDate,
      endDate,
      total_days_processed: case_checks.length,
      violations_count: violations.length,
      timesheets_daily_snapshot_run_id: recalcRunId,
      halted_schedule: false,
      schedule_error: null,
    },
  });

  const dsrBlock = aggregateMonthlyDsrSplit(byWeek);
  monthly_summary.dsr_extra_total = dsrBlock.total;
  monthly_summary.dsr_extra_50 = dsrBlock.dsr50;
  monthly_summary.dsr_extra_100 = dsrBlock.dsr100;
  const bankSim = await getBankExpiredToPayroll50ForPeriod(employeeId, companyId, endDate.slice(0, 10));
  monthly_summary.bank_balance_approx = Math.round(bankSim.residualMinutes);
  monthly_summary.bank_expired_to_extra50_minutes = bankSim.payrollExtra50FromExpiredMinutes;

  logCalcSummaryFinal({
    employee_id: employeeId,
    company_id: companyId,
    start_date: startDate,
    end_date: endDate,
  });

  return {
    total_days: days.length,
    inconsistent_days: violations.length,
    violations,
    case_checks,
    monthly_summary,
  };
}

/** Snapshot fechamento mensual estilo folha (BH separado das HE pagas em folha). */
export async function closeTimesheet(employeeId: string, companyId: string, year: number, month: number): Promise<{
  total_trabalhado: number;
  total_extra_50: number;
  total_extra_100: number;
  total_banco_credito: number;
  total_banco_debito: number;
  saldo_banco_final: number;
  total_faltas: number;
  total_atrasos: number;
  engine: Awaited<ReturnType<typeof recalculate_period>>;
}> {
  const engine = await recalculate_month(employeeId, companyId, year, month);
  const m = engine.monthly_summary;
  const lastDay = new Date(year, month, 0).getDate();
  const last = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  const bankSim = await getBankExpiredToPayroll50ForPeriod(employeeId, companyId, last);
  return {
    engine,
    total_trabalhado: m.worked_total,
    total_extra_50: m.extra_50 + m.dsr_extra_50,
    total_extra_100: m.extra_100 + m.dsr_extra_100,
    total_banco_credito: m.total_banco_credito_minutes,
    total_banco_debito: m.total_banco_debit_fifo_minutes,
    saldo_banco_final: Math.round(bankSim.residualMinutes),
    total_faltas: m.falta_total,
    total_atrasos: m.total_atrasos_minutes,
  };
}

/** Fecha o mês civil: reaplica o motor dia a dia e devolve o mesmo payload de `recalculate_period` + `monthly_summary` consolidado. */
export async function recalculate_month(
  employeeId: string,
  companyId: string,
  year: number,
  month: number
): Promise<Awaited<ReturnType<typeof recalculate_period>>> {
  const lastDay = new Date(year, month, 0).getDate();
  const sm = String(month).padStart(2, '0');
  const startDate = `${year}-${sm}-01`;
  const endDate = `${year}-${sm}-${String(lastDay).padStart(2, '0')}`;
  return recalculate_period(employeeId, companyId, startDate, endDate);
}

/**
 * Reflexo de DSR prático sobre extras semanais (minutos trabalhados além da jornada esperada como base):
 * `(totalExtras / diasUteis) * diasDescansoNaFatiadeSemana)`
 */
export function calculateDSRExtraImpactMinutes(params: {
  totalExtraMinutes: number;
  mondayFridayUtilityDaysCount: number;
  restDaysCount: number;
}): number {
  const denom = Math.max(1, params.mondayFridayUtilityDaysCount);
  const multiplier = Math.max(0, params.restDaysCount);
  return Math.round((Math.max(0, params.totalExtraMinutes) / denom) * multiplier);
}

/**
 * DSR conforme blueprint: média ponderada pela semana (seg–sex como útil) aplicada aos dias de descanso dentro do recorte informado).
 * Fallback numérico: `totalExtras / diasUteis` quando não é lista.
 */
export function calculateDSR(
  weekDataOrOvertime: Array<{ date: string; hasUnjustifiedAbsence: boolean; overtimeMinutes: number }> | number,
  workingDaysInWeekArg?: number
): number {
  if (Array.isArray(weekDataOrOvertime)) {
    if (weekDataOrOvertime.some((d) => d.hasUnjustifiedAbsence)) return 0;
    const totalOvertime = weekDataOrOvertime.reduce((acc, d) => acc + (d.overtimeMinutes || 0), 0);
    const mondayFridayUtilityDaysCount = weekDataOrOvertime.filter((d) => {
      const dow = new Date(`${d.date}T12:00:00`).getDay();
      return dow >= 1 && dow <= 5;
    }).length;
    const restDaysCount = weekDataOrOvertime.filter((d) => {
      const dow = new Date(`${d.date}T12:00:00`).getDay();
      return dow === 0;
    }).length;
    return calculateDSRExtraImpactMinutes({
      totalExtraMinutes: totalOvertime,
      mondayFridayUtilityDaysCount: mondayFridayUtilityDaysCount || 1,
      restDaysCount,
    });
  }
  const weekOvertimeMinutes = weekDataOrOvertime;
  const workingDaysInWeek = workingDaysInWeekArg || 0;
  if (workingDaysInWeek <= 0) return 0;
  return weekOvertimeMinutes / workingDaysInWeek;
}

/**
 * Processa um dia completo: jornada, inconsistências, extras, noturnas.
 */
export async function processEmployeeDay(
  employeeId: string,
  companyId: string,
  dateStr: string
): Promise<DaySummary> {
  const companyRules = await getCompanyRules(companyId);
  const dayType = await get_day_type(dateStr, companyId);
  const resolved = await resolveEmployeeScheduleForDate(employeeId, companyId, dateStr);
  const records = await getDayRecords(employeeId, dateStr, companyId);
  const dailyBase = await calculate_day(employeeId, companyId, dateStr);
  const isHolidayDay = dayType === 'HOLIDAY';
  const explicitIsWorkDay = isHolidayDay ? false : resolved.schedule ? undefined : false;
  const inconsistencies = detectInconsistencies(
    employeeId,
    dateStr,
    records,
    resolved.schedule,
    explicitIsWorkDay
  );
  const nightRaw = calculateNightHoursForDate(records, dateStr);
  if (nightRaw > 12 * 60) {
    throw new Error(`Noturno inválido em ${dateStr}: ${nightRaw} min`);
  }
  const core = await applyBankNightAndExtras(
    employeeId,
    companyId,
    dateStr,
    companyRules,
    records,
    dailyBase
  );
  return {
    date: dateStr,
    daily: core.daily,
    inconsistencies,
    overtime: core.overtime,
    night_minutes: core.nightPayableTotal,
    night_normal_reduced_minutes: core.nightNormalReduced,
    night_extra_reduced_minutes: core.nightExtraReduced,
    bank_hours_delta: core.bank_hours_delta,
  };
}

/**
 * Processa a semana do funcionário (7 dias a partir de startDate).
 */
export async function processEmployeeWeek(
  employeeId: string,
  companyId: string,
  startDate: string
): Promise<DaySummary[]> {
  const results: DaySummary[] = [];
  const start = new Date(startDate);
  const companyRules = await getCompanyRules(companyId);
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const dateStr = d.toISOString().slice(0, 10);
    results.push(await processEmployeeDay(employeeId, companyId, dateStr));
  }
  if (companyRules.dsr_enabled) {
    const dsr = weekDsrSplitFromGroup(results);
    for (const r of results) {
      r.dsr_minutes = dsr.total;
      r.dsr_extra_50_minutes = dsr.dsr50;
      r.dsr_extra_100_minutes = dsr.dsr100;
    }
  }
  return results;
}

/**
 * Processa o mês do funcionário.
 */
export async function processEmployeeMonth(
  employeeId: string,
  companyId: string,
  year: number,
  month: number
): Promise<DaySummary[]> {
  const results: DaySummary[] = [];
  const companyRules = await getCompanyRules(companyId);
  const lastDay = new Date(year, month, 0).getDate();
  for (let d = 1; d <= lastDay; d++) {
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    results.push(await processEmployeeDay(employeeId, companyId, dateStr));
  }
  if (companyRules.dsr_enabled) {
    const byWeek = new Map<string, DaySummary[]>();
    for (const r of results) {
      const key = weekMondayKey(r.date);
      if (!byWeek.has(key)) byWeek.set(key, []);
      byWeek.get(key)!.push(r);
    }
    for (const group of byWeek.values()) {
      const dsr = weekDsrSplitFromGroup(group);
      for (const r of group) {
        r.dsr_minutes = dsr.total;
        r.dsr_extra_50_minutes = dsr.dsr50;
        r.dsr_extra_100_minutes = dsr.dsr100;
      }
    }
  }
  return results;
}

/**
 * Helper para montar o espelho mensal (timesheet) de um colaborador.
 * Usado por rotas API externas sem acoplar diretamente ao client do Supabase.
 */
export async function buildTimesheetForPeriod(params: {
  supabase?: unknown; // mantido apenas para compatibilidade com chamadas existentes
  employeeId: string;
  companyId?: string;
  year: number;
  month: number;
}): Promise<DaySummary[]> {
  const { employeeId, companyId, year, month } = params;
  // Reaproveita o motor interno, usando companyId vazio se não fornecido.
  return processEmployeeMonth(employeeId, companyId ?? '', year, month);
}

function defaultSchedule(): WorkScheduleInfo {
  return {
    start_time: '08:00',
    end_time: '17:00',
    break_start: '12:00',
    break_end: '13:00',
    tolerance_minutes: 10,
    daily_hours: 8,
    work_days: [1, 2, 3, 4, 5],
  };
}

/**
 * Persiste inconsistências na tabela time_inconsistencies (evita duplicar por data/funcionário/tipo).
 */
export async function saveInconsistencies(
  employeeId: string,
  companyId: string,
  dateStr: string,
  inconsistencies: TimeInconsistency[]
): Promise<void> {
  if (!isSupabaseConfigured() || inconsistencies.length === 0) return;
  for (const inc of inconsistencies) {
    await db.insert('time_inconsistencies', {
      employee_id: employeeId,
      company_id: companyId,
      date: dateStr,
      type: inc.type,
      description: inc.description,
      resolved: false,
    }).catch((err) => {
      if (import.meta.env?.DEV) {
        observabilityConsole.warn('[timeEngine] Falha ao salvar inconsistência:', err);
      }
    });
  }
}

/**
 * Persiste horas noturnas em night_hours (upsert por employee_id + date).
 */
export async function saveNightHours(
  employeeId: string,
  companyId: string,
  dateStr: string,
  minutes: number
): Promise<void> {
  if (!isSupabaseConfigured()) return;
  const existing = (await db.select(
    'night_hours',
    [
      { column: 'employee_id', operator: 'eq', value: employeeId },
      { column: 'date', operator: 'eq', value: dateStr },
    ],
    undefined,
    1
  )) as any[];
  const payload = { employee_id: employeeId, company_id: companyId, date: dateStr, minutes, updated_at: new Date().toISOString() };
  if (existing?.[0]?.id) {
    await db.update('night_hours', existing[0].id, payload);
  } else {
    await db.insert('night_hours', payload);
  }
}

/**
 * Banco de horas: crédito (hora extra) ou débito (falta). Atualiza bank_hours e retorna saldo.
 */
export async function calculateBankHours(
  employeeId: string,
  companyId: string,
  dateStr: string,
  overtimeHours: number,
  missingHours: number,
  bankHoursEnabled: boolean
): Promise<{ balance: number; credited: number; debited: number }> {
  if (!bankHoursEnabled) return { balance: 0, credited: 0, debited: 0 };
  const toAdd = Math.max(0, overtimeHours);
  const toRemove = Math.max(0, missingHours);
  const { balance } = await updateBankHours(
    employeeId,
    companyId,
    dateStr,
    toAdd,
    toRemove,
    'engine_daily'
  );
  return { balance, credited: toAdd, debited: toRemove };
}

/**
 * Detecção de fraude/alertas: marcações muito próximas, jornada > 16h, intervalo obrigatório.
 */
export function detectFraudAlerts(
  employeeId: string,
  dateStr: string,
  records: RawTimeRecord[],
  totalWorkedMinutes: number,
  breakMinutes: number
): { type: string; description: string; severity: 'info' | 'warning' | 'critical' }[] {
  const alerts: { type: string; description: string; severity: 'info' | 'warning' | 'critical' }[] = [];
  const sorted = [...records].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );
  for (let i = 1; i < sorted.length; i++) {
    const prev = new Date(sorted[i - 1].created_at);
    const curr = new Date(sorted[i].created_at);
    const diffMs = curr.getTime() - prev.getTime();
    if (diffMs > 0 && diffMs < FRAUD_MIN_INTERVAL_MS) {
      alerts.push({
        type: 'punch_too_close',
        description: `Marcações com menos de 1 minuto de diferença (${sorted[i - 1].type} → ${sorted[i].type})`,
        severity: 'warning',
      });
    }
  }
  if (totalWorkedMinutes > MAX_WORK_MINUTES_PER_DAY) {
    alerts.push({
      type: 'impossible_journey',
      description: `Jornada superior a 16 horas (${(totalWorkedMinutes / 60).toFixed(1)}h)`,
      severity: 'critical',
    });
  }
  if (totalWorkedMinutes > MIN_BREAK_IF_WORK_OVER && breakMinutes < 30) {
    alerts.push({
      type: 'missing_break',
      description: 'Jornada superior a 6 horas sem intervalo mínimo de 30 min',
      severity: 'warning',
    });
  }
  return alerts;
}

/**
 * Persiste alertas em time_alerts.
 */
export async function saveTimeAlerts(
  employeeId: string,
  companyId: string,
  dateStr: string,
  alerts: { type: string; description: string; severity: string }[]
): Promise<void> {
  if (!isSupabaseConfigured() || alerts.length === 0) return;
  for (const a of alerts) {
    await db.insert('time_alerts', {
      employee_id: employeeId,
      company_id: companyId,
      date: dateStr,
      type: a.type,
      description: a.description,
      severity: a.severity,
      resolved: false,
    }).catch((err) => {
      if (import.meta.env?.DEV) {
        observabilityConsole.warn('[timeEngine] Falha ao salvar alerta:', err);
      }
    });
  }
}
