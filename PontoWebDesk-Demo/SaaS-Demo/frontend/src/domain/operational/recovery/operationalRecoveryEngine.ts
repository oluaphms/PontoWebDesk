import type { SupabaseClient } from '@supabase/supabase-js';
import { appendTimeAttendanceTimelineEvent } from '../../../services/timeAttendanceTimeline.service';
import {
  TimeAttendanceTimelineEventType,
  TimeAttendanceTimelineSeverity,
} from '../../../services/timeAttendanceTimeline.constants';
import {
  claimOperationalDeadLetterRow,
  insertOperationalDeadLetter,
  listOperationalDeadLettersForCompany,
  markOperationalDeadLetterFailed,
  markOperationalDeadLetterRecovered,
  requeueOperationalDeadLetter,
} from '../../../services/operationalDeadLetter.service';
import { fetchIncidentReviewsForCompany } from '../../../services/timeAttendanceIncidentReviews.service';
import { listTimeAttendanceTimelinePage } from '../../../services/timeAttendanceTimeline.service';
import { operationalLog } from '../observability';
import { buildDeadLetterPayloadV1, type OperationalDeadLetterRow } from './operationalDeadLetterQueue';
import { failedStageToRecoveryKind, getRecoveryPolicy } from './operationalRecoveryPolicies';
import { replayOperationalDeadLetter } from './operationalReplayCoordinator';
import type { OperationalRollbackResult, OperationalTransactionContext } from '../transaction/operationalTransactionContext';

export type OperationalOrphanFinding = {
  kind: string;
  detail: string;
  incident_code?: string;
  employee_id?: string;
  date?: string;
};

