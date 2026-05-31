import { observabilityConsole } from '../shared/logger/observabilityConsole';
/**
 * Scores heurísticos 0–100 e tendência operacional (sem ML).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { TimeAttendanceTimelineRow } from './timeAttendanceTimeline.service';
import { TimeAttendanceTimelineEventType } from './timeAttendanceTimeline.constants';
import { getSupabaseClient } from './supabaseClient';

export type ReliabilityDaySignals = {
  status_label: string;
  processing_status?: string;
  has_timesheet_daily: boolean;
};

/** Penalidades determinísticas por dia agregado (colaborador no período). */
export function computeEmployeeReliabilityScore(days: ReliabilityDaySignals[]): number {
  let s = 100;
  for (const d of days) {
    const label = String(d.status_label ?? '').trim();
    if (label === 'duplicate_user_day') s -= 40;
    else if (label === 'erro no processamento' || label === 'Erro') s -= 35;
    else if (label === 'inconsistent_data') s -= 25;
    else if (
      d.processing_status === 'fallback_schedule' ||
      label === 'Jornada padrão' ||
      label === 'fallback_schedule'
    ) {
      s -= 5;
    }
  }
  return Math.max(0, Math.min(100, Math.round(s)));
}

export type RepReliabilitySignals = {
  match_failed: number;
  match_ambiguous: number;
  promote_count: number;
};

/** Heurística leve para painel REP (contagens já agregadas). */
export function computeRepReliabilityScore(s: RepReliabilitySignals): number {
  let score = 100;
  score -= Math.min(40, s.match_failed * 4);
  score -= Math.min(30, s.match_ambiguous * 2);
  score -= Math.min(20, Math.max(0, s.promote_count - 50) * 0.5);
  return Math.max(0, Math.min(100, Math.round(score)));
}

export type ScheduleReliabilitySignals = {
  fallback_day_ratio: number;
  inconsistent_day_ratio: number;
};

export function computeScheduleReliabilityScore(s: ScheduleReliabilitySignals): number {
  let score = 100;
  score -= Math.min(50, Math.round(s.fallback_day_ratio * 100));
  score -= Math.min(50, Math.round(s.inconsistent_day_ratio * 80));
  return Math.max(0, Math.min(100, Math.round(score)));
}

export type OperationalTrendResult = {
  degraded_operation: boolean;
  rep_degrading: boolean;
  schedule_problem: boolean;
  replay_rising: boolean;
  fallback_excess: boolean;
  messages: string[];
};

/**
 * Compara janelas de eventos de timeline (contagens simples).
 */
export function computeOperationalTrend(params: {
  recent: TimeAttendanceTimelineRow[];
  previous: TimeAttendanceTimelineRow[];
}): OperationalTrendResult {
  const countMap = (rows: TimeAttendanceTimelineRow[]) => {
    const m = new Map<string, number>();
    for (const r of rows) {
      const k = r.event_type;
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return m;
  };
  const a = countMap(params.recent);
  const b = countMap(params.previous);
  const ratio = (key: string): number => {
    const x = a.get(key) ?? 0;
    const y = b.get(key) ?? 0;
    if (y === 0) return x > 0 ? 2 : 0;
    return x / y;
  };

  const incIncidents = ratio(TimeAttendanceTimelineEventType.INCIDENT_DETECTED) > 1.25;
  const repFail = ratio(TimeAttendanceTimelineEventType.REP_MATCH_FAILED) > 1.3;
  const repAmb = ratio(TimeAttendanceTimelineEventType.REP_MATCH_AMBIGUOUS) > 1.3;
  const repPromoteFail = ratio(TimeAttendanceTimelineEventType.REP_PROMOTE_FAILED) > 1.25;
  const replayR = ratio(TimeAttendanceTimelineEventType.TIMESHEET_REPLAY) > 1.4;
  const fb = ratio(TimeAttendanceTimelineEventType.TIMESHEET_FALLBACK_APPLIED) > 1.35;

  const messages: string[] = [];
  if (incIncidents) messages.push('Operação degradando: mais incidentes detectados vs período anterior.');
  if (repFail || repAmb) messages.push('REP degradando: falhas ou ambiguidades de match em alta.');
  if (repPromoteFail) messages.push('Promoção REP → espelho em alta: revisar sequência, folha fechada ou incidentes.');
  if (fb) messages.push('Escala problemática: uso de fallback do motor em alta.');
  if (replayR) messages.push('Replay em alta: revisar mudanças de motor/regras ou dados.');

  const out: OperationalTrendResult = {
    degraded_operation: incIncidents,
    rep_degrading: repFail || repAmb || repPromoteFail,
    schedule_problem: fb,
    replay_rising: replayR,
    fallback_excess: fb,
    messages,
  };
  if (messages.length > 0 && typeof globalThis !== 'undefined' && globalThis.console) {
    observabilityConsole.info('[TIME ATTENDANCE TREND]', {
      degraded_operation: out.degraded_operation,
      rep_degrading: out.rep_degrading,
      schedule_problem: out.schedule_problem,
      replay_rising: out.replay_rising,
    });
  }
  return out;
}

export async function upsertReliabilitySnapshot(input: {
  companyId: string;
  snapshotDate: string;
  subjectType: string;
  subjectId?: string;
  score: number;
  payload?: Record<string, unknown>;
  supabaseClient?: SupabaseClient | null;
}): Promise<void> {
  const client = input.supabaseClient ?? getSupabaseClient();
  if (!client) return;
  const sid = (input.subjectId ?? '').trim();
  try {
    const { error } = await client.from('time_attendance_reliability_snapshots').upsert(
      {
        company_id: input.companyId.trim(),
        snapshot_date: String(input.snapshotDate).slice(0, 10),
        subject_type: input.subjectType.trim(),
        subject_id: sid,
        score: input.score,
        payload: input.payload ?? {},
      },
      { onConflict: 'company_id,snapshot_date,subject_type,subject_id' },
    );
    if (error) {
      observabilityConsole.error('[TIME ATTENDANCE RELIABILITY]', { message: error.message });
      return;
    }
    observabilityConsole.info('[TIME ATTENDANCE RELIABILITY]', {
      company_id: input.companyId,
      date: input.snapshotDate,
      subject_type: input.subjectType,
      score: input.score,
    });
  } catch (e) {
    observabilityConsole.error('[TIME ATTENDANCE RELIABILITY]', {
      message: e instanceof Error ? e.message : String(e),
    });
  }
}
