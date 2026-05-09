import type { SupabaseClient } from '@supabase/supabase-js';
import { recalculate_period } from '../../../engine/timeEngine';
import { createOperationalCorrelationId } from '../correlationId';
import type { EmitOperationalEventBase } from '../timeline/operationalEventTypes';
import { createOperationalTransactionContext } from '../transaction/operationalTransactionContext';
import { commitOperationalTransaction, pushGovernanceUpdate, pushHealthUpdate } from '../transaction/operationalUnitOfWork';
import type { OperationalDeadLetterPayloadV1, OperationalDeadLetterRow } from './operationalDeadLetterQueue';
import { operationalLog } from '../observability';
import { runRepGovernanceAfterReconciliationAction } from '../../../services/repOperationalIntegrity.service';
import { refreshCurrentOperationalStateRpc } from '../../../services/currentOperationalState.service';

function persistedSet(rollback: OperationalDeadLetterPayloadV1['rollback']): Set<string> {
  return new Set(rollback.persisted_entities);
}

/** Remove etapas já gravadas com sucesso antes do ponto de falha (replay parcial idempotente). */
export function buildReplayBuffersFromPayload(
  client: SupabaseClient,
  payload: OperationalDeadLetterPayloadV1,
  replayCorrelationId: string,
): {
  incidents: typeof payload.incidents;
  timeline: EmitOperationalEventBase[];
  needsHealth: boolean;
  needsGovernance: boolean;
} {
  const p = persistedSet(payload.rollback);
  const incidents = payload.incidents.filter((i) => !p.has(`incident_review:${i.incidentCode}`));
  const timeline: EmitOperationalEventBase[] = [];
  payload.timeline.forEach((ev, idx) => {
    if (p.has(`timeline:${ev.eventType}:${idx}`)) return;
    timeline.push({
      ...ev,
      supabaseClient: client,
      correlationId: replayCorrelationId,
    });
  });
  const needsHealth = !p.has('health:0');
  const needsGovernance = !p.has('governance:0');
  return { incidents, timeline, needsHealth, needsGovernance };
}

/**
 * Replay seguro: reutiliza `operation_id`, novo `correlation_id`, respeita entidades já persistidas.
 */
export async function replayOperationalDeadLetter(
  client: SupabaseClient,
  row: OperationalDeadLetterRow,
  _opts?: { triggeredBy?: string | null },
): Promise<{ ok: boolean; error?: string; commit?: Awaited<ReturnType<typeof commitOperationalTransaction>> }> {
  const raw = row.payload as OperationalDeadLetterPayloadV1;
  if (!raw || raw.version !== 1) {
    return { ok: false, error: 'Payload DLQ inválido ou versão não suportada.' };
  }

  const replayCorrelationId = createOperationalCorrelationId();
  const { incidents, timeline, needsHealth, needsGovernance } = buildReplayBuffersFromPayload(client, raw, replayCorrelationId);

  operationalLog('REPLAY', {
    correlation_id: replayCorrelationId,
    operation_id: row.operation_id,
    dlq_id: row.id,
    incidents: incidents.length,
    timeline: timeline.length,
  });

  const ctx = createOperationalTransactionContext({
    operation_id: row.operation_id,
    correlation_id: replayCorrelationId,
    actor: raw.actor,
    company_id: row.company_id,
    source: `${raw.source}:replay`,
    supabaseClient: client,
    recovery_meta: raw.recovery_meta ?? null,
  });

  ctx.incident_buffer.push(...incidents.map((i) => ({ ...i })));
  ctx.timeline_buffer.push(...timeline);

  const hints = raw.recovery_meta?.rep_reconciliation;
  if (needsHealth && hints) {
    pushHealthUpdate(ctx, () => recalculate_period(hints.employeeId, row.company_id, hints.dateYmd, hints.dateYmd));
  }
  if (needsGovernance && hints?.action !== 'manual_saida' && hints?.repPunchLogId) {
    pushGovernanceUpdate(ctx, () =>
      runRepGovernanceAfterReconciliationAction(client, row.company_id, {
        repPunchLogId: hints.repPunchLogId!,
        employeeId: hints.employeeId,
        dateYmd: hints.dateYmd,
        reviewedBy: hints.reviewedBy,
        action: hints.action === 'ignore' ? 'ignore' : 'reconcile',
      }),
    );
  }

  const commit = await commitOperationalTransaction(client, ctx);
  if (commit.ok) {
    const emp = raw.recovery_meta?.rep_reconciliation?.employeeId;
    if (emp) {
      void refreshCurrentOperationalStateRpc(row.company_id, emp, {
        source: 'recovery',
        eventAt: new Date().toISOString(),
        force: true,
        correlationId: replayCorrelationId,
        client,
      });
    }
  }
  return { ok: commit.ok, commit, error: commit.ok ? undefined : commit.rollback.message };
}
