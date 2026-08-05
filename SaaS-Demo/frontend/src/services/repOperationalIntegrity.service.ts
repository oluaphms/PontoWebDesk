/**
 * Governança operacional REP: invariantes, zombies, saúde, expiração e cap de retries.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { createOperationalCorrelationId } from '../domain/operational/correlationId';
import { GovernanceViolationCode } from '../domain/operational/governance/governanceViolationCode';
import {
  MAX_REPROMOTE_ATTEMPTS,
  REP_EXPIRE_AFTER_DAYS,
  ZOMBIE_PENDING_DAYS,
} from '../domain/operational/governance/repGovernanceConstants';
import {
  computeRepOperationalHealth,
  type RepOperationalHealth,
} from '../domain/operational/health/operationalHealthEngine';
import { operationalLog } from '../domain/operational/observability';
import { emitOperationalEvent } from '../domain/operational/timeline/operationalEventBus';
import { appendTimeAttendanceTimelineEvent } from './timeAttendanceTimeline.service';
import {
  TimeAttendanceTimelineEventType,
  TimeAttendanceTimelineSeverity,
} from './timeAttendanceTimeline.constants';
import { insertIncidentResolution } from './timeAttendanceIncidentReviews.service';
import { listTimeAttendanceTimelinePage } from './timeAttendanceTimeline.service';

export { MAX_REPROMOTE_ATTEMPTS, REP_EXPIRE_AFTER_DAYS, ZOMBIE_PENDING_DAYS } from '../domain/operational/governance/repGovernanceConstants';
export type { RepOperationalHealth } from '../domain/operational/health/operationalHealthEngine';
export { computeRepOperationalHealth } from '../domain/operational/health/operationalHealthEngine';

export type RepGovernanceViolation = {
  code: GovernanceViolationCode | string;
  message: string;
  rep_punch_log_id?: string;
  employee_id?: string | null;
};

export type RepZombieSignal = {
  kind: string;
  rep_punch_log_id: string;
  employee_id: string | null;
  detail: Record<string, unknown>;
};

type RepLogGovernanceRow = {
  id: string;
  company_id: string;
  resolved_user_id: string | null;
  data_hora: string;
  time_record_id: string | null;
  ignored: boolean | null;
  ignored_by: string | null;
  operational_resolution_status: string | null;
  operational_resolution_note: string | null;
  operational_resolution_at: string | null;
  promotion_attempts: number | null;
  last_promotion_attempt_at: string | null;
};

async function fetchRepLogsForGovernance(
  client: SupabaseClient,
  companyId: string,
  repPunchLogIds?: string[],
): Promise<RepLogGovernanceRow[]> {
  let q = client
    .from('rep_punch_logs')
    .select(
      'id,company_id,resolved_user_id,data_hora,time_record_id,ignored,ignored_by,operational_resolution_status,operational_resolution_note,operational_resolution_at,promotion_attempts,last_promotion_attempt_at',
    )
    .eq('company_id', companyId);

  if (repPunchLogIds?.length) {
    q = q.in('id', repPunchLogIds);
  } else {
    q = q
      .or(
        'operational_resolution_status.not.is.null,time_record_id.not.is.null,ignored.eq.true,promotion_attempts.gte.1',
      )
      .limit(2000);
  }

  const { data, error } = await q;
  if (error) {
    operationalLog('GOVERNANCE', { context: 'fetch_rep_logs', message: error.message, correlation_id: null });
    return [];
  }
  return (data ?? []) as RepLogGovernanceRow[];
}

function daysBetween(isoStart: string, isoEnd: Date): number {
  const a = new Date(isoStart).getTime();
  const b = isoEnd.getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.floor((b - a) / 86_400_000);
}

/** Invariantes A–E sobre linhas `rep_punch_logs`. */
export async function validateRepOperationalIntegrity(
  client: SupabaseClient,
  companyId: string,
  opts?: { repPunchLogIds?: string[] },
): Promise<RepGovernanceViolation[]> {
  const violations: RepGovernanceViolation[] = [];
  const rows = await fetchRepLogsForGovernance(client, companyId, opts?.repPunchLogIds);

  for (const r of rows) {
    const st = String(r.operational_resolution_status ?? '').trim() || 'pending';
    const hasTr = Boolean(r.time_record_id);

    if (hasTr && (st === 'pending' || st === 'investigating' || st === 'waiting_review')) {
      violations.push({
        code: GovernanceViolationCode.A_TIME_RECORD_WITH_NON_TERMINAL_STATUS,
        message: 'time_record_id preenchido mas estado operacional ainda não terminal.',
        rep_punch_log_id: r.id,
        employee_id: r.resolved_user_id,
      });
    }

    if (st === 'reconciled' && !hasTr && !r.ignored) {
      violations.push({
        code: GovernanceViolationCode.B_RECONCILED_WITHOUT_TIME_RECORD,
        message: 'Marcado reconciled sem time_record_id.',
        rep_punch_log_id: r.id,
        employee_id: r.resolved_user_id,
      });
    }

    if (
      (r.ignored === true || st === 'ignored') &&
      !String(r.operational_resolution_note ?? '').trim()
    ) {
      violations.push({
        code: GovernanceViolationCode.C_IGNORED_WITHOUT_NOTE,
        message: 'Batida ignorada sem nota operacional.',
        rep_punch_log_id: r.id,
        employee_id: r.resolved_user_id,
      });
    }

    if (
      (st === 'pending' || st === 'investigating') &&
      (r.promotion_attempts ?? 0) >= MAX_REPROMOTE_ATTEMPTS
    ) {
      violations.push({
        code: GovernanceViolationCode.E_ATTEMPTS_OVER_CAP_WITHOUT_WAITING_REVIEW,
        message: `Tentativas de promote (${r.promotion_attempts}) ≥ limite sem waiting_review.`,
        rep_punch_log_id: r.id,
        employee_id: r.resolved_user_id,
      });
    }
  }

  const recoveredViolations = await validateRepPromoteRecoveredVsMirror(client, companyId);
  violations.push(...recoveredViolations);

  if (violations.length) {
    operationalLog('GOVERNANCE', {
      companyId,
      count: violations.length,
      codes: [...new Set(violations.map((v) => v.code))],
      correlation_id: null,
    });
  } else {
    operationalLog('GOVERNANCE', { companyId, ok: true, scope: opts?.repPunchLogIds?.length ?? 'wide', correlation_id: null });
  }

  return violations;
}

