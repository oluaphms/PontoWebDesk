import type { SupabaseClient } from '@supabase/supabase-js';
import {
  computeOperationalTrend,
  computeRepReliabilityScore,
  type RepReliabilitySignals,
} from '../../../services/timeAttendanceReliability.service';
import { listTimeAttendanceTimelinePage } from '../../../services/timeAttendanceTimeline.service';
import { TimeAttendanceTimelineEventType } from '../../../services/timeAttendanceTimeline.constants';
import { operationalLog } from '../observability';

export type RepOperationalHealth = {
  score: number;
  openOperationalRows: number;
  waitingReview: number;
  violations: number;
  zombies: number;
};

/** Fonte única do score 0–100 a partir de contagens de governança. */
export function computeRepOperationalHealth(input: {
  violationCount: number;
  zombieCount: number;
  waitingReviewCount: number;
  openOperationalCount: number;
}): RepOperationalHealth {
  let score = 100;
  score -= Math.min(40, input.violationCount * 8);
  score -= Math.min(35, input.zombieCount * 5);
  score -= Math.min(15, input.waitingReviewCount * 2);
  score -= Math.min(10, Math.max(0, input.openOperationalCount - input.waitingReviewCount));
  if (score < 0) score = 0;
  return {
    score,
    openOperationalRows: input.openOperationalCount,
    waitingReview: input.waitingReviewCount,
    violations: input.violationCount,
    zombies: input.zombieCount,
  };
}

/** Penalização conservadora quando há DLQ aberta ou órfãos detectados na amostra. */
export function applyRecoveryStressToOperationalHealth(
  health: RepOperationalHealth,
  input: { openDlqCount: number; orphanSampleHits: number },
): RepOperationalHealth {
  let score = health.score;
  score -= Math.min(20, input.openDlqCount * 4);
  score -= Math.min(15, input.orphanSampleHits * 3);
  if (score < 0) score = 0;
  return { ...health, score };
}

export type DegradationHeatmapDevice = {
  device_name: string;
  pending: number;
  retry_intensity: number;
  zombie_hits: number;
};

export type DegradationHeatmapEmployee = {
  employee_name: string;
  pending: number;
  retries_sum: number;
  zombie_hits: number;
};

/** Tendência / degradação operacional — heurísticas centralizadas (antes em cockpit service). */
export async function evaluateOperationalDegradation(
  client: SupabaseClient,
  companyId: string,
  heatmap: DegradationHeatmapDevice[],
  employees?: DegradationHeatmapEmployee[],
  correlationId?: string,
): Promise<string[]> {
  const messages: string[] = [];
  const { rows: recent } = await listTimeAttendanceTimelinePage({ companyId, limit: 200, supabaseClient: client });
  const mid = Math.floor(recent.length / 2);
  const trend = computeOperationalTrend({
    recent: recent.slice(0, mid),
    previous: recent.slice(mid),
  });
  messages.push(...trend.messages);

  for (const h of heatmap.slice(0, 8)) {
    if (h.pending >= 12 && h.retry_intensity >= 0.45) {
      messages.push(
        `Relógio «${h.device_name}» com fila (${h.pending}) e intensidade de retries elevada — rever consolidate/promote.`,
      );
    }
    if (h.zombie_hits >= 3) {
      messages.push(`Relógio «${h.device_name}»: ${h.zombie_hits} itens zombie na amostra — priorizar RH.`);
    }
  }

  const { rows: fb } = await listTimeAttendanceTimelinePage({
    companyId,
    limit: 80,
    eventType: TimeAttendanceTimelineEventType.TIMESHEET_FALLBACK_APPLIED,
    supabaseClient: client,
  });
  if (fb.length >= 8) {
    messages.push('Volume recente de TIMESHEET_FALLBACK_APPLIED — possível escala/jornada gerando fallback excessivo.');
  }

  const sig: RepReliabilitySignals = {
    match_failed: recent.filter((r) => r.event_type === TimeAttendanceTimelineEventType.REP_MATCH_FAILED).length,
    match_ambiguous: recent.filter((r) => r.event_type === TimeAttendanceTimelineEventType.REP_MATCH_AMBIGUOUS).length,
    promote_count: recent.filter((r) => r.event_type === TimeAttendanceTimelineEventType.REP_PROMOTED).length,
  };
  const repScore = computeRepReliabilityScore(sig);
  if (repScore < 55) {
    messages.push(`Sinal REP agregado fraco (score ${repScore}) na janela recente de eventos — conferir identidade/dispositivos.`);
  }

  for (const e of employees ?? []) {
    if (e.zombie_hits >= 3) {
      messages.push(
        `Colaborador «${e.employee_name}»: ${e.zombie_hits} itens zombie na amostra — padrão anormal; rever sequência e espelho.`,
      );
    }
    if (e.pending >= 8 && e.retries_sum >= e.pending * 3) {
      messages.push(`Colaborador «${e.employee_name}»: retries elevados vs pendências — possível degradação de promote.`);
    }
  }

  operationalLog('HEALTH', {
    correlation_id: correlationId ?? null,
    degradation_messages: messages.length,
    companyId,
  });

  return [...new Set(messages)].slice(0, 14);
}
