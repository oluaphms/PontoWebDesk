import type { SupabaseClient } from '@supabase/supabase-js';
import { appendTimeAttendanceTimelineEventOrThrow } from '../../../services/timeAttendanceTimeline.service';
import { insertIncidentResolutionOrThrow } from '../../../services/timeAttendanceIncidentReviews.service';
import { TimeAttendanceTimelineEventType } from '../../../services/timeAttendanceTimeline.constants';
import { TimeAttendanceTimelineSeverity } from '../../../services/timeAttendanceTimeline.constants';
import { buildOperationalTimelinePayload } from '../timeline/operationalTimelineContract';
import { operationalLog } from '../observability';
import { appendOperationalTraceSpan, beginOperationalTrace, failOperationalTrace, finalizeOperationalTrace } from '../tracing';
import { recordOperationalMetric } from '../metrics';
import type { EmitOperationalEventBase } from '../timeline/operationalEventTypes';
import type {
  BufferedIncidentResolutionInput,
  OperationalCommitResult,
  OperationalRollbackResult,
  OperationalTransactionContext,
} from './operationalTransactionContext';
import { tryClaimOperationalIdempotencyKey } from './operationalTransactionContext';

function enrichPayload(ctx: OperationalTransactionContext, payload: Record<string, unknown>): Record<string, unknown> {
  return {
    ...payload,
    correlation_id: ctx.correlation_id,
    operation_id: ctx.operation_id,
  };
}

function emitOperationalTransactionLog(payload: Record<string, unknown>): void {
  if (typeof console === 'undefined') return;
  console.info('[OPERATIONAL_TRANSACTION]', payload);
}

function transactionLogBase(
  ctx: OperationalTransactionContext,
  result: 'committed' | 'rolled_back',
): Record<string, unknown> {
  return {
    event_version: 'v1',
    transaction_id: ctx.operation_id,
    correlation_id: ctx.correlation_id,
    operation_id: ctx.operation_id,
    result,
    event_type:
      result === 'committed'
        ? 'OPERATIONAL_TRANSACTION_COMMITTED'
        : 'OPERATIONAL_TRANSACTION_ROLLED_BACK',
  };
}

function baseToTimelineAppend(
  ctx: OperationalTransactionContext,
  base: EmitOperationalEventBase,
  client: SupabaseClient,
): Parameters<typeof appendTimeAttendanceTimelineEventOrThrow>[0] {
  const built = buildOperationalTimelinePayload({
    correlation_id: base.correlationId,
    actor: base.actor,
    source: base.source,
    before_state: base.beforeState,
    after_state: base.afterState,
    metadata: base.metadata,
  }) as Record<string, unknown>;
  const payload = enrichPayload(ctx, built);

  return {
    companyId: base.companyId,
    employeeId: base.employeeId,
    date: base.dateYmd,
    eventType: base.eventType,
    eventSeverity: base.eventSeverity ?? TimeAttendanceTimelineSeverity.info,
    sourceModule: base.source,
    sourceReferenceId: base.sourceReferenceId ?? null,
    payload,
    createdBy: base.createdBy ?? base.actor,
    supabaseClient: client,
  };
}

function pendingAfterIncidentFailure(ctx: OperationalTransactionContext, fromIndex: number): string[] {
  const out: string[] = [];
  for (let j = fromIndex; j < ctx.incident_buffer.length; j++) {
    out.push(`incident_review:${ctx.incident_buffer[j].incidentCode}`);
  }
  for (let j = 0; j < ctx.timeline_buffer.length; j++) {
    out.push(`timeline:${ctx.timeline_buffer[j].eventType}:${j}`);
  }
  for (let j = 0; j < ctx.reliability_updates.length; j++) out.push(`reliability:${j}`);
  for (let j = 0; j < ctx.health_updates.length; j++) out.push(`health:${j}`);
  for (let j = 0; j < ctx.governance_updates.length; j++) out.push(`governance:${j}`);
  return out;
}

function pendingAfterTimelineFailure(ctx: OperationalTransactionContext, fromIndex: number): string[] {
  const out: string[] = [];
  for (let j = fromIndex; j < ctx.timeline_buffer.length; j++) {
    out.push(`timeline:${ctx.timeline_buffer[j].eventType}:${j}`);
  }
  for (let j = 0; j < ctx.reliability_updates.length; j++) out.push(`reliability:${j}`);
  for (let j = 0; j < ctx.health_updates.length; j++) out.push(`health:${j}`);
  for (let j = 0; j < ctx.governance_updates.length; j++) out.push(`governance:${j}`);
  return out;
}

function pendingAfterReliabilityFailure(ctx: OperationalTransactionContext, fromIndex: number): string[] {
  const out: string[] = [];
  for (let j = fromIndex; j < ctx.reliability_updates.length; j++) out.push(`reliability:${j}`);
  for (let j = 0; j < ctx.health_updates.length; j++) out.push(`health:${j}`);
  for (let j = 0; j < ctx.governance_updates.length; j++) out.push(`governance:${j}`);
  return out;
}

