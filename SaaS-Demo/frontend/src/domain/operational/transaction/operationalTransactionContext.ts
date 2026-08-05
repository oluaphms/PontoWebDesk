import type { SupabaseClient } from '@supabase/supabase-js';
import type { OperationalRecoveryTransactionHints } from '../recovery/operationalRecoveryHints';
import type { EmitOperationalEventBase } from '../timeline/operationalEventTypes';

/** Resolução de incidente enfileirada (persistida em `time_attendance_incident_reviews`). */
export type BufferedIncidentResolutionInput = {
  companyId: string;
  incidentCode: string;
  employeeId: string;
  dateYmd: string;
  resolvedBy: string;
  resolutionNote?: string | null;
  incidentPayload?: {
    severity?: string;
    category?: string;
    recommended_action?: string;
    human_reason?: string;
    correlation_id?: string | null;
    operation_id?: string | null;
    lifecycle?: string | null;
  };
};

export type OperationalCommitStage = 'incident_review' | 'timeline' | 'reliability' | 'health' | 'governance';

export type OperationalRollbackResult = {
  transaction_failed: true;
  failed_stage: OperationalCommitStage | 'commit' | 'unknown';
  persisted_entities: string[];
  pending_entities: string[];
  retryable: boolean;
  message?: string;
};

export type OperationalCommitResult =
  | {
      ok: true;
      duration_ms: number;
      entities_written: string[];
      duplicate?: boolean;
    }
  | {
      ok: false;
      duration_ms: number;
      rollback: OperationalRollbackResult;
    };

export type OperationalTransactionContext = {
  operation_id: string;
  correlation_id: string;
  actor: string | null;
  company_id: string;
  source: string;
  started_at: string;
  supabaseClient: SupabaseClient | null;
  event_buffer: EmitOperationalEventBase[];
  incident_buffer: BufferedIncidentResolutionInput[];
  timeline_buffer: EmitOperationalEventBase[];
  health_updates: Array<() => Promise<void>>;
  governance_updates: Array<() => Promise<void>>;
  reliability_updates: Array<() => Promise<void>>;
  idempotencyKeys: Set<string>;
  committed: boolean;
  failed: boolean;
  failed_stage: OperationalCommitStage | 'commit' | 'unknown' | null;
  /** Dicas para replay (health/governança) sem serializar closures. */
  recovery_meta: OperationalRecoveryTransactionHints | null;
};

export type CreateOperationalTransactionInput = {
  operation_id: string;
  correlation_id: string;
  actor: string | null;
  company_id: string;
  source: string;
  supabaseClient: SupabaseClient | null;
  recovery_meta?: OperationalRecoveryTransactionHints | null;
};

export function createOperationalTransactionContext(input: CreateOperationalTransactionInput): OperationalTransactionContext {
  return {
    operation_id: input.operation_id,
    correlation_id: input.correlation_id,
    actor: input.actor,
    company_id: input.company_id,
    source: input.source,
    started_at: new Date().toISOString(),
    supabaseClient: input.supabaseClient,
    event_buffer: [],
    incident_buffer: [],
    timeline_buffer: [],
    health_updates: [],
    governance_updates: [],
    reliability_updates: [],
    idempotencyKeys: new Set(),
    committed: false,
    failed: false,
    failed_stage: null,
    recovery_meta: input.recovery_meta ?? null,
  };
}

export function tryClaimOperationalIdempotencyKey(ctx: OperationalTransactionContext, key: string): boolean {
  if (ctx.committed || ctx.failed) return false;
  const k = String(key ?? '').trim();
  if (!k) return true;
  if (ctx.idempotencyKeys.has(k)) return false;
  ctx.idempotencyKeys.add(k);
  return true;
}