/** Eventos RECOVERED recentes cuja linha REP ainda não tem time_record. */
async function validateRepPromoteRecoveredVsMirror(
  client: SupabaseClient,
  companyId: string,
): Promise<RepGovernanceViolation[]> {
  const violations: RepGovernanceViolation[] = [];
  const { rows } = await listTimeAttendanceTimelinePage({
    companyId,
    limit: 200,
    eventType: TimeAttendanceTimelineEventType.REP_PROMOTE_RECOVERED,
  });

  const seenIds = new Set<string>();
  for (const ev of rows) {
    const p = (ev.payload ?? {}) as Record<string, unknown>;
    const rid = p.rep_punch_log_id != null ? String(p.rep_punch_log_id) : '';
    if (!rid || seenIds.has(rid)) continue;
    seenIds.add(rid);

    const { data: log } = await client
      .from('rep_punch_logs')
      .select('id,time_record_id,resolved_user_id')
      .eq('company_id', companyId)
      .eq('id', rid)
      .maybeSingle();

    const row = log as { id: string; time_record_id: string | null; resolved_user_id: string | null } | null;
    if (row && !row.time_record_id) {
      violations.push({
        code: GovernanceViolationCode.D_RECOVERED_EVENT_WITHOUT_TIME_RECORD,
        message: 'Timeline REP_PROMOTE_RECOVERED mas rep_punch_log sem time_record_id.',
        rep_punch_log_id: rid,
        employee_id: row.resolved_user_id ?? ev.employee_id,
      });
    }
  }

  return violations;
}

