/**
 * Colunas extras do espelho: Hora Extra (sinalizada) e Justificativa do dia.
 */
import type { DayMirror, TimeRecord } from './timesheetMirror';

const STATUS_TAG_REGEX = /^\[STATUS:(FOLGA|FALTA|EXTRA)\]/i;
const EMPTY = '-';

export type TimesheetDailyOvertimeRow = {
  overtimeMinutes: number;
  negativeMinutes: number;
};

export type ApprovedAdjustmentJustification = {
  adjustment_date: string;
  reason: string;
};

/** Formata minutos líquidos como +HH:MM ou -HH:MM (ex.: +01:30, -00:45). */
export function formatSignedOvertimeDisplay(
  overtimeMinutes: number,
  negativeMinutes: number,
): string {
  const positive = Math.max(0, Number(overtimeMinutes) || 0);
  const negative = Math.max(0, Number(negativeMinutes) || 0);
  const net = positive - negative;
  if (net === 0 && positive === 0 && negative === 0) return EMPTY;
  const sign = net >= 0 ? '+' : '-';
  const abs = Math.abs(net);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `${sign}${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function cleanManualReason(reason: string): string | null {
  const trimmed = reason.trim();
  if (!trimmed || STATUS_TAG_REGEX.test(trimmed)) return null;
  const withoutRequestPrefix = trimmed.replace(/^Aprovado via solicitação [^:]+:\s*/i, '').trim();
  return withoutRequestPrefix || trimmed;
}

/** Agrega justificativas do dia (batidas manuais + solicitações aprovadas). */
export function collectDayJustification(
  day: Pick<DayMirror, 'date' | 'records'>,
  approvedAdjustments?: ApprovedAdjustmentJustification[],
): string {
  const parts: string[] = [];

  for (const record of day.records) {
    const reason = cleanManualReason(String(record.manual_reason || ''));
    if (reason) parts.push(reason);
  }

  for (const req of approvedAdjustments ?? []) {
    if (req.adjustment_date === day.date) {
      const reason = String(req.reason || '').trim();
      if (reason) parts.push(reason);
    }
  }

  const unique = [...new Set(parts.map((p) => p.trim()).filter(Boolean))];
  return unique.length ? unique.join('; ') : EMPTY;
}

/** Hora extra líquida a partir do total do espelho e da jornada esperada (mesma fórmula do motor). */
export function computeMirrorNetOvertime(
  workedMinutes: number,
  expectedMinutes: number,
): TimesheetDailyOvertimeRow {
  const worked = Math.max(0, Math.round(Number(workedMinutes) || 0));
  const expected = Math.max(0, Math.round(Number(expectedMinutes) || 0));
  if (expected === 0) {
    return { overtimeMinutes: worked, negativeMinutes: 0 };
  }
  if (worked >= expected) {
    return { overtimeMinutes: worked - expected, negativeMinutes: 0 };
  }
  return { overtimeMinutes: 0, negativeMinutes: expected - worked };
}

export function mirrorOvertimeNetMinutes(
  overtimeMinutes: number,
  negativeMinutes: number,
): number {
  return Math.max(0, Number(overtimeMinutes) || 0) - Math.max(0, Number(negativeMinutes) || 0);
}

/** Indica se a hora extra persistida diverge do espelho (drift, REP pendente ou totais diferentes). */
export function shouldShowMirrorOvertimeEstimate(input: {
  hasDrift?: boolean;
  hasRepPending?: boolean;
  mirrorWorkedMinutes: number;
  expectedMinutes: number;
  persistedOvertimeMinutes: number;
  persistedNegativeMinutes: number;
  persistedWorkedMinutes?: number | null;
  toleranceMinutes?: number;
}): boolean {
  const tolerance = input.toleranceMinutes ?? 2;
  if (input.mirrorWorkedMinutes <= 0) return false;
  if (input.hasDrift || input.hasRepPending) return true;
  if (
    input.persistedWorkedMinutes != null &&
    Math.abs(input.persistedWorkedMinutes - input.mirrorWorkedMinutes) > tolerance
  ) {
    return true;
  }
  if (input.expectedMinutes <= 0) return false;
  const mirror = computeMirrorNetOvertime(input.mirrorWorkedMinutes, input.expectedMinutes);
  const mirrorNet = mirrorOvertimeNetMinutes(mirror.overtimeMinutes, mirror.negativeMinutes);
  const persistedNet = mirrorOvertimeNetMinutes(
    input.persistedOvertimeMinutes,
    input.persistedNegativeMinutes,
  );
  return Math.abs(mirrorNet - persistedNet) > tolerance;
}

export function parseTimesheetDailyOvertime(row: {
  overtime_minutes?: unknown;
  negative_minutes?: unknown;
  raw_data?: unknown;
}): TimesheetDailyOvertimeRow {
  const raw =
    row.raw_data && typeof row.raw_data === 'object' && !Array.isArray(row.raw_data)
      ? (row.raw_data as Record<string, unknown>)
      : {};
  const overtimeMinutes = Math.max(
    0,
    Number(row.overtime_minutes ?? raw.extra_minutes ?? raw.overtime_minutes ?? 0) || 0,
  );
  const negativeMinutes = Math.max(
    0,
    Number(row.negative_minutes ?? raw.negative_minutes ?? 0) || 0,
  );
  return { overtimeMinutes, negativeMinutes };
}

export function extractAdjustmentMetaFromRequest(row: {
  type?: string | null;
  status?: string | null;
  reason?: string | null;
  metadata?: unknown;
}): ApprovedAdjustmentJustification | null {
  if (String(row.type || '').toLowerCase() !== 'adjustment') return null;
  if (String(row.status || '').toLowerCase() !== 'approved') return null;
  const md =
    row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
      ? (row.metadata as Record<string, unknown>)
      : null;
  const adjustment_date = String(md?.adjustment_date ?? '').trim().slice(0, 10);
  const reason = String(row.reason ?? '').trim();
  if (!adjustment_date || !reason) return null;
  return { adjustment_date, reason };
}

export function isStatusTaggedRecord(record: Pick<TimeRecord, 'manual_reason'>): boolean {
  return STATUS_TAG_REGEX.test(String(record.manual_reason || ''));
}