function pendingAfterHealthFailure(ctx: OperationalTransactionContext, fromIndex: number): string[] {
  const out: string[] = [];
  for (let j = fromIndex; j < ctx.health_updates.length; j++) out.push(`health:${j}`);
  for (let j = 0; j < ctx.governance_updates.length; j++) out.push(`governance:${j}`);
  return out;
}

function pendingAfterGovernanceFailure(ctx: OperationalTransactionContext, fromIndex: number): string[] {
  const out: string[] = [];
  for (let j = fromIndex; j < ctx.governance_updates.length; j++) out.push(`governance:${j}`);
  return out;
}

/**
 * Incidente + timeline companion (INCIDENT_RESOLVED) no mesmo commit, com correlation_id / operation_id.
 */
export function emitOperationalIncident(ctx: OperationalTransactionContext, review: BufferedIncidentResolutionInput): void {
  if (ctx.committed || ctx.failed) return;
  const client = ctx.supabaseClient;
  if (!client) return;

  const packageKey = `incident_package:${review.incidentCode}:${review.dateYmd}`;
  if (!tryClaimOperationalIdempotencyKey(ctx, packageKey)) return;

  ctx.incident_buffer.push({
    ...review,
    incidentPayload: {
      ...review.incidentPayload,
      correlation_id: ctx.correlation_id,
      operation_id: ctx.operation_id,
      lifecycle: review.incidentPayload?.lifecycle ?? null,
    },
  });

  const rowNote = review.resolutionNote?.trim() || null;

  ctx.timeline_buffer.push({
    supabaseClient: client,
    companyId: review.companyId,
    employeeId: review.employeeId,
    dateYmd: review.dateYmd,
    eventType: TimeAttendanceTimelineEventType.INCIDENT_RESOLVED,
    eventSeverity: TimeAttendanceTimelineSeverity.low,
    correlationId: ctx.correlation_id,
    actor: review.resolvedBy,
    source: 'operational_incidents',
    sourceReferenceId: review.incidentCode,
    beforeState: undefined,
    afterState: undefined,
    metadata: {
      incident_code: review.incidentCode,
      resolution_note: rowNote,
      ...review.incidentPayload,
      correlation_id: ctx.correlation_id,
      operation_id: ctx.operation_id,
    },
    createdBy: review.resolvedBy,
  });
}