/** Estados pendurados: pendência antiga, investigação sem fecho, cap de retries. */
export async function detectZombieRepOperationalStates(
  client: SupabaseClient,
  companyId: string,
): Promise<RepZombieSignal[]> {
  const signals: RepZombieSignal[] = [];
  const rows = await fetchRepLogsForGovernance(client, companyId);
  const now = new Date();

  for (const r of rows) {
    const st = String(r.operational_resolution_status ?? '').trim() || 'pending';
    if (r.time_record_id || r.ignored) continue;
    if (!['pending', 'investigating', 'waiting_review'].includes(st)) continue;

    if (st === 'pending' && daysBetween(r.data_hora, now) >= ZOMBIE_PENDING_DAYS) {
      signals.push({
        kind: 'stale_pending',
        rep_punch_log_id: r.id,
        employee_id: r.resolved_user_id,
        detail: { days: daysBetween(r.data_hora, now), data_hora: r.data_hora },
      });
    }

    if (st === 'investigating' && r.operational_resolution_at) {
      const d = daysBetween(r.operational_resolution_at, now);
      if (d >= ZOMBIE_PENDING_DAYS) {
        signals.push({
          kind: 'investigating_stale',
          rep_punch_log_id: r.id,
          employee_id: r.resolved_user_id,
          detail: { days: d, operational_resolution_at: r.operational_resolution_at },
        });
      }
    }

    if ((r.promotion_attempts ?? 0) > MAX_REPROMOTE_ATTEMPTS) {
      signals.push({
        kind: 'retry_runaway',
        rep_punch_log_id: r.id,
        employee_id: r.resolved_user_id,
        detail: { promotion_attempts: r.promotion_attempts },
      });
    }
  }

  if (signals.length) {
    operationalLog('GOVERNANCE', { companyId, count: signals.length, kind: 'zombie_signals', correlation_id: null });
  }

  return signals;
}

export async function emitRepGovernanceZombieIncidents(
  client: SupabaseClient,
  companyId: string,
  signals: RepZombieSignal[],
): Promise<void> {
  for (const z of signals) {
    const dateYmd = new Date().toISOString().slice(0, 10);
    const correlationId = createOperationalCorrelationId();
    await emitOperationalEvent({
      supabaseClient: client,
      companyId,
      employeeId: z.employee_id,
      dateYmd,
      eventType: TimeAttendanceTimelineEventType.INCIDENT_DETECTED,
      eventSeverity: TimeAttendanceTimelineSeverity.high,
      correlationId,
      actor: null,
      source: 'repOperationalIntegrity',
      sourceReferenceId: z.rep_punch_log_id,
      beforeState: null,
      afterState: { zombie_kind: z.kind },
      metadata: {
        category: 'REP_GOVERNANCE',
        zombie_kind: z.kind,
        ...z.detail,
      },
    });
  }
}

