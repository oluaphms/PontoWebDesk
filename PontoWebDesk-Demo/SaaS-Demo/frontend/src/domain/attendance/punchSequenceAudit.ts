/**
 * Auditoria de sequência de batidas — registrar sempre, validar depois.
 * Não bloqueia registro; produz códigos para espelho, RH e monitoramento.
 */

import type { RawTimeRecord } from '../../services/timeProcessingService';
import { normalizePunchType } from '../../services/timeProcessingService';

export const PUNCH_SEQUENCE_INCONSISTENCY_CODES = {
  MISSING_ENTRY: 'MISSING_ENTRY',
  INTERVAL_WITHOUT_ENTRY: 'INTERVAL_WITHOUT_ENTRY',
  RETURN_WITHOUT_INTERVAL_START: 'RETURN_WITHOUT_INTERVAL_START',
  EXIT_WITHOUT_ENTRY: 'EXIT_WITHOUT_ENTRY',
  EXIT_WITHOUT_INTERVAL_RETURN: 'EXIT_WITHOUT_INTERVAL_RETURN',
  DUPLICATE_INTERVAL_START: 'DUPLICATE_INTERVAL_START',
  EXIT_WITHOUT_NEW_ENTRY: 'EXIT_WITHOUT_NEW_ENTRY',
  INTERVAL_WITHOUT_NEW_ENTRY: 'INTERVAL_WITHOUT_NEW_ENTRY',
  DUPLICATE_ENTRY_WITHOUT_GAP: 'DUPLICATE_ENTRY_WITHOUT_GAP',
  INCOMPLETE_JOURNEY: 'INCOMPLETE_JOURNEY',
} as const;

export type PunchSequenceInconsistencyCode =
  (typeof PUNCH_SEQUENCE_INCONSISTENCY_CODES)[keyof typeof PUNCH_SEQUENCE_INCONSISTENCY_CODES];

export type PunchSequenceWarning = {
  code: PunchSequenceInconsistencyCode;
  message: string;
  severity: 'warning' | 'high';
};

const SEQUENCE_TOLERANCE_MS = 5 * 60 * 1000;

const CODE_MESSAGES: Record<PunchSequenceInconsistencyCode, string> = {
  MISSING_ENTRY: 'Entrada não registrada',
  INTERVAL_WITHOUT_ENTRY: 'Intervalo sem entrada',
  RETURN_WITHOUT_INTERVAL_START: 'Retorno sem intervalo inicial',
  EXIT_WITHOUT_ENTRY: 'Saída sem entrada',
  EXIT_WITHOUT_INTERVAL_RETURN: 'Saída sem retorno de intervalo',
  DUPLICATE_INTERVAL_START: 'Intervalo já iniciado',
  EXIT_WITHOUT_NEW_ENTRY: 'Saída sem nova entrada',
  INTERVAL_WITHOUT_NEW_ENTRY: 'Intervalo sem nova entrada',
  DUPLICATE_ENTRY_WITHOUT_GAP: 'Nova entrada sem intervalo ou saída anterior',
  INCOMPLETE_JOURNEY: 'Jornada incompleta',
};

export function punchSequenceIssueLabel(code: PunchSequenceInconsistencyCode | string): string {
  const key = String(code).trim().toUpperCase() as PunchSequenceInconsistencyCode;
  return CODE_MESSAGES[key] ?? String(code);
}

function sortedByTime(records: RawTimeRecord[]): RawTimeRecord[] {
  return [...records].sort(
    (a, b) =>
      new Date(a.timestamp || a.created_at).getTime() - new Date(b.timestamp || b.created_at).getTime(),
  );
}

function recordEventInstantMs(rec: RawTimeRecord): number {
  return new Date(rec.timestamp || rec.created_at).getTime();
}

function effectiveNormalizedLast(sorted: RawTimeRecord[]): string {
  const last = sorted[sorted.length - 1];
  if (!last) return '';
  return normalizePunchType(last.type);
}

function warning(
  code: PunchSequenceInconsistencyCode,
  severity: 'warning' | 'high' = 'warning',
): PunchSequenceWarning {
  return { code, message: CODE_MESSAGES[code], severity };
}

