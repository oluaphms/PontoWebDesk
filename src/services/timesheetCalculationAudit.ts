/**
 * Contexto de cálculo, hash de integridade, trilha de auditoria e replay (sem novas colunas).
 */

import { getSupabaseClient } from './supabaseClient';
import type { RawTimeRecord } from './timeProcessingService';
import { appendTimeAttendanceTimelineEvent } from './timeAttendanceTimeline.service';
import {
  TimeAttendanceTimelineEventType,
  TimeAttendanceTimelineSeverity,
} from './timeAttendanceTimeline.constants';

const DEFAULT_ENGINE_VERSION = 'v1.3.0';
const DEFAULT_RULES_VERSION = 'rules-v1';

/** Rastro legível do cálculo persistido em `timesheets_daily.raw_data` (sem coluna nova). */
export type CalculationTraceSource =
  | 'batidas'
  | 'fallback_schedule'
  | 'manual'
  | 'replay'
  | 'integration';

export type CalculationDecisionStepResult = 'applied' | 'ignored' | 'fallback' | 'error';

/** Passo da árvore de decisão do motor (curto, sem batidas brutas). */
export type CalculationDecisionStep = {
  step: string;
  result: CalculationDecisionStepResult;
  reason?: string;
  metadata?: Record<string, unknown>;
};

/** Teto de passos persistidos — evita JSON grande e trilhas verbosas. */
export const CALC_DECISION_TREE_MAX_STEPS = 24;

export function normalizeDecisionTree(steps: CalculationDecisionStep[]): CalculationDecisionStep[] {
  if (steps.length <= CALC_DECISION_TREE_MAX_STEPS) return steps;
  return steps.slice(-CALC_DECISION_TREE_MAX_STEPS);
}

export function coerceDecisionTreeSteps(raw: unknown): CalculationDecisionStep[] {
  if (!Array.isArray(raw)) return [];
  const out: CalculationDecisionStep[] = [];
  const okResult = (r: unknown): r is CalculationDecisionStepResult =>
    r === 'applied' || r === 'ignored' || r === 'fallback' || r === 'error';
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const o = item as Record<string, unknown>;
    const step = typeof o.step === 'string' ? o.step.trim() : '';
    if (!step || !okResult(o.result)) continue;
    const row: CalculationDecisionStep = { step, result: o.result };
    if (typeof o.reason === 'string' && o.reason.trim()) row.reason = o.reason.trim();
    if (o.metadata && typeof o.metadata === 'object' && !Array.isArray(o.metadata)) {
      row.metadata = { ...(o.metadata as Record<string, unknown>) };
    }
    out.push(row);
  }
  return out;
}

/**
 * Árvore determinística após o cálculo do dia (recálculo / pré-folha).
 * Somente contagens e flags — nunca lista de batidas.
 */
export function buildPersistDayDecisionTree(input: {
  hasScheduleForDay: boolean;
  usedScheduleId?: string | null;
  punchCount: number;
  hadEntradaSaidaPair: boolean;
  contingencyScheduleFallback: boolean;
  incomplete: boolean;
  missingClockOut: boolean;
}): CalculationDecisionStep[] {
  const steps: CalculationDecisionStep[] = [];

  const idMeta: Record<string, unknown> = {};
  if (input.usedScheduleId) idMeta.schedule_id = input.usedScheduleId;
  steps.push({
    step: 'identify_schedule',
    result: input.hasScheduleForDay ? 'applied' : 'fallback',
    reason: input.hasScheduleForDay ? undefined : 'no_schedule_for_day',
    ...(Object.keys(idMeta).length > 0 ? { metadata: idMeta } : {}),
  });

  let pairResult: CalculationDecisionStepResult;
  let pairReason: string | undefined;
  if (input.punchCount === 0) {
    pairResult = 'ignored';
    pairReason = 'no_punches';
  } else if (!input.hadEntradaSaidaPair) {
    pairResult = 'fallback';
    pairReason = input.missingClockOut ? 'missing_clock_out' : 'incomplete_punch_sequence';
  } else {
    pairResult = 'applied';
  }

  steps.push({
    step: 'pair_punches',
    result: pairResult,
    reason: pairReason,
    metadata: { punch_count: input.punchCount },
  });

  if (input.contingencyScheduleFallback) {
    steps.push({
      step: 'apply_fallback_schedule',
      result: 'applied',
      reason: 'contingency_schedule_fallback',
    });
  }

  steps.push({
    step: 'finalize_day_totals',
    result: input.incomplete ? 'ignored' : 'applied',
    reason: input.incomplete ? 'incomplete_day' : undefined,
    metadata: { incomplete: input.incomplete },
  });

  return normalizeDecisionTree(steps);
}

