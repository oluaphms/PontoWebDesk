import type { EmitOperationalEventBase } from '../timeline/operationalEventTypes';
import type { BufferedIncidentResolutionInput, OperationalRollbackResult } from '../transaction/operationalTransactionContext';
import type { OperationalRecoveryTransactionHints } from './operationalRecoveryHints';

export type { OperationalRecoveryTransactionHints };

export type OperationalDeadLetterStatus = 'pending' | 'retrying' | 'recovered' | 'failed' | 'ignored';

export type OperationalDeadLetterPayloadV1 = {
  version: 1;
  incidents: BufferedIncidentResolutionInput[];
  timeline: Array<Omit<EmitOperationalEventBase, 'supabaseClient'>>;
  recovery_meta: OperationalRecoveryTransactionHints | null;
  rollback: Pick<OperationalRollbackResult, 'persisted_entities' | 'pending_entities' | 'message'>;
  source: string;
  actor: string | null;
  started_at: string;
  idempotency_keys: string[];
};

export type OperationalDeadLetterRow = {
  id: string;
  company_id: string;
  operation_id: string;
  correlation_id: string;
  failed_stage: string;
  payload: OperationalDeadLetterPayloadV1 | Record<string, unknown>;
  retry_count: number;
  retryable: boolean;
  status: OperationalDeadLetterStatus;
  last_error: string | null;
  next_retry_at: string | null;
  created_at: string;
  updated_at: string;
  recovered_at: string | null;
};

export function buildDeadLetterPayloadV1(input: {
  ctx: {
    incident_buffer: BufferedIncidentResolutionInput[];
    timeline_buffer: EmitOperationalEventBase[];
    recovery_meta?: OperationalRecoveryTransactionHints | null;
    source: string;
    actor: string | null;
    started_at: string;
    idempotencyKeys: Set<string>;
  };
  rollback: OperationalRollbackResult;
}): OperationalDeadLetterPayloadV1 {
  const timeline = input.ctx.timeline_buffer.map(({ supabaseClient: _s, ...rest }) => rest);
  return {
    version: 1,
    incidents: input.ctx.incident_buffer.map((i) => ({ ...i })),
    timeline,
    recovery_meta: input.ctx.recovery_meta ?? null,
    rollback: {
      persisted_entities: input.rollback.persisted_entities,
      pending_entities: input.rollback.pending_entities,
      message: input.rollback.message,
    },
    source: input.ctx.source,
    actor: input.ctx.actor,
    started_at: input.ctx.started_at,
    idempotency_keys: [...input.ctx.idempotencyKeys],
  };
}
