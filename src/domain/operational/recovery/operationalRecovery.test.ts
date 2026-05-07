import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { TimeAttendanceTimelineEventType } from '../../../services/timeAttendanceTimeline.constants';
import { TimeAttendanceTimelineSeverity } from '../../../services/timeAttendanceTimeline.constants';
import { buildReplayBuffersFromPayload } from './operationalReplayCoordinator';
import { failedStageToRecoveryKind, getRecoveryPolicy } from './operationalRecoveryPolicies';
import type { OperationalDeadLetterPayloadV1 } from './operationalDeadLetterQueue';

const insertOperationalDeadLetterMock = vi.hoisted(() => vi.fn().mockResolvedValue({ ok: true }));

vi.mock('../../../services/operationalDeadLetter.service', () => ({
  insertOperationalDeadLetter: insertOperationalDeadLetterMock,
}));

describe('operationalRecoveryPolicies', () => {
  it('governance_failure não é retryable por política', () => {
    const p = getRecoveryPolicy(failedStageToRecoveryKind('governance'));
    expect(p.retryable).toBe(false);
    expect(p.escalation_level).toBeGreaterThanOrEqual(2);
  });

  it('timeline_failure mapeia estágio', () => {
    expect(failedStageToRecoveryKind('timeline')).toBe('timeline_failure');
  });
});

describe('buildReplayBuffersFromPayload', () => {
  const client = {} as SupabaseClient;

  it('replay parcial: remove incidentes e timeline já persistidos', () => {
    const payload: OperationalDeadLetterPayloadV1 = {
      version: 1,
      incidents: [
        {
          companyId: 'c1',
          incidentCode: 'a',
          employeeId: 'e1',
          dateYmd: '2026-05-01',
          resolvedBy: 'u1',
        },
        {
          companyId: 'c1',
          incidentCode: 'b',
          employeeId: 'e1',
          dateYmd: '2026-05-01',
          resolvedBy: 'u1',
        },
      ],
      timeline: [
        {
          companyId: 'c1',
          employeeId: 'e1',
          dateYmd: '2026-05-01',
          eventType: TimeAttendanceTimelineEventType.INCIDENT_RESOLVED,
          eventSeverity: TimeAttendanceTimelineSeverity.low,
          correlationId: 'old',
          actor: 'u1',
          source: 'operational_incidents',
          sourceReferenceId: 'a',
        },
        {
          companyId: 'c1',
          employeeId: 'e1',
          dateYmd: '2026-05-01',
          eventType: TimeAttendanceTimelineEventType.REP_SEQUENCE_RECONCILED,
          eventSeverity: TimeAttendanceTimelineSeverity.medium,
          correlationId: 'old',
          actor: 'u1',
          source: 'test',
          sourceReferenceId: 'x',
        },
      ],
      recovery_meta: null,
      rollback: {
        persisted_entities: ['incident_review:a', 'timeline:INCIDENT_RESOLVED:0'],
        pending_entities: [],
      },
      source: 'test',
      actor: 'u1',
      started_at: '2026-05-01T00:00:00.000Z',
      idempotency_keys: [],
    };

    const replayCorr = '00000000-0000-4000-8000-000000000001';
    const { incidents, timeline, needsHealth, needsGovernance } = buildReplayBuffersFromPayload(
      client,
      payload,
      replayCorr,
    );
    expect(incidents.map((i) => i.incidentCode)).toEqual(['b']);
    expect(timeline.length).toBe(1);
    expect(timeline[0].eventType).toBe(TimeAttendanceTimelineEventType.REP_SEQUENCE_RECONCILED);
    expect(timeline[0].correlationId).toBe(replayCorr);
    expect(needsHealth).toBe(true);
    expect(needsGovernance).toBe(true);
  });
});

describe('recordOperationalDeadLetterFromFailedCommit', () => {
  it('grava DLQ via serviço', async () => {
    insertOperationalDeadLetterMock.mockClear();
    const { recordOperationalDeadLetterFromFailedCommit } = await import('./operationalRecoveryEngine');
    const client = {} as SupabaseClient;
    const ctx = {
      operation_id: 'op-1',
      correlation_id: 'cor-1',
      actor: 'a',
      company_id: 'co',
      source: 'src',
      started_at: 't',
      supabaseClient: client,
      event_buffer: [],
      incident_buffer: [],
      timeline_buffer: [],
      health_updates: [],
      governance_updates: [],
      reliability_updates: [],
      idempotencyKeys: new Set<string>(),
      committed: false,
      failed: false,
      failed_stage: null,
      recovery_meta: null,
    } as import('../transaction/operationalTransactionContext').OperationalTransactionContext;

    await recordOperationalDeadLetterFromFailedCommit(
      client,
      ctx,
      {
        transaction_failed: true,
        failed_stage: 'timeline',
        persisted_entities: [],
        pending_entities: ['t'],
        retryable: true,
        message: 'x',
      },
      'timeline',
      true,
    );
    expect(insertOperationalDeadLetterMock).toHaveBeenCalled();
  });
});