export type CalculationTrace = {
  source: CalculationTraceSource;
  used_schedule_id?: string;
  ignored_punches?: string[];
  promoted_punches?: string[];
  replay_reason?: string;
  engine_version?: string;
  decision_tree?: CalculationDecisionStep[];
};

const CALC_TRACE_SOURCES_VALID: ReadonlySet<string> = new Set([
  'batidas',
  'fallback_schedule',
  'manual',
  'replay',
  'integration',
]);

/** Lê `calculation_trace` já persistido em `raw_data` (UI / timeline / incidentes). */
export function parseCalculationTraceFromRawData(raw: unknown): CalculationTrace | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const tr = (raw as Record<string, unknown>).calculation_trace;
  if (!tr || typeof tr !== 'object' || Array.isArray(tr)) return null;
  const o = tr as Record<string, unknown>;
  const src = o.source;
  if (typeof src !== 'string' || !CALC_TRACE_SOURCES_VALID.has(src)) return null;
  const decision_tree = coerceDecisionTreeSteps(o.decision_tree);
  return {
    source: src as CalculationTraceSource,
    used_schedule_id: typeof o.used_schedule_id === 'string' ? o.used_schedule_id : undefined,
    ignored_punches: Array.isArray(o.ignored_punches) ? o.ignored_punches.map(String) : undefined,
    promoted_punches: Array.isArray(o.promoted_punches) ? o.promoted_punches.map(String) : undefined,
    replay_reason: typeof o.replay_reason === 'string' ? o.replay_reason : undefined,
    engine_version: typeof o.engine_version === 'string' ? o.engine_version : undefined,
    decision_tree: decision_tree.length > 0 ? decision_tree : undefined,
  };
}

/**
 * Versão lógica do motor no momento do cálculo (ENV em produção; fallback fixo em dev).
 */
export function getCurrentEngineVersion(): string {
  const fromEnv =
    (typeof process !== 'undefined' &&
      (process.env?.ENGINE_VERSION || process.env?.VITE_ENGINE_VERSION)) ||
    (typeof import.meta !== 'undefined' &&
      import.meta.env &&
      (import.meta.env as { VITE_ENGINE_VERSION?: string }).VITE_ENGINE_VERSION);
  const v = typeof fromEnv === 'string' && fromEnv.trim() ? fromEnv.trim() : DEFAULT_ENGINE_VERSION;
  return v;
}

/** Versão do pacote de regras (ENV em produção). */
export function getCurrentRulesVersion(): string {
  const fromEnv =
    (typeof process !== 'undefined' &&
      (process.env?.RULES_VERSION || process.env?.VITE_RULES_VERSION)) ||
    (typeof import.meta !== 'undefined' &&
      import.meta.env &&
      (import.meta.env as { VITE_RULES_VERSION?: string }).VITE_RULES_VERSION);
  const v = typeof fromEnv === 'string' && fromEnv.trim() ? fromEnv.trim() : DEFAULT_RULES_VERSION;
  return v;
}