export async function recordOperationalDeadLetterFromFailedCommit(
  client: SupabaseClient,
  ctx: OperationalTransactionContext,
  rollback: OperationalRollbackResult,
  failedStage: OperationalRollbackResult['failed_stage'],
  retryableFlag: boolean,
): Promise<void> {
  try {
    const kind = failedStageToRecoveryKind(String(failedStage));
    const policy = getRecoveryPolicy(kind);
    const retryable = rollback.retryable && retryableFlag && policy.retryable;
    const nextAt = retryable ? new Date(Date.now() + policy.cooldown_ms).toISOString() : null;
    const payload = buildDeadLetterPayloadV1({ ctx, rollback });

    const ins = await insertOperationalDeadLetter({
      companyId: ctx.company_id,
      operationId: ctx.operation_id,
      correlationId: ctx.correlation_id,
      failedStage: String(failedStage),
      payload,
      retryable,
      nextRetryAtIso: nextAt,
      supabaseClient: client,
    });

    operationalLog('DLQ', {
      correlation_id: ctx.correlation_id,
      operation_id: ctx.operation_id,
      failed_stage: failedStage,
      retryable,
      inserted: ins.ok,
      duplicate: ins.duplicate === true,
      message: rollback.message,
    });
  } catch (e) {
    operationalLog('DLQ', {
      correlation_id: ctx.correlation_id,
      operation_id: ctx.operation_id,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

async function appendRecoveryTimeline(
  client: SupabaseClient,
  companyId: string,
  eventType: (typeof TimeAttendanceTimelineEventType)[keyof typeof TimeAttendanceTimelineEventType],
  payload: Record<string, unknown>,
): Promise<void> {
  await appendTimeAttendanceTimelineEvent({
    companyId,
    eventType,
    eventSeverity: TimeAttendanceTimelineSeverity.medium,
    sourceModule: 'operational_recovery',
    payload,
    supabaseClient: client,
  });
}

/** Validação leve pós-recovery: reviews esperadas vs timeline INCIDENT_RESOLVED. */
export async function validateOperationalRecoveryConsistency(
  client: SupabaseClient,
  companyId: string,
  payload: import('./operationalDeadLetterQueue').OperationalDeadLetterPayloadV1,
): Promise<{ ok: boolean; gaps: string[] }> {
  const gaps: string[] = [];
  const { rows: recent } = await listTimeAttendanceTimelinePage({ companyId, limit: 400, supabaseClient: client });
  const tlCodes = new Set<string>();
  for (const r of recent) {
    if (r.event_type !== TimeAttendanceTimelineEventType.INCIDENT_RESOLVED) continue;
    const p = (r.payload ?? {}) as Record<string, unknown>;
    const c = String(p.incident_code ?? '').trim();
    if (c) tlCodes.add(c);
  }
  for (const inc of payload.incidents) {
    const code = inc.incidentCode.trim();
    if (!tlCodes.has(code)) gaps.push(`review_sem_timeline:${code}`);
  }
  return { ok: gaps.length === 0, gaps };
}

/** Detecção heurística de órfãos (amostra limitada). */
export async function detectOperationalOrphans(
  client: SupabaseClient,
  companyId: string,
  opts?: { reviewLimit?: number },
): Promise<OperationalOrphanFinding[]> {
  const limit = Math.min(300, Math.max(20, opts?.reviewLimit ?? 120));
  const reviews = await fetchIncidentReviewsForCompany(companyId, { supabaseClient: client });
  const sample = reviews.slice(0, limit);
  const { rows: recent } = await listTimeAttendanceTimelinePage({ companyId, limit: 600, supabaseClient: client });
  const resolvedCodes = new Set<string>();
  for (const r of recent) {
    if (r.event_type !== TimeAttendanceTimelineEventType.INCIDENT_RESOLVED) continue;
    const p = (r.payload ?? {}) as Record<string, unknown>;
    const c = String(p.incident_code ?? '').trim();
    if (c) resolvedCodes.add(c);
  }
  const out: OperationalOrphanFinding[] = [];
  for (const rev of sample) {
    if (!resolvedCodes.has(rev.incident_code)) {
      const finding: OperationalOrphanFinding = {
        kind: 'review_sem_timeline',
        detail: `Resolução sem INCIDENT_RESOLVED na timeline recente.`,
        incident_code: rev.incident_code,
        employee_id: rev.employee_id,
        date: rev.date,
      };
      out.push(finding);
      operationalLog('ORPHAN', {
        correlation_id: null,
        operation_id: null,
        kind: finding.kind,
        incident_code: rev.incident_code,
        company_id: companyId,
      });
    }
  }
  if (out.length > 0) {
    await appendTimeAttendanceTimelineEvent({
      companyId,
      eventType: TimeAttendanceTimelineEventType.OPERATIONAL_ORPHAN_DETECTED,
      eventSeverity: TimeAttendanceTimelineSeverity.high,
      sourceModule: 'operational_recovery',
      payload: {
        count: out.length,
        sample: out.slice(0, 8).map((o) => ({ kind: o.kind, incident_code: o.incident_code })),
      },
      supabaseClient: client,
    });
  }
  return out;
}

export type OperationalRecoveryAttemptOutcome = 'recovered' | 'requeued' | 'failed';

export async function runOperationalRecoveryAttempt(
  client: SupabaseClient,
  companyId: string,
  claimed: OperationalDeadLetterRow,
  opts?: { triggeredBy?: string | null },
): Promise<OperationalRecoveryAttemptOutcome> {
  await appendRecoveryTimeline(client, companyId, TimeAttendanceTimelineEventType.OPERATIONAL_RECOVERY_STARTED, {
    dlq_id: claimed.id,
    operation_id: claimed.operation_id,
    correlation_id: claimed.correlation_id,
    retry_count: claimed.retry_count,
  });

  const kind = failedStageToRecoveryKind(claimed.failed_stage);
  const policy = getRecoveryPolicy(kind);
  if (!claimed.retryable || claimed.retry_count >= policy.max_retries) {
    await markOperationalDeadLetterFailed(client, claimed.id, companyId, 'max_retries_or_not_retryable');
    await appendRecoveryTimeline(client, companyId, TimeAttendanceTimelineEventType.OPERATIONAL_RECOVERY_FAILED, {
      dlq_id: claimed.id,
      operation_id: claimed.operation_id,
      reason: 'max_retries_or_not_retryable',
    });
    return 'failed';
  }

  await appendRecoveryTimeline(client, companyId, TimeAttendanceTimelineEventType.OPERATIONAL_RECOVERY_RETRY, {
    dlq_id: claimed.id,
    operation_id: claimed.operation_id,
    attempt: claimed.retry_count + 1,
  });

  const replay = await replayOperationalDeadLetter(client, claimed, { triggeredBy: opts?.triggeredBy });
  const payload = claimed.payload as import('./operationalDeadLetterQueue').OperationalDeadLetterPayloadV1;

  if (replay.ok && payload?.version === 1) {
    const check = await validateOperationalRecoveryConsistency(client, companyId, payload);
    if (check.ok) {
      await markOperationalDeadLetterRecovered(client, claimed.id, companyId);
      operationalLog('RECOVERY', {
        correlation_id: claimed.correlation_id,
        operation_id: claimed.operation_id,
        dlq_id: claimed.id,
        outcome: 'recovered',
      });
      await appendRecoveryTimeline(client, companyId, TimeAttendanceTimelineEventType.OPERATIONAL_RECOVERY_SUCCEEDED, {
        dlq_id: claimed.id,
        operation_id: claimed.operation_id,
      });
      return 'recovered';
    }
    const nextRetry = claimed.retry_count + 1;
    const esc = Math.min(3, policy.escalation_level + (nextRetry > 2 ? 1 : 0));
    const cooldown = policy.cooldown_ms * (1 + esc * 0.25);
    await requeueOperationalDeadLetter(client, claimed.id, companyId, {
      retryCount: nextRetry,
      lastError: `consistency: ${check.gaps.join('; ')}`,
      nextRetryAtIso: new Date(Date.now() + cooldown).toISOString(),
    });
    operationalLog('RECOVERY', {
      correlation_id: claimed.correlation_id,
      operation_id: claimed.operation_id,
      dlq_id: claimed.id,
      outcome: 'requeue_consistency',
      gaps: check.gaps,
    });
    await appendRecoveryTimeline(client, companyId, TimeAttendanceTimelineEventType.OPERATIONAL_RECOVERY_FAILED, {
      dlq_id: claimed.id,
      operation_id: claimed.operation_id,
      reason: 'consistency_gaps',
      gaps: check.gaps,
    });
    return 'requeued';
  }

  const nextRetry = claimed.retry_count + 1;
  const errMsg = replay.error ?? 'replay_failed';
  if (nextRetry >= policy.max_retries) {
    await markOperationalDeadLetterFailed(client, claimed.id, companyId, errMsg);
    await appendRecoveryTimeline(client, companyId, TimeAttendanceTimelineEventType.OPERATIONAL_RECOVERY_FAILED, {
      dlq_id: claimed.id,
      operation_id: claimed.operation_id,
      error: errMsg,
    });
    return 'failed';
  }
  await requeueOperationalDeadLetter(client, claimed.id, companyId, {
    retryCount: nextRetry,
    lastError: errMsg,
    nextRetryAtIso: new Date(Date.now() + policy.cooldown_ms * (1 + claimed.retry_count * 0.15)).toISOString(),
  });
  await appendRecoveryTimeline(client, companyId, TimeAttendanceTimelineEventType.OPERATIONAL_RECOVERY_FAILED, {
    dlq_id: claimed.id,
    operation_id: claimed.operation_id,
    error: errMsg,
  });
  return 'requeued';
}

export async function recoverSingleOperationalDeadLetter(
  client: SupabaseClient,
  companyId: string,
  dlqId: string,
  opts?: { triggeredBy?: string | null },
): Promise<{ ok: boolean; outcome?: OperationalRecoveryAttemptOutcome }> {
  const claimed = await claimOperationalDeadLetterRow(client, dlqId, companyId);
  if (!claimed) return { ok: false };
  const outcome = await runOperationalRecoveryAttempt(client, companyId, claimed, opts);
  return { ok: true, outcome };
}

export async function recoverPendingOperationalFailures(
  client: SupabaseClient,
  companyId: string,
  opts?: { maxItems?: number; triggeredBy?: string | null },
): Promise<{ processed: number; recovered: number; requeued: number; failed: number }> {
  const maxItems = Math.min(20, Math.max(1, opts?.maxItems ?? 5));
  const pending = await listOperationalDeadLettersForCompany(client, companyId, {
    status: 'pending',
    limit: maxItems * 2,
  });
  const now = Date.now();
  const eligible = pending.filter((r) => {
    if (!r.next_retry_at) return true;
    return new Date(r.next_retry_at).getTime() <= now;
  });

  let processed = 0;
  let recovered = 0;
  let requeued = 0;
  let failed = 0;

  for (const row of eligible) {
    if (processed >= maxItems) break;
    const claimed = await claimOperationalDeadLetterRow(client, row.id, companyId);
    if (!claimed) continue;
    processed++;
    const outcome = await runOperationalRecoveryAttempt(client, companyId, claimed, opts);
    if (outcome === 'recovered') recovered++;
    else if (outcome === 'requeued') requeued++;
    else failed++;
  }

  return { processed, recovered, requeued, failed };
}