/** reconciled ↔ REP_SEQUENCE_RECONCILED; ignored ↔ REP_PUNCH_IGNORED; retry ↔ REP_PROMOTE_RETRIED (últimos eventos). */
export async function assertTimelineConsistency(
  client: SupabaseClient,
  companyId: string,
  repPunchLogIds: string[],
): Promise<RepGovernanceViolation[]> {
  const out: RepGovernanceViolation[] = [];
  if (!repPunchLogIds.length) return out;

  const logs = await fetchRepLogsForGovernance(client, companyId, repPunchLogIds);
  const { data: evRows, error } = await client
    .from('time_attendance_timeline')
    .select('event_type,source_reference_id')
    .eq('company_id', companyId)
    .in('source_reference_id', repPunchLogIds)
    .in('event_type', [
      TimeAttendanceTimelineEventType.REP_SEQUENCE_RECONCILED,
      TimeAttendanceTimelineEventType.REP_PUNCH_IGNORED,
    ]);

  if (error) {
    operationalLog('TIMELINE', { context: 'fetch', message: error.message, correlation_id: null });
    return out;
  }

  const reconciledRefs = new Set<string>();
  const ignoredRefs = new Set<string>();
  for (const e of evRows ?? []) {
    const ref = String((e as { source_reference_id: string | null }).source_reference_id ?? '');
    const et = String((e as { event_type: string }).event_type);
    if (!ref) continue;
    if (et === TimeAttendanceTimelineEventType.REP_SEQUENCE_RECONCILED) reconciledRefs.add(ref);
    if (et === TimeAttendanceTimelineEventType.REP_PUNCH_IGNORED) ignoredRefs.add(ref);
  }

  for (const r of logs) {
    const st = String(r.operational_resolution_status ?? '').trim();
    if (st === 'reconciled' && !reconciledRefs.has(r.id)) {
      out.push({
        code: GovernanceViolationCode.TL_RECONCILED_MISSING_TIMELINE,
        message: 'Estado reconciled sem evento REP_SEQUENCE_RECONCILED para este id.',
        rep_punch_log_id: r.id,
        employee_id: r.resolved_user_id,
      });
    }
    if (st === 'ignored' && !ignoredRefs.has(r.id)) {
      out.push({
        code: GovernanceViolationCode.TL_IGNORED_MISSING_TIMELINE,
        message: 'Estado ignored sem evento REP_PUNCH_IGNORED.',
        rep_punch_log_id: r.id,
        employee_id: r.resolved_user_id,
      });
    }
  }

  if (out.length) {
    operationalLog('TIMELINE', { companyId, mismatches: out.length, correlation_id: null });
  }

  return out;
}

export async function syncRepLogsToWaitingReviewAfterMaxAttempts(
  client: SupabaseClient,
  companyId: string,
): Promise<number> {
  const now = new Date().toISOString();
  const { data, error } = await client
    .from('rep_punch_logs')
    .update({
      operational_resolution_status: 'waiting_review',
      operational_resolution_at: now,
      operational_resolution_by: 'system:rep_governance',
      operational_resolution_note: `Promote excedeu ${MAX_REPROMOTE_ATTEMPTS} tentativas; revisão RH obrigatória.`,
    })
    .eq('company_id', companyId)
    .is('time_record_id', null)
    .gte('promotion_attempts', MAX_REPROMOTE_ATTEMPTS)
    .in('operational_resolution_status', ['pending', 'investigating'])
    .select('id');

  if (error) {
    operationalLog('GOVERNANCE', { context: 'waiting_review', message: error.message, correlation_id: null });
    return 0;
  }
  const n = (data ?? []).length;
  if (n) operationalLog('GOVERNANCE', { companyId, waiting_review_promoted: n, correlation_id: null });
  return n;
}

export async function expireStaleRepOperationalLogs(
  client: SupabaseClient,
  companyId: string,
): Promise<number> {
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - REP_EXPIRE_AFTER_DAYS);
  const cutoffIso = cutoff.toISOString();
  const now = new Date().toISOString();

  const { data, error } = await client
    .from('rep_punch_logs')
    .update({
      operational_resolution_status: 'expired',
      operational_resolution_at: now,
      operational_resolution_by: 'system:rep_governance',
      operational_resolution_note: `Expirado após ${REP_EXPIRE_AFTER_DAYS} dias sem vínculo a time_record (dados preservados).`,
    })
    .eq('company_id', companyId)
    .is('time_record_id', null)
    .eq('ignored', false)
    .lt('data_hora', cutoffIso)
    .in('operational_resolution_status', ['pending', 'investigating', 'waiting_review'])
    .select('id');

  if (error) {
    operationalLog('GOVERNANCE', { context: 'expire', message: error.message, correlation_id: null });
    return 0;
  }
  const n = (data ?? []).length;
  if (n) operationalLog('GOVERNANCE', { companyId, expired: n, correlation_id: null });
  return n;
}