export function buildCalculationTrace(params: {
  calculation_type: 'normal' | 'fallback';
  trace_source?: CalculationTraceSource;
  used_schedule_id?: string | null;
  ignored_punch_ids?: string[];
  promoted_punch_ids?: string[];
  replay_reason?: string | null;
  decision_tree?: CalculationDecisionStep[];
}): CalculationTrace {
  const source: CalculationTraceSource =
    params.trace_source ?? (params.calculation_type === 'fallback' ? 'fallback_schedule' : 'batidas');
  const trace: CalculationTrace = {
    source,
    engine_version: getCurrentEngineVersion(),
  };
  const sid = params.used_schedule_id != null ? String(params.used_schedule_id).trim() : '';
  if (sid) trace.used_schedule_id = sid;
  if (params.ignored_punch_ids?.length) trace.ignored_punches = [...params.ignored_punch_ids];
  if (params.promoted_punch_ids?.length) trace.promoted_punches = [...params.promoted_punch_ids];
  const rr = params.replay_reason != null ? String(params.replay_reason).trim() : '';
  if (rr) trace.replay_reason = rr;
  if (params.decision_tree?.length) trace.decision_tree = normalizeDecisionTree(params.decision_tree);
  return trace;
}

export type CalculationContext = {
  punches: unknown[];
  schedule_used: unknown;
  calculation_type: 'normal' | 'fallback';
  engine_version: string;
  rules_version: string;
  calculated_at: string;
};

export type AuditTrailEvent = {
  action: 'calculated' | 'recalculated' | 'skipped';
  timestamp: string;
  reason: string;
  correlation_id: string;
};

export type CalculationResultSnapshot = {
  worked_minutes: number;
  expected_minutes: number;
  overtime_minutes: number;
  absence_minutes: number;
  night_minutes: number;
  late_minutes: number;
  is_absence: boolean;
  is_holiday: boolean;
};