export async function commitOperationalTransaction(
  client: SupabaseClient,
  ctx: OperationalTransactionContext,
): Promise<OperationalCommitResult> {
  const t0 = Date.now();
  const trace = beginOperationalTrace({
    trace_id: ctx.operation_id,
    company_id: ctx.company_id,
    employee_id: null,
    correlation_id: ctx.correlation_id,
    operation_id: ctx.operation_id,
    source: 'commitOperationalTransaction',
  });
  if (ctx.committed) {
    emitOperationalTransactionLog({
      ...transactionLogBase(ctx, 'committed'),
      duplicate: true,
    });
    return { ok: true, duration_ms: Date.now() - t0, entities_written: [], duplicate: true };
  }
  if (ctx.failed) {
    emitOperationalTransactionLog({
      ...transactionLogBase(ctx, 'rolled_back'),
      duplicate: true,
      failed_stage: ctx.failed_stage ?? 'unknown',
      message: 'Transação já marcada como falha.',
    });
    return {
      ok: false,
      duration_ms: Date.now() - t0,
      rollback: {
        transaction_failed: true,
        failed_stage: ctx.failed_stage ?? 'unknown',
        persisted_entities: [],
        pending_entities: ['transaction_already_failed'],
        retryable: false,
        message: 'Transação já marcada como falha.',
      },
    };
  }

  const persisted: string[] = [];

  const finalizeFailure = async (
    stage: OperationalRollbackResult['failed_stage'],
    msg: string,
    retryable: boolean,
    pending_entities: string[],
  ): Promise<OperationalCommitResult> => {
    ctx.failed = true;
    ctx.failed_stage = stage;
    const duration_ms = Date.now() - t0;
    const rollback: OperationalRollbackResult = {
      transaction_failed: true,
      failed_stage: stage,
      persisted_entities: [...persisted],
      pending_entities,
      retryable,
      message: msg,
    };
    appendOperationalTraceSpan({
      trace_id: trace.trace_id,
      type: 'GOVERNANCE',
      source: `commitOperationalTransaction:${stage}`,
      status: 'error',
      finished_at: new Date().toISOString(),
      metadata: { message: msg, retryable, pending_entities: pending_entities.length },
    });
    recordOperationalMetric('retry_storm_rate', retryable ? 1 : 0, {
      company_id: ctx.company_id,
      source: 'commitOperationalTransaction',
      operation_type: stage,
    });
    try {
      const { recordOperationalDeadLetterFromFailedCommit } = await import('../recovery/operationalRecoveryEngine');
      await recordOperationalDeadLetterFromFailedCommit(client, ctx, rollback, stage, retryable);
    } catch {
      /* DLQ best-effort */
    }
    operationalLog('TRANSACTION', {
      correlation_id: ctx.correlation_id,
      operation_id: ctx.operation_id,
      duration_ms,
      committed: false,
      rolled_back: true,
      transaction_failed: true,
      failed_stage: stage,
      persisted_entities: persisted,
      pending_entities,
      message: msg,
    });
    emitOperationalTransactionLog({
      ...transactionLogBase(ctx, 'rolled_back'),
      failed_stage: stage,
      duration_ms,
      persisted_entities: persisted,
      pending_entities,
      message: msg,
    });
    failOperationalTrace(trace.trace_id, msg);
    return {
      ok: false,
      duration_ms,
      rollback,
    };
  };

  try {
    for (let i = 0; i < ctx.incident_buffer.length; i++) {
      const inc = ctx.incident_buffer[i];
      try {
        await insertIncidentResolutionOrThrow({
          companyId: inc.companyId,
          incidentCode: inc.incidentCode,
          employeeId: inc.employeeId,
          dateYmd: inc.dateYmd,
          resolvedBy: inc.resolvedBy,
          resolutionNote: inc.resolutionNote,
          incidentPayload: inc.incidentPayload,
          supabaseClient: client,
          skipCompanionTimeline: true,
        });
        persisted.push(`incident_review:${inc.incidentCode}`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return await finalizeFailure('incident_review', msg, true, pendingAfterIncidentFailure(ctx, i));
      }
    }

    for (let i = 0; i < ctx.timeline_buffer.length; i++) {
      const ev = ctx.timeline_buffer[i];
      try {
        await appendTimeAttendanceTimelineEventOrThrow(baseToTimelineAppend(ctx, ev, client));
        persisted.push(`timeline:${ev.eventType}:${i}`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return await finalizeFailure('timeline', msg, true, pendingAfterTimelineFailure(ctx, i));
      }
    }

    for (let i = 0; i < ctx.reliability_updates.length; i++) {
      try {
        await ctx.reliability_updates[i]();
        persisted.push(`reliability:${i}`);
        recordOperationalMetric('reliability_snapshot_growth', 1, {
          company_id: ctx.company_id,
          source: 'commitOperationalTransaction',
          operation_type: 'reliability_update',
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return await finalizeFailure('reliability', msg, true, pendingAfterReliabilityFailure(ctx, i));
      }
    }

    for (let i = 0; i < ctx.health_updates.length; i++) {
      try {
        await ctx.health_updates[i]();
        persisted.push(`health:${i}`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return await finalizeFailure('health', msg, true, pendingAfterHealthFailure(ctx, i));
      }
    }

    for (let i = 0; i < ctx.governance_updates.length; i++) {
      try {
        await ctx.governance_updates[i]();
        persisted.push(`governance:${i}`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return await finalizeFailure('governance', msg, false, pendingAfterGovernanceFailure(ctx, i));
      }
    }

    ctx.committed = true;
    const duration_ms = Date.now() - t0;
    appendOperationalTraceSpan({
      trace_id: trace.trace_id,
      type: 'GOVERNANCE',
      source: 'commitOperationalTransaction',
      status: 'ok',
      finished_at: new Date().toISOString(),
      metadata: { entities_written: persisted.length, duration_ms },
    });
    recordOperationalMetric('replay_duration_ms', duration_ms, {
      company_id: ctx.company_id,
      source: 'commitOperationalTransaction',
      operation_type: 'transaction_commit',
    });
    operationalLog('TRANSACTION', {
      correlation_id: ctx.correlation_id,
      operation_id: ctx.operation_id,
      duration_ms,
      committed: true,
      rolled_back: false,
      transaction_failed: false,
      failed_stage: null,
      entities_written: persisted,
    });
    emitOperationalTransactionLog({
      ...transactionLogBase(ctx, 'committed'),
      duration_ms,
      entities_written: persisted,
    });
    finalizeOperationalTrace(trace.trace_id);
    return { ok: true, duration_ms, entities_written: persisted };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    failOperationalTrace(trace.trace_id, msg);
    return await finalizeFailure('commit', msg, true, [`exception:${msg}`]);
  }
}

export function pushHealthUpdate(ctx: OperationalTransactionContext, fn: () => Promise<void>): void {
  if (ctx.committed || ctx.failed) return;
  ctx.health_updates.push(fn);
}

export function pushGovernanceUpdate(ctx: OperationalTransactionContext, fn: () => Promise<void>): void {
  if (ctx.committed || ctx.failed) return;
  ctx.governance_updates.push(fn);
}

export function pushReliabilityUpdate(ctx: OperationalTransactionContext, fn: () => Promise<void>): void {
  if (ctx.committed || ctx.failed) return;
  ctx.reliability_updates.push(fn);
}
