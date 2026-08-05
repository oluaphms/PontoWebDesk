import { appendTimeAttendanceTimelineEvent } from '../../../services/timeAttendanceTimeline.service';
import type { TimeAttendanceTimelineSeverityValue } from '../../../services/timeAttendanceTimeline.constants';
import { TimeAttendanceTimelineSeverity } from '../../../services/timeAttendanceTimeline.constants';
import type { TimelineEventTypeValue } from './timelineEventType';
import { buildOperationalTimelinePayload } from './operationalTimelineContract';
import { operationalLog } from '../observability';
import type { EmitOperationalEventBase } from './operationalEventTypes';
import type { OperationalTransactionContext } from '../transaction/operationalTransactionContext';
import { tryClaimOperationalIdempotencyKey } from '../transaction/operationalTransactionContext';

export type EmitOperationalEventInput = EmitOperationalEventBase & {
  transactionContext?: OperationalTransactionContext | null;
  idempotencyKey?: string | null;
};

type OperationalEventConsumer = (input: EmitOperationalEventInput & { payload: Record<string, unknown> }) => void | Promise<void>;

const consumers: OperationalEventConsumer[] = [];

/** Extensível: consumidores internos (ex.: métricas) sem duplicar append. */
export function registerOperationalEventConsumer(fn: OperationalEventConsumer): () => void {
  consumers.push(fn);
  return () => {
    const i = consumers.indexOf(fn);
    if (i >= 0) consumers.splice(i, 1);
  };
}

function toBase(input: EmitOperationalEventInput): EmitOperationalEventBase {
  const {
    transactionContext: _tc,
    idempotencyKey: _ik,
    ...base
  } = input;
  return base;
}

/**
 * Barramento leve: um único caminho para eventos operacionais com correlation_id e before/after.
 * Com `transactionContext`, apenas bufferiza até `commitOperationalTransaction` (sem I/O).
 */
export async function emitOperationalEvent(input: EmitOperationalEventInput): Promise<void> {
  const payload = buildOperationalTimelinePayload({
    correlation_id: input.correlationId,
    actor: input.actor,
    source: input.source,
    before_state: input.beforeState,
    after_state: input.afterState,
    metadata: input.metadata,
  });

  if (input.transactionContext) {
    const ctx = input.transactionContext;
    if (ctx.committed || ctx.failed) return;
    const idem =
      (input.idempotencyKey != null && String(input.idempotencyKey).trim() !== ''
        ? String(input.idempotencyKey).trim()
        : null) ?? `ev:${input.eventType}:${input.sourceReferenceId ?? ctx.timeline_buffer.length}`;
    if (!tryClaimOperationalIdempotencyKey(ctx, idem)) return;

    const base = toBase(input);
    ctx.event_buffer.push({ ...base });
    ctx.timeline_buffer.push({ ...base });

    operationalLog('EVENT', {
      correlation_id: input.correlationId,
      operation_id: ctx.operation_id,
      eventType: input.eventType,
      source: input.source,
      companyId: input.companyId,
      buffered: true,
    });
    return;
  }

  operationalLog('EVENT', {
    correlation_id: input.correlationId,
    eventType: input.eventType,
    source: input.source,
    companyId: input.companyId,
  });

  for (const c of consumers) {
    await c({ ...input, payload });
  }

  await appendTimeAttendanceTimelineEvent({
    companyId: input.companyId,
    employeeId: input.employeeId,
    date: input.dateYmd,
    eventType: input.eventType,
    eventSeverity: input.eventSeverity ?? TimeAttendanceTimelineSeverity.info,
    sourceModule: input.source,
    sourceReferenceId:
      input.sourceReferenceId ??
      (input.metadata?.source_reference_id != null ? String(input.metadata.source_reference_id) : null),
    payload,
    createdBy: input.createdBy ?? input.actor,
    supabaseClient: input.supabaseClient,
  });
}