const AUDIT_TRAIL_MAX = 10;

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableStringify(v)).join(',')}]`;
  }
  const keys = Object.keys(value as Record<string, unknown>).sort();
  const obj = value as Record<string, unknown>;
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

export function buildCalculationContext(input: {
  punches: unknown[];
  schedule_used: unknown;
  calculation_type: 'normal' | 'fallback';
  engine_version?: string;
  rules_version?: string;
  calculated_at?: string;
}): CalculationContext {
  return {
    punches: input.punches,
    schedule_used: input.schedule_used,
    calculation_type: input.calculation_type,
    engine_version: input.engine_version ?? getCurrentEngineVersion(),
    rules_version: input.rules_version ?? getCurrentRulesVersion(),
    calculated_at: input.calculated_at ?? new Date().toISOString(),
  };
}

/** Comparação estável (ignora `calculated_at`) para detecção de mudança real de insumos. */
export function normalizeContextForAuditCompare(ctx: unknown): Record<string, unknown> {
  if (!ctx || typeof ctx !== 'object') {
    return {
      punches: [],
      schedule_used: null,
      calculation_type: 'normal',
      engine_version: getCurrentEngineVersion(),
      rules_version: getCurrentRulesVersion(),
    };
  }
  const o = ctx as Record<string, unknown>;
  return {
    punches: o.punches ?? [],
    schedule_used: o.schedule_used ?? null,
    calculation_type: o.calculation_type ?? 'normal',
    engine_version: o.engine_version ?? getCurrentEngineVersion(),
    rules_version: o.rules_version ?? getCurrentRulesVersion(),
  };
}

export function contextsSemanticallyEqual(a: unknown, b: unknown): boolean {
  return stableStringify(normalizeContextForAuditCompare(a)) === stableStringify(normalizeContextForAuditCompare(b));
}

export async function hashCalculationIntegrity(
  context: CalculationContext,
  result: CalculationResultSnapshot,
): Promise<string> {
  const combined = stableStringify({
    calculation_context: context,
    resultado: result,
  });
  return sha256Hex(combined);
}

async function sha256Hex(message: string): Promise<string> {
  const enc = new TextEncoder().encode(message);
  if (typeof globalThis.crypto?.subtle?.digest === 'function') {
    const buf = await globalThis.crypto.subtle.digest('SHA-256', enc);
    return Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
  let h = 5381;
  for (let i = 0; i < message.length; i++) {
    h = (h * 33) ^ message.charCodeAt(i);
  }
  return `legacy_${(h >>> 0).toString(16).padStart(8, '0')}_${message.length}`;
}

export function snapshotPunchesFromRecords(records: RawTimeRecord[]): unknown[] {
  return [...records]
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
    .map((r) => ({
      id: r.id,
      created_at: r.created_at,
      timestamp: r.timestamp ?? null,
      type: r.type,
    }));
}

export function appendAuditTrail(
  raw: Record<string, unknown>,
  event: Omit<AuditTrailEvent, 'timestamp'> & { timestamp?: string },
  max = AUDIT_TRAIL_MAX,
): AuditTrailEvent[] {
  const prev = Array.isArray(raw.audit_trail) ? [...(raw.audit_trail as AuditTrailEvent[])] : [];
  const next: AuditTrailEvent = {
    timestamp: event.timestamp ?? new Date().toISOString(),
    action: event.action,
    reason: event.reason,
    correlation_id: event.correlation_id,
  };
  const merged = [...prev, next].slice(-max);
  raw.audit_trail = merged;
  return merged;
}

export function computeRecordReliabilityScore(params: {
  calculation_type: 'normal' | 'fallback';
  hadPreviousError: boolean;
}): number {
  let score = 1.0;
  if (params.calculation_type === 'fallback') score -= 0.2;
  if (params.hadPreviousError) score -= 0.3;
  return Math.max(0, Math.min(1, Math.round(score * 1000) / 1000));
}

function newCorrelationId(): string {
  if (typeof globalThis.crypto !== 'undefined' && typeof globalThis.crypto.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return `cid-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function applyCalculationAuditToRaw(params: {
  mergedRaw: Record<string, unknown>;
  resultSnapshot: CalculationResultSnapshot;
  auditInput?: {
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
  previousRaw: Record<string, unknown> | undefined;
  auditAction: 'calculated' | 'recalculated' | 'skipped';
  auditReason: string;
}): Promise<void> {
  const { mergedRaw, resultSnapshot, auditInput, previousRaw, auditAction, auditReason } = params;

  const inferredFallback =
    mergedRaw.has_schedule_issue === true || mergedRaw.contingency_schedule_fallback === true;
  const calculation_type: 'normal' | 'fallback' =
    auditInput?.calculation_type ?? (inferredFallback ? 'fallback' : 'normal');

  const punches = auditInput?.punches ?? [];
  const schedule_used = auditInput?.schedule_used !== undefined ? auditInput.schedule_used : null;

  const oldCtx = previousRaw?.calculation_context;
  const newCtx = buildCalculationContext({
    punches,
    schedule_used,
    calculation_type,
  });

  if (!contextsSemanticallyEqual(oldCtx, newCtx)) {
    console.info('[CALC CONTEXT CHANGE DETECTED]', {
      calculation_type: newCtx.calculation_type,
    });
    mergedRaw.recalculated_due_to_change = true;
  } else {
    mergedRaw.recalculated_due_to_change = false;
  }

  const correlation_id = auditInput?.correlation_id ?? newCorrelationId();
  const hash = await hashCalculationIntegrity(newCtx, resultSnapshot);

  mergedRaw.calculation_context = newCtx;
  mergedRaw.calculation_hash = hash;
  mergedRaw.last_calculated_at = newCtx.calculated_at;

  const hadPreviousError =
    previousRaw?.error != null ||
    (typeof previousRaw?.error === 'string' && String(previousRaw.error).length > 0);

  mergedRaw.reliability_score = computeRecordReliabilityScore({
    calculation_type,
    hadPreviousError,
  });

  appendAuditTrail(mergedRaw, {
    action: auditAction,
    reason: auditReason,
    correlation_id,
  });

  mergedRaw.calculation_trace = buildCalculationTrace({
    calculation_type,
    trace_source: auditInput?.trace_source,
    used_schedule_id: auditInput?.used_schedule_id,
    ignored_punch_ids: auditInput?.ignored_punch_ids,
    promoted_punch_ids: auditInput?.promoted_punch_ids,
    decision_tree: auditInput?.decision_tree,
  });

  /** Novo cálculo autoritativo: remove marcações de replay anterior (drift ≠ erro). */
  mergedRaw.context_drift = false;
  mergedRaw.drift_reason = null;
}

const REPLAY_RELIABILITY_PENALTY = 0.15;

export type ReplayTimesheetStatus = 'ok' | 'inconsistent' | 'drift' | 'error';

export type ReplayTimesheetResult = {
  ok: boolean;
  status: ReplayTimesheetStatus;
  timesheet_id: string;
  /** `rules` / `engine` — mesmo valor persistido em `raw_data.drift_reason`. */
  drift_reason?: 'rules' | 'engine';
  /** Alias semântico para relatórios / API. */
  reason?: 'rules_changed' | 'engine_changed';
  /** Compat: `true` quando `status === 'inconsistent'` */
  inconsistent?: boolean;
  message?: string;
  stored?: CalculationResultSnapshot;
  replayed?: CalculationResultSnapshot;
};

function parseReliability(raw: Record<string, unknown>): number {
  const r = raw.reliability_score;
  if (typeof r === 'number' && Number.isFinite(r)) return r;
  return 1.0;
}

function persistDriftReason(rulesDrift: boolean, engineDrift: boolean): 'rules' | 'engine' {
  if (rulesDrift) return 'rules';
  return 'engine';
}

/**
 * Após classificação de replay, persiste `raw_data` (drift / replay / penalidade de score).
 */
async function persistReplayMarking(
  timesheet_id: string,
  baseRaw: Record<string, unknown>,
  args: { status: ReplayTimesheetStatus; drift_reason?: 'rules' | 'engine' },
): Promise<void> {
  const client = getSupabaseClient();
  if (!client) return;
  const at = new Date().toISOString();
  const next: Record<string, unknown> = { ...baseRaw, last_replay_at: at };
  next.last_replay_status = args.status;

  const prevTr = baseRaw.calculation_trace;
  const prevObj =
    prevTr && typeof prevTr === 'object' && !Array.isArray(prevTr) ? { ...(prevTr as Record<string, unknown>) } : {};
  const replayHuman =
    args.status === 'drift'
      ? `Drift (${args.drift_reason === 'rules' ? 'regras' : args.drift_reason === 'engine' ? 'motor' : '—'})`
      : args.status === 'inconsistent'
        ? 'Inconsistência na verificação pós-cálculo'
        : args.status === 'ok'
          ? 'Verificação OK (sem drift)'
          : `Status: ${args.status}`;
  const prevTree = coerceDecisionTreeSteps(prevObj.decision_tree);
  const replayResult: CalculationDecisionStepResult =
    args.status === 'error'
      ? 'error'
      : args.status === 'inconsistent'
        ? 'ignored'
        : args.status === 'drift'
          ? 'fallback'
          : 'applied';
  const replayStep: CalculationDecisionStep = {
    step: 'replay_verification',
    result: replayResult,
    reason: replayHuman,
    metadata: { last_replay_status: args.status },
  };

  next.calculation_trace = {
    ...prevObj,
    source: 'replay',
    replay_reason: replayHuman,
    engine_version: getCurrentEngineVersion(),
    decision_tree: normalizeDecisionTree([...prevTree, replayStep]),
  };

  if (args.status === 'drift' && args.drift_reason) {
    next.context_drift = true;
    next.drift_reason = args.drift_reason;
  } else if (args.status === 'inconsistent') {
    next.context_drift = false;
    next.drift_reason = null;
    const prev = parseReliability(baseRaw);
    next.reliability_score = Math.max(
      0,
      Math.round((prev - REPLAY_RELIABILITY_PENALTY) * 1000) / 1000,
    );
  } else if (args.status === 'ok') {
    next.context_drift = false;
    next.drift_reason = null;
  }

  const { error: upErr } = await client.from('timesheets_daily').update({ raw_data: next }).eq('id', timesheet_id);
  if (upErr) {
    console.info('[CALC REPLAY] raw_data update failed', { timesheet_id, message: upErr.message });
  }
}

function scheduleReplayTimelineObservation(input: {
  company_id: string;
  employee_id: string;
  date: string;
  timesheet_id: string;
  status: ReplayTimesheetStatus | 'skipped' | 'error';
  trace: CalculationTrace | null;
  worked_minutes?: number;
  message?: string;
  drift_reason?: 'rules' | 'engine';
}): void {
  const sev =
    input.status === 'error'
      ? TimeAttendanceTimelineSeverity.high
      : input.status === 'inconsistent'
        ? TimeAttendanceTimelineSeverity.medium
        : TimeAttendanceTimelineSeverity.info;
  void appendTimeAttendanceTimelineEvent({
    companyId: input.company_id,
    employeeId: input.employee_id,
    date: input.date,
    eventType: TimeAttendanceTimelineEventType.TIMESHEET_REPLAY,
    eventSeverity: sev,
    sourceModule: 'timesheetCalculationAudit.replay',
    sourceReferenceId: input.timesheet_id,
    payload: {
      replay_status: input.status,
      engine_version: input.trace?.engine_version,
      calculation_trace_source: input.trace?.source,
      replay_reason: input.trace?.replay_reason,
      worked_minutes: input.worked_minutes,
      used_schedule_id: input.trace?.used_schedule_id,
      message: input.message,
      drift_reason: input.drift_reason,
    },
  });
}

/**
 * Recalcula o dia com o estado atual do banco e compara com a linha persistida.
 * Diferença de versão (motor/regras) + resultado ≠ → `drift` (esperado), não erro.
 */
export async function replayTimesheetCalculation(timesheet_id: string): Promise<ReplayTimesheetResult> {
  const client = getSupabaseClient();
  if (!client) {
    return { ok: false, status: 'error', timesheet_id, message: 'no_supabase_client' };
  }

  const { data: row, error } = await client
    .from('timesheets_daily')
    .select('id, employee_id, company_id, date, worked_minutes, expected_minutes, overtime_minutes, absence_minutes, night_minutes, late_minutes, is_absence, is_holiday, raw_data')
    .eq('id', timesheet_id)
    .maybeSingle();

  if (error || !row) {
    return { ok: false, status: 'error', timesheet_id, message: error?.message ?? 'not_found' };
  }

  const raw = (row.raw_data || {}) as Record<string, unknown>;
  const traceEarly = parseCalculationTraceFromRawData(raw);
  if (!raw.calculation_context) {
    console.info('[CALC REPLAY] sem calculation_context', { timesheet_id });
    scheduleReplayTimelineObservation({
      company_id: String(row.company_id),
      employee_id: String(row.employee_id),
      date: String(row.date).slice(0, 10),
      timesheet_id,
      status: 'skipped',
      trace: traceEarly,
      worked_minutes: Number(row.worked_minutes),
      message: 'no_context_skipped',
    });
    return { ok: true, status: 'ok', timesheet_id, message: 'no_context_skipped' };
  }

  const ctx = raw.calculation_context as CalculationContext;
  const storedEngine = String(ctx.engine_version ?? '').trim();
  const storedRules = String(ctx.rules_version ?? '').trim();
  const currentEngine = getCurrentEngineVersion();
  const currentRules = getCurrentRulesVersion();
  const hasStoredVersioning = Boolean(storedEngine || storedRules);
  const engineDrift = hasStoredVersioning && storedEngine !== currentEngine;
  const rulesDrift = hasStoredVersioning && storedRules !== currentRules;
  const versionDrift = engineDrift || rulesDrift;

  const { processEmployeeDay } = await import('../engine/timeEngine');
  const employee_id = String(row.employee_id);
  const company_id = String(row.company_id);
  const date = String(row.date).slice(0, 10);

  let summary;
  try {
    summary = await processEmployeeDay(employee_id, company_id, date);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.info('[CALC REPLAY ERROR]', { timesheet_id, message: msg });
    await persistReplayMarking(timesheet_id, raw, { status: 'error' });
    scheduleReplayTimelineObservation({
      company_id,
      employee_id,
      date,
      timesheet_id,
      status: 'error',
      trace: parseCalculationTraceFromRawData(raw),
      worked_minutes: Number(row.worked_minutes),
      message: msg,
    });
    return { ok: false, status: 'error', timesheet_id, message: msg };
  }

  const d = summary.daily;
  const replayed: CalculationResultSnapshot = {
    worked_minutes: d.total_worked_minutes,
    expected_minutes: d.expected_minutes,
    overtime_minutes: d.extra_minutes,
    absence_minutes: d.absence_minutes,
    night_minutes: summary.night_minutes,
    late_minutes: d.late_minutes,
    is_absence: d.absence_minutes > 0,
    is_holiday: d.day_type === 'HOLIDAY',
  };

  const stored: CalculationResultSnapshot = {
    worked_minutes: Number(row.worked_minutes),
    expected_minutes: Number(row.expected_minutes),
    overtime_minutes: Number(row.overtime_minutes),
    absence_minutes: Number(row.absence_minutes),
    night_minutes: Number(row.night_minutes),
    late_minutes: Number(row.late_minutes),
    is_absence: Boolean(row.is_absence),
    is_holiday: Boolean(row.is_holiday),
  };

  const resultsMatch = stableStringify(stored) === stableStringify(replayed);

  const trace = parseCalculationTraceFromRawData(raw);

  if (resultsMatch) {
    await persistReplayMarking(timesheet_id, raw, { status: 'ok' });
    scheduleReplayTimelineObservation({
      company_id,
      employee_id,
      date,
      timesheet_id,
      status: 'ok',
      trace,
      worked_minutes: Number(row.worked_minutes),
    });
    return { ok: true, status: 'ok', timesheet_id, stored, replayed };
  }

  if (versionDrift) {
    const dr = persistDriftReason(rulesDrift, engineDrift);
    console.info('[CALC CONTEXT DRIFT DETECTED]', {
      timesheet_id,
      employee_id,
      date,
      stored_engine: storedEngine,
      current_engine: currentEngine,
      stored_rules: storedRules,
      current_rules: currentRules,
      drift_reason: dr,
      stored,
      replayed,
    });
    await persistReplayMarking(timesheet_id, raw, { status: 'drift', drift_reason: dr });
    scheduleReplayTimelineObservation({
      company_id,
      employee_id,
      date,
      timesheet_id,
      status: 'drift',
      trace,
      worked_minutes: Number(row.worked_minutes),
      drift_reason: dr,
    });
    return {
      ok: true,
      status: 'drift',
      timesheet_id,
      drift_reason: dr,
      reason: dr === 'rules' ? 'rules_changed' : 'engine_changed',
      stored,
      replayed,
    };
  }

  let hashDivergent = false;
  if (typeof raw.calculation_hash === 'string' && raw.calculation_context) {
    const expectedHash = await hashCalculationIntegrity(ctx, stored);
    hashDivergent = expectedHash !== raw.calculation_hash;
  }

  console.info('[CALC INCONSISTENCY DETECTED]', {
    timesheet_id,
    employee_id,
    date,
    hashDivergent,
    stored,
    replayed,
  });
  await persistReplayMarking(timesheet_id, raw, { status: 'inconsistent' });

  scheduleReplayTimelineObservation({
    company_id,
    employee_id,
    date,
    timesheet_id,
    status: 'inconsistent',
    trace,
    worked_minutes: Number(row.worked_minutes),
    message: hashDivergent ? 'hash_divergent' : 'snapshot_mismatch',
  });

  return {
    ok: true,
    status: 'inconsistent',
    timesheet_id,
    inconsistent: true,
    stored,
    replayed,
  };
}
