/**
 * Status de processamento e saúde do período (sem colunas novas no banco).
 */

export type TimesheetWriteOutcome =
  | 'written'
  | 'skipped_integrity'
  | 'skipped_closed'
  | 'skipped_protected'
  | 'skipped_noop';

export type TimesheetProcessingStatus =
  | 'ok'
  | 'fallback_schedule'
  | 'skipped_invalid_employee'
  | 'protected'
  | 'error';

export type PeriodHealthStatus = 'complete' | 'partial' | 'degraded' | 'failed';

export type PeriodCalcMetricsInput = {
  total_processed: number;
  success_count: number;
  skipped_count: number;
  error_count: number;
  schedule_missing_count: number;
  fk_avoided_count: number;
  duration_ms: number;
  degraded: boolean;
};

function asRawRecord(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  return {};
}

/**
 * Status usado após write / para linhas em memória (inclui outcome do writer quando existir).
 */
export function processingStatusFromWrite(
  outcome: TimesheetWriteOutcome,
  payloadRaw?: Record<string, unknown> | null,
): TimesheetProcessingStatus {
  const raw = payloadRaw || {};
  switch (outcome) {
    case 'skipped_integrity':
      return 'skipped_invalid_employee';
    case 'skipped_closed':
    case 'skipped_protected':
      return 'protected';
    case 'written':
    case 'skipped_noop': {
      if (raw.error != null && String(raw.error).length > 0) return 'error';
      if (raw.has_schedule_issue === true) return 'fallback_schedule';
      return 'ok';
    }
    default:
      return 'ok';
  }
}

/**
 * Status derivado de uma linha (DB ou DTO) — nunca null/undefined.
 */
export function deriveTimesheetProcessingStatus(row: {
  raw_data?: unknown;
  write_outcome?: TimesheetWriteOutcome;
}): TimesheetProcessingStatus {
  if (row.write_outcome) {
    return processingStatusFromWrite(row.write_outcome, asRawRecord(row.raw_data));
  }
  const raw = asRawRecord(row.raw_data);
  if (raw.error != null && String(raw.error).length > 0) return 'error';
  if (raw.manual_entry === true) return 'protected';
  if (raw.status === 'closed') return 'protected';
  if (raw.has_schedule_issue === true) return 'fallback_schedule';
  if (raw.skip_reason === 'invalid_employee' || raw.integrity_fail === true) {
    return 'skipped_invalid_employee';
  }
  return 'ok';
}

/**
 * Saúde agregada do período a partir das métricas do loop de cálculo.
 */
export function derivePeriodHealth(metrics: PeriodCalcMetricsInput): PeriodHealthStatus {
  const tp = Math.max(1, metrics.total_processed);
  const errRate = metrics.error_count / tp;

  if (metrics.degraded) return 'degraded';
  if (errRate > 0.5) return 'failed';
  if (metrics.error_count === 0 && metrics.skipped_count === 0) return 'complete';
  if (metrics.error_count > 0 && errRate < 0.3) return 'partial';
  if (metrics.error_count > 0) return 'partial';
  if (metrics.skipped_count > 0) return 'partial';
  return 'complete';
}

export type TimesheetUIRow<T extends Record<string, unknown> = Record<string, unknown>> = T & {
  processing_status: TimesheetProcessingStatus;
  is_reliable: boolean;
  has_warnings: boolean;
  is_auditable: boolean;
  reliability_score: number;
  last_calculated_at?: string;
  has_context: boolean;
  has_drift: boolean;
  drift_reason?: 'rules' | 'engine';
  replay_status?: 'ok' | 'inconsistent' | 'drift' | 'error';
};

function deriveUiReliabilityScore(raw: Record<string, unknown>): number {
  if (typeof raw.reliability_score === 'number' && Number.isFinite(raw.reliability_score)) {
    return raw.reliability_score;
  }
  let score = 1.0;
  if (raw.has_schedule_issue === true || raw.contingency_schedule_fallback === true) score -= 0.2;
  if (raw.error != null && String(raw.error).length > 0) score -= 0.3;
  return Math.max(0, Math.min(1, Math.round(score * 1000) / 1000));
}

function pickLastCalculatedAt(raw: Record<string, unknown>): string | undefined {
  if (typeof raw.last_calculated_at === 'string') return raw.last_calculated_at;
  const ctx = raw.calculation_context;
  if (
    ctx &&
    typeof ctx === 'object' &&
    'calculated_at' in ctx &&
    typeof (ctx as { calculated_at?: unknown }).calculated_at === 'string'
  ) {
    return (ctx as { calculated_at: string }).calculated_at;
  }
  return undefined;
}

/**
 * Adapter para o frontend: estado explícito, sem interpretação ad hoc na UI.
 */
function pickReplayStatus(raw: Record<string, unknown>): 'ok' | 'inconsistent' | 'drift' | 'error' | undefined {
  const s = raw.last_replay_status;
  if (s === 'ok' || s === 'inconsistent' || s === 'drift' || s === 'error') return s;
  return undefined;
}

function pickDriftReason(raw: Record<string, unknown>): 'rules' | 'engine' | undefined {
  const d = raw.drift_reason;
  if (d === 'rules' || d === 'engine') return d;
  return undefined;
}

export function mapTimesheetForUI<T extends Record<string, unknown>>(row: T): TimesheetUIRow<T> {
  const raw = asRawRecord((row as { raw_data?: unknown }).raw_data);
  const processing_status = deriveTimesheetProcessingStatus(row as { raw_data?: unknown });
  const reliability_score = deriveUiReliabilityScore(raw);
  return {
    ...row,
    processing_status,
    is_reliable: processing_status === 'ok',
    has_warnings: processing_status !== 'ok',
    is_auditable: true,
    reliability_score,
    last_calculated_at: pickLastCalculatedAt(raw),
    has_context: Boolean(raw.calculation_context),
    has_drift: Boolean(raw.context_drift),
    drift_reason: pickDriftReason(raw),
    replay_status: pickReplayStatus(raw),
  };
}