export async function beforeManualRepPromoteRpc(
  client: SupabaseClient,
  companyId: string,
  repPunchLogId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data, error } = await client
    .from('rep_punch_logs')
    .select(
      'operational_resolution_status,promotion_attempts,ignored,time_record_id',
    )
    .eq('company_id', companyId)
    .eq('id', repPunchLogId)
    .maybeSingle();

  if (error || !data) return { ok: false, error: 'Batida REP não encontrada.' };
  const row = data as {
    operational_resolution_status: string | null;
    promotion_attempts: number | null;
    ignored: boolean | null;
    time_record_id: string | null;
  };

  if (row.time_record_id) return { ok: false, error: 'Batida já promovida.' };
  if (row.ignored) return { ok: false, error: 'Batida ignorada.' };

  const st = String(row.operational_resolution_status ?? '').trim();
  if (st === 'waiting_review') {
    return { ok: false, error: 'Estado waiting_review: registe decisão de RH (reconciliar/ignorar) antes de novo promote.' };
  }
  if (st === 'reconciled' || st === 'ignored' || st === 'expired') {
    return { ok: false, error: 'Estado operacional fechado para novo promote automático.' };
  }

  if ((row.promotion_attempts ?? 0) >= MAX_REPROMOTE_ATTEMPTS) {
    await client
      .from('rep_punch_logs')
      .update({
        operational_resolution_status: 'waiting_review',
        operational_resolution_at: new Date().toISOString(),
        operational_resolution_by: 'system:rep_governance',
        operational_resolution_note: `Limite de ${MAX_REPROMOTE_ATTEMPTS} tentativas atingido antes do RPC.`,
      })
      .eq('id', repPunchLogId)
      .eq('company_id', companyId);
    return { ok: false, error: `Limite de ${MAX_REPROMOTE_ATTEMPTS} tentativas de promote atingido.` };
  }

  return { ok: true };
}

export async function afterManualRepPromoteRpc(
  client: SupabaseClient,
  companyId: string,
  params: { repPunchLogId: string; employeeId: string; dateYmd: string; reviewedBy: string },
): Promise<void> {
  const { data } = await client
    .from('rep_punch_logs')
    .select('promotion_attempts,operational_resolution_status,time_record_id')
    .eq('company_id', companyId)
    .eq('id', params.repPunchLogId)
    .maybeSingle();

  const row = data as {
    promotion_attempts: number | null;
    operational_resolution_status: string | null;
    time_record_id: string | null;
  } | null;

  if (row && !row.time_record_id && (row.promotion_attempts ?? 0) >= MAX_REPROMOTE_ATTEMPTS) {
    await client
      .from('rep_punch_logs')
      .update({
        operational_resolution_status: 'waiting_review',
        operational_resolution_at: new Date().toISOString(),
        operational_resolution_by: 'system:rep_governance',
        operational_resolution_note: `Após RPC: ${MAX_REPROMOTE_ATTEMPTS}+ tentativas sem vínculo a time_record.`,
      })
      .eq('id', params.repPunchLogId)
      .eq('company_id', companyId);
  }

  await runRepGovernanceAfterReconciliationAction(client, companyId, {
    ...params,
    action: 'retry',
  });
}