/** Auditoria da próxima batida a registrar (não bloqueia). */
export function auditNextPunchRegistration(
  dayRecords: RawTimeRecord[],
  nextTypeRaw: string,
  opts?: { nextEventTime?: Date | string },
): { warnings: PunchSequenceWarning[]; sequenceTolerantExit?: boolean } {
  const warnings: PunchSequenceWarning[] = [];
  const next = normalizePunchType(nextTypeRaw);
  const sorted = sortedByTime(dayRecords);
  const lastRec = sorted[sorted.length - 1];
  const last = lastRec ? effectiveNormalizedLast(sorted) : null;
  const nextEventMs = opts?.nextEventTime != null ? new Date(opts.nextEventTime).getTime() : Date.now();

  if (!last) {
    if (next === 'pausa') warnings.push(warning('INTERVAL_WITHOUT_ENTRY', 'high'));
    else if (next === 'saida') warnings.push(warning('EXIT_WITHOUT_ENTRY', 'high'));
    else if (next === 'entrada' && sorted.length === 0) {
      // retorno sem intervalo quando primeira batida do dia é entrada após pausa implícita — ok
    }
    return { warnings };
  }

  if (last === 'entrada') {
    if (next === 'pausa' || next === 'saida') return { warnings };
    if (next === 'entrada') {
      const lastMs = recordEventInstantMs(lastRec!);
      if (nextEventMs - lastMs > SEQUENCE_TOLERANCE_MS) {
        return { warnings, sequenceTolerantExit: true };
      }
      warnings.push(warning('DUPLICATE_ENTRY_WITHOUT_GAP', 'high'));
      return { warnings };
    }
  }

  if (last === 'pausa') {
    if (next === 'entrada') return { warnings };
    if (next === 'pausa') warnings.push(warning('DUPLICATE_INTERVAL_START', 'high'));
    else if (next === 'saida') warnings.push(warning('EXIT_WITHOUT_INTERVAL_RETURN', 'high'));
    return { warnings };
  }

  if (last === 'saida') {
    if (next === 'entrada') return { warnings };
    if (next === 'saida') warnings.push(warning('EXIT_WITHOUT_NEW_ENTRY', 'high'));
    else if (next === 'pausa') warnings.push(warning('INTERVAL_WITHOUT_NEW_ENTRY', 'high'));
    return { warnings };
  }

  return { warnings };
}

/** Auditoria da jornada do dia (espelho / RH). */
export function auditDayPunchSequence(dayRecords: RawTimeRecord[]): PunchSequenceWarning[] {
  const warnings: PunchSequenceWarning[] = [];
  const sorted = sortedByTime(dayRecords).filter((r) => {
    const t = String(r.type ?? '').toLowerCase();
    return !t.includes('status') && t !== 'folga' && t !== 'falta';
  });
  if (sorted.length === 0) return warnings;

  const first = normalizePunchType(sorted[0]?.type);
  const hasEntrada = sorted.some((r) => normalizePunchType(r.type) === 'entrada');
  if (!hasEntrada) {
    warnings.push(warning('MISSING_ENTRY', 'high'));
  } else if (first !== 'entrada') {
    warnings.push(warning('MISSING_ENTRY', 'high'));
  }

  let last: string | null = null;
  for (const rec of sorted) {
    const t = normalizePunchType(rec.type);
    if (!last) {
      if (t === 'pausa') warnings.push(warning('INTERVAL_WITHOUT_ENTRY', 'high'));
      if (t === 'saida') warnings.push(warning('EXIT_WITHOUT_ENTRY', 'high'));
      last = t;
      continue;
    }
    if (last === 'entrada' && t === 'entrada') {
      warnings.push(warning('DUPLICATE_ENTRY_WITHOUT_GAP', 'warning'));
    }
    if (last === 'pausa' && t === 'pausa') {
      warnings.push(warning('DUPLICATE_INTERVAL_START', 'high'));
    }
    if (last === 'pausa' && t === 'saida') {
      warnings.push(warning('EXIT_WITHOUT_INTERVAL_RETURN', 'high'));
    }
    if (last === 'saida' && (t === 'saida' || t === 'pausa')) {
      warnings.push(
        warning(t === 'saida' ? 'EXIT_WITHOUT_NEW_ENTRY' : 'INTERVAL_WITHOUT_NEW_ENTRY', 'high'),
      );
    }
  }

  const lastType = normalizePunchType(sorted[sorted.length - 1]?.type);
  if (lastType === 'entrada' || lastType === 'pausa') {
    warnings.push(warning('INCOMPLETE_JOURNEY', 'warning'));
  }

  const seen = new Set<string>();
  return warnings.filter((w) => {
    if (seen.has(w.code)) return false;
    seen.add(w.code);
    return true;
  });
}

export function dayHasMissingEntry(dayRecords: RawTimeRecord[]): boolean {
  return auditDayPunchSequence(dayRecords).some(
    (w) => w.code === 'MISSING_ENTRY' || w.code === 'INTERVAL_WITHOUT_ENTRY' || w.code === 'EXIT_WITHOUT_ENTRY',
  );
}

export function formatPunchSequenceWarnings(warnings: PunchSequenceWarning[]): string[] {
  return warnings.map((w) => w.message);
}
