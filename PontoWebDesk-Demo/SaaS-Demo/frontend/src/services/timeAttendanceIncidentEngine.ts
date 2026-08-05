/**
 * Classificação e priorização operacional de incidentes (fila de auditoria, SLA, alertas).
 * Não altera `status_label` nem dados persistidos — apenas deriva visão a partir da linha + trilha.
 */

import type { TimeAttendanceRow } from './timeAttendanceData';
import type { CalculationTrace } from './timesheetCalculationAudit';
import type { TimesheetProcessingStatus } from './timesheetProcessingStatus';

export type OperationalIncidentSeverity = 'low' | 'medium' | 'high' | 'critical';

export type OperationalIncidentCategory =
  | 'punch'
  | 'schedule'
  | 'replay'
  | 'integration'
  | 'manual'
  | 'engine';

export type OperationalIncident = {
  incident_code: string;
  severity: OperationalIncidentSeverity;
  category: OperationalIncidentCategory;
  human_reason: string;
  recommended_action?: string;
};

function todayLocalYmd(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function isPastDayYmd(date: string): boolean {
  return String(date).slice(0, 10) < todayLocalYmd();
}

function lastStepReason(
  trace: CalculationTrace | null | undefined,
  stepName: string,
): string | undefined {
  const tree = trace?.decision_tree;
  if (!tree?.length) return undefined;
  for (let i = tree.length - 1; i >= 0; i--) {
    const s = tree[i];
    if (s?.step === stepName && typeof s.reason === 'string' && s.reason.trim()) {
      return s.reason.trim();
    }
  }
  return undefined;
}

function severityRank(s: OperationalIncidentSeverity): number {
  switch (s) {
    case 'low':
      return 1;
    case 'medium':
      return 2;
    case 'high':
      return 3;
    case 'critical':
      return 4;
    default:
      return 0;
  }
}

function pickHigher(a: OperationalIncident, b: OperationalIncident): OperationalIncident {
  return severityRank(a.severity) >= severityRank(b.severity) ? a : b;
}

/** Casos explícitos do produto + trilha de decisão + origem do cálculo. */
export function deriveOperationalIncident(
  row: TimeAttendanceRow,
  calculationTrace: CalculationTrace | null | undefined,
): OperationalIncident {
  const label = String(row.status_label ?? '').trim();

  const duplicate: OperationalIncident = {
    incident_code: 'duplicate_day_records',
    severity: 'critical',
    category: 'engine',
    human_reason: 'Existem múltiplos registros para o mesmo colaborador e dia.',
    recommended_action: 'Bloquear fechamento até revisão.',
  };

  if (label === 'duplicate_user_day') {
    return duplicate;
  }

  const inconsistent: OperationalIncident = {
    incident_code: 'motor_punch_mismatch',
    severity: 'high',
    category: 'engine',
    human_reason: 'O motor apresentou totais, mas entrada/saída nas batidas não fecha com o esperado.',
    recommended_action: 'Conferir batidas e recalcular; validar integração ou ajuste manual.',
  };

  if (label === 'inconsistent_data') {
    return inconsistent;
  }

  const processingError: OperationalIncident = {
    incident_code: 'processing_failure',
    severity: 'high',
    category: 'engine',
    human_reason: 'Falha ou estado inválido no processamento da folha deste dia.',
    recommended_action: 'Reprocessar o dia; se persistir, escalar suporte técnico.',
  };

  if (label === 'erro no processamento' || label === 'Erro') {
    return processingError;
  }

  const invalidRef: OperationalIncident = {
    incident_code: 'invalid_employee_reference',
    severity: 'high',
    category: 'integration',
    human_reason: 'Colaborador referenciado é inválido ou não pôde ser resolvido no motor.',
    recommended_action: 'Corrigir vínculo do colaborador na origem e reimportar/recalcular.',
  };

  if (label === 'Referência inválida') {
    return invalidRef;
  }

  const pairReason = lastStepReason(calculationTrace, 'pair_punches');
  const finalizeReason = lastStepReason(calculationTrace, 'finalize_day_totals');
  const scheduleReason = lastStepReason(calculationTrace, 'identify_schedule');

  const missingClockOut: OperationalIncident = {
    incident_code: 'missing_clock_out',
    severity: 'medium',
    category: 'punch',
    human_reason: 'Colaborador não possui batida de saída.',
    recommended_action: 'Validar saída manualmente antes do fechamento.',
  };

  const candidates: OperationalIncident[] = [];

  if (pairReason === 'missing_clock_out') {
    candidates.push(missingClockOut);
  } else if (row.clock_in && !row.clock_out && isPastDayYmd(row.date)) {
    candidates.push(missingClockOut);
  }

  if (pairReason === 'incomplete_punch_sequence') {
    candidates.push({
      incident_code: 'incomplete_punch_sequence',
      severity: 'medium',
      category: 'punch',
      human_reason: 'Sequência de batidas incompleta (entrada/saída não forma par válido).',
      recommended_action: 'Incluir batidas faltantes ou ajustar manualmente com justificativa.',
    });
  }

  if (pairReason === 'no_punches' || label === 'Sem batidas') {
    candidates.push({
      incident_code: 'no_punches',
      severity: 'medium',
      category: 'punch',
      human_reason: 'Não há batidas registradas para o dia.',
      recommended_action: 'Confirmar ausência ou registrar batidas / justificativa.',
    });
  }

  if (label === 'Batidas incompletas') {
    candidates.push({
      incident_code: 'incomplete_punches_ui',
      severity: 'medium',
      category: 'punch',
      human_reason: 'Batidas presentes, mas sem par entrada/saída completo para o cálculo.',
      recommended_action: 'Completar batidas ou usar ajuste manual antes do fechamento.',
    });
  }

  if (scheduleReason === 'no_schedule_for_day') {
    candidates.push({
      incident_code: 'no_schedule_for_day',
      severity: 'medium',
      category: 'schedule',
      human_reason: 'Não há escala cadastrada para este dia; o motor usou contingência.',
      recommended_action: 'Associar escala ao colaborador ou validar exceção de jornada.',
    });
  }

  if (finalizeReason === 'incomplete_day') {
    candidates.push({
      incident_code: 'incomplete_day_totals',
      severity: 'medium',
      category: 'engine',
      human_reason: 'O dia foi marcado como incompleto na finalização dos totais.',
      recommended_action: 'Revisar batidas, intervalos e política de fechamento para este dia.',
    });
  }

  if (label === 'Jornada padrão' || label === 'fallback_schedule') {
    candidates.push({
      incident_code: 'fallback_schedule_applied',
      severity: 'low',
      category: 'schedule',
      human_reason: 'Horas derivadas de jornada padrão / contingência em vez de batidas completas.',
      recommended_action: 'Confirmar se a contingência reflete a realidade do dia.',
    });
  }

  if (label === 'closed_period') {
    candidates.push({
      incident_code: 'period_closed',
      severity: 'low',
      category: 'schedule',
      human_reason: 'Dia pertence a um período já fechado pelo RH.',
      recommended_action: 'Alterações exigem reabertura controlada do período.',
    });
  }

  if (label === 'protected_timesheet' || label === 'Protegido') {
    candidates.push({
      incident_code: 'protected_timesheet',
      severity: 'low',
      category: 'manual',
      human_reason: 'Registro protegido contra alterações automáticas.',
      recommended_action: 'Usar fluxo manual/autorizado para qualquer correção.',
    });
  }

  if (label === 'na fila de processamento') {
    candidates.push({
      incident_code: 'processing_queued',
      severity: 'low',
      category: 'engine',
      human_reason: 'Cálculo enfileirado; aguardando processamento.',
      recommended_action: 'Aguardar conclusão ou verificar fila do motor.',
    });
  }

  if (label === 'recalculando') {
    candidates.push({
      incident_code: 'recalc_in_progress',
      severity: 'low',
      category: 'engine',
      human_reason: 'Recálculo em andamento para este dia.',
      recommended_action: 'Atualizar a lista após alguns segundos.',
    });
  }

  if (label === 'Aguardando cálculo' || label === 'pending_engine') {
    candidates.push({
      incident_code: 'awaiting_engine',
      severity: 'low',
      category: 'engine',
      human_reason: 'Batidas prontas, mas ainda sem linha oficial do motor.',
      recommended_action: 'Disparar ou aguardar o cálculo da folha.',
    });
  }

  const src = calculationTrace?.source;
  if (src === 'replay') {
    candidates.push({
      incident_code: 'replay_sourced_day',
      severity: 'low',
      category: 'replay',
      human_reason: calculationTrace?.replay_reason?.trim()
        ? `Dia calculado via replay: ${calculationTrace.replay_reason.trim()}`
        : 'Dia calculado ou ajustado via replay.',
      recommended_action: 'Manter trilha de auditoria; validar se o replay foi autorizado.',
    });
  } else if (src === 'manual') {
    candidates.push({
      incident_code: 'manual_trace_source',
      severity: 'low',
      category: 'manual',
      human_reason: 'Cálculo associado a origem manual.',
      recommended_action: 'Garantir que ajustes manuais estejam documentados na auditoria.',
    });
  } else if (src === 'integration') {
    candidates.push({
      incident_code: 'integration_sourced',
      severity: 'low',
      category: 'integration',
      human_reason: 'Dados ou totais influenciados por integração externa.',
      recommended_action: 'Em caso de divergência, confrontar com a origem integrada.',
    });
  }

  if (candidates.length > 0) {
    return candidates.reduce(pickHigher);
  }

  if (label === 'OK' || label === 'ok') {
    return {
      incident_code: 'no_operational_incident',
      severity: 'low',
      category: 'engine',
      human_reason: 'Nenhum incidente operacional identificado para este dia.',
    };
  }

  return {
    incident_code: 'unclassified_operational_state',
    severity: 'low',
    category: 'engine',
    human_reason: `Estado não mapeado explicitamente pelo motor de incidentes (status: "${label || '—'}").`,
    recommended_action: 'Revisar regras de classificação ou dados brutos do dia.',
  };
}

/** Alinha rótulo de status ao usado em `deriveOperationalIncident` após persistência do motor. */
export function statusLabelFromProcessingStatusForIncident(
  ps: TimesheetProcessingStatus | 'pending_engine',
): string {
  switch (ps) {
    case 'ok':
      return 'OK';
    case 'fallback_schedule':
      return 'Jornada padrão';
    case 'protected':
      return 'Protegido';
    case 'error':
      return 'Erro';
    case 'skipped_invalid_employee':
      return 'Referência inválida';
    default:
      return 'ok';
  }
}

/** Linha sintética pós-`writeTimesheetsDailyCalculatedRow` para classificar incidente sem segunda leitura ao banco. */
export function buildSyntheticTimeAttendanceRowForMotorWrite(input: {
  employee_id: string;
  date: string;
  worked_minutes: number;
  processing_status: TimesheetProcessingStatus;
  punch_count: number;
  clock_in: string | null;
  clock_out: string | null;
  raw_data: Record<string, unknown>;
}): TimeAttendanceRow {
  const mins = Number(input.worked_minutes);
  const th = Number.isFinite(mins) ? mins / 60 : 0;
  const ymd = String(input.date).slice(0, 10);
  return {
    id: `${input.employee_id}|${ymd}`,
    employee_id: input.employee_id,
    date: ymd,
    clock_in: input.clock_in,
    clock_out: input.clock_out,
    break_minutes: 0,
    total_hours_motor: Number.isFinite(th) ? th : null,
    processing_status: input.processing_status,
    status_label: statusLabelFromProcessingStatusForIncident(input.processing_status),
    has_timesheet_daily: true,
    punch_count: input.punch_count,
    auto_recalc_requested_at: null,
    next_retry_at: null,
    auto_recalc_in_flight: false,
    raw_data: input.raw_data,
  };
}

/** Evita spam na timeline: só incidentes com severidade média+ ou estados críticos explícitos. */
export function shouldPersistIncidentTimelineEvent(inc: OperationalIncident): boolean {
  if (inc.incident_code === 'no_operational_incident') return false;
  if (inc.incident_code === 'unclassified_operational_state') return false;
  if (inc.severity === 'low') return false;
  return true;
}