async function closeRepPromoteFailureReviewIfAny(
  client: SupabaseClient,
  companyId: string,
  params: { repPunchLogId: string; employeeId: string; dateYmd: string; reviewedBy: string },
): Promise<void> {
  const { rows } = await listTimeAttendanceTimelinePage({
    companyId,
    limit: 200,
    eventType: TimeAttendanceTimelineEventType.REP_PROMOTE_FAILED,
  });

  const hit = rows.find((ev) => {
    const p = (ev.payload ?? {}) as Record<string, unknown>;
    return String(p.rep_punch_log_id ?? '') === params.repPunchLogId;
  });

  if (!hit) return;

  const p = (hit.payload ?? {}) as Record<string, unknown>;
  const code = `rep_promote_failed:${String(p.nsr ?? 'na')}:${hit.id.slice(0, 8)}`;
  await insertIncidentResolution({
    companyId,
    employeeId: params.employeeId,
    dateYmd: params.dateYmd,
    incidentCode: code,
    resolvedBy: params.reviewedBy,
    resolutionNote: 'Fechado automaticamente após reconciliação assistida (batida vinculada).',
    incidentPayload: { category: 'REP_RECONCILIATION', human_reason: 'Reconciliação fechou falha de promote associada.' },
    supabaseClient: client,
  });
}

export async function runRepGovernanceAfterReconciliationAction(
  client: SupabaseClient,
  companyId: string,
  params: {
    repPunchLogId: string;
    employeeId: string;
    dateYmd: string;
    reviewedBy: string;
    action: 'reconcile' | 'ignore' | 'retry' | 'manual_adjust';
  },
): Promise<void> {
  if (params.action === 'reconcile') {
    await closeRepPromoteFailureReviewIfAny(client, companyId, {
      repPunchLogId: params.repPunchLogId,
      employeeId: params.employeeId,
      dateYmd: params.dateYmd,
      reviewedBy: params.reviewedBy,
    });
  }

  const violations = await validateRepOperationalIntegrity(client, companyId, {
    repPunchLogIds: [params.repPunchLogId],
  });
  const tl = await assertTimelineConsistency(client, companyId, [params.repPunchLogId]);

  if (violations.length || tl.length) {
    operationalLog('GOVERNANCE', {
      companyId,
      action: params.action,
      violations: violations.length,
      timeline: tl.length,
      correlation_id: null,
    });
  } else {
    operationalLog('GOVERNANCE', { companyId, action: params.action, ok: true, correlation_id: null });
  }
}

export async function runRepGovernanceAfterPromoteRecoveredBatch(
  client: SupabaseClient,
  companyId: string,
  recovered: { rep_punch_log_id?: string | null; user_id?: string | null; data_hora?: string | null }[],
): Promise<void> {
  const ids = [
    ...new Set(
      recovered
        .map((r) => (r.rep_punch_log_id != null ? String(r.rep_punch_log_id) : ''))
        .filter(Boolean),
    ),
  ];
  if (!ids.length) return;

  const violations = await validateRepOperationalIntegrity(client, companyId, { repPunchLogIds: ids });
  const tl = await assertTimelineConsistency(client, companyId, ids);

  if (violations.length || tl.length) {
    operationalLog('GOVERNANCE', {
      companyId,
      violations: violations.length,
      timeline: tl.length,
      context: 'promote_recovered',
      correlation_id: null,
    });
  } else {
    operationalLog('GOVERNANCE', { companyId, ids: ids.length, ok: true, context: 'promote_recovered', correlation_id: null });
  }
}

export async function runRepGovernanceAfterManualMirrorAdjustment(
  client: SupabaseClient,
  companyId: string,
  params: {
    repPunchLogIds: string[];
    employeeId: string;
    dateYmd: string;
    reviewedBy: string;
  },
): Promise<void> {
  for (const id of params.repPunchLogIds) {
    await runRepGovernanceAfterReconciliationAction(client, companyId, {
      repPunchLogId: id,
      employeeId: params.employeeId,
      dateYmd: params.dateYmd,
      reviewedBy: params.reviewedBy,
      action: 'manual_adjust',
    });
  }
}

export async function runRepGovernanceMaintenance(
  client: SupabaseClient,
  companyId: string,
): Promise<{ expired: number; waitingReview: number }> {
  const expired = await expireStaleRepOperationalLogs(client, companyId);
  const waitingReview = await syncRepLogsToWaitingReviewAfterMaxAttempts(client, companyId);
  return { expired, waitingReview };
}
