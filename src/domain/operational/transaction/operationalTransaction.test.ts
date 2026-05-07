import { describe, expect, it, vi, beforeEach } from 'vitest';
import { TimeAttendanceTimelineEventType } from '../../../services/timeAttendanceTimeline.constants';
import { TimeAttendanceTimelineSeverity } from '../../../services/timeAttendanceTimeline.constants';
import { appendTimeAttendanceTimelineEventOrThrow } from '../../../services/timeAttendanceTimeline.service';
import { insertIncidentResolutionOrThrow } from '../../../services/timeAttendanceIncidentReviews.service';
import { emitOperationalEvent } from '../timeline/operationalEventBus';
import { beginOperationalTransaction, commitOperationalTransaction } from './operationalTransaction';
import { emitOperationalIncident } from './operationalUnitOfWork';
import type { OperationalTransactionContext } from './operationalTransactionContext';

vi.mock('../../../services/timeAttendanceTimeline.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../services/timeAttendanceTimeline.service')>();
  return { ...actual, appendTimeAttendanceTimelineEventOrThrow: vi.fn().mockResolvedValue(undefined) };
});

vi.mock('../../../services/timeAttendanceIncidentReviews.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../services/timeAttendanceIncidentReviews.service')>();
  return { ...actual, insertIncidentResolutionOrThrow: vi.fn().mockResolvedValue(undefined) };
});

const mockClient = {} as import('@supabase/supabase-js').SupabaseClient;

function minimalCtx(): OperationalTransactionContext {
  return beginOperationalTransaction({
    actor: 'user-1',
    company_id: 'co-1',
    source: 'test',
    supabaseClient: mockClient,
  });
}

describe('commitOperationalTransaction', () => {
  beforeEach(() => {
    vi.mocked(appendTimeAttendanceTimelineEventOrThrow).mockClear().mockResolvedValue(undefined);
    vi.mocked(insertIncidentResolutionOrThrow).mockClear().mockResolvedValue(undefined);
  });

  it('duplicate commit é idempotente', async () => {
    const ctx = minimalCtx();
    await emitOperationalEvent({
      supabaseClient: mockClient,
      companyId: 'co-1',
      employeeId: 'e1',
      dateYmd: '2026-05-01',
      eventType: TimeAttendanceTimelineEventType.REP_PROMOTE_RETRIED,
      eventSeverity: TimeAttendanceTimelineSeverity.info,
      correlationId: ctx.correlation_id,
      actor: 'user-1',
      source: 'test',
      sourceReferenceId: 'ref-1',
      transactionContext: ctx,
      idempotencyKey: 'dup:1',
    });
    const a = await commitOperationalTransaction(mockClient, ctx);
    expect(a.ok).toBe(true);
    const b = await commitOperationalTransaction(mockClient, ctx);
    expect(b.ok).toBe(true);
    if (b.ok) expect(b.duplicate).toBe(true);
    expect(appendTimeAttendanceTimelineEventOrThrow).toHaveBeenCalledTimes(1);
  });

  it('falha na timeline após review: rollback lógico com estágio', async () => {
    vi.mocked(appendTimeAttendanceTimelineEventOrThrow).mockRejectedValueOnce(new Error('timeline down'));

    const ctx = minimalCtx();
    emitOperationalIncident(ctx, {
      companyId: 'co-1',
      employeeId: 'e1',
      dateYmd: '2026-05-01',
      incidentCode: 'rep_x:1',
      resolvedBy: 'user-1',
      resolutionNote: 'ok',
      incidentPayload: { category: 'REP_RECONCILIATION' },
    });

    await emitOperationalEvent({
      supabaseClient: mockClient,
      companyId: 'co-1',
      employeeId: 'e1',
      dateYmd: '2026-05-01',
      eventType: TimeAttendanceTimelineEventType.REP_SEQUENCE_RECONCILED,
      eventSeverity: TimeAttendanceTimelineSeverity.medium,
      correlationId: ctx.correlation_id,
      actor: 'user-1',
      source: 'test',
      sourceReferenceId: 'log-1',
      transactionContext: ctx,
      idempotencyKey: 'seq:1',
    });

    const res = await commitOperationalTransaction(mockClient, ctx);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.rollback.failed_stage).toBe('timeline');
      expect(res.rollback.transaction_failed).toBe(true);
      expect(res.rollback.persisted_entities.some((p) => p.startsWith('incident_review:'))).toBe(true);
    }
    expect(insertIncidentResolutionOrThrow).toHaveBeenCalledTimes(1);
  });

  it('falha em incidente: nenhuma timeline persistida', async () => {
    vi.mocked(insertIncidentResolutionOrThrow).mockRejectedValueOnce(new Error('incident fail'));

    const ctx = minimalCtx();
    emitOperationalIncident(ctx, {
      companyId: 'co-1',
      employeeId: 'e1',
      dateYmd: '2026-05-01',
      incidentCode: 'bad:1',
      resolvedBy: 'user-1',
      incidentPayload: {},
    });

    const res = await commitOperationalTransaction(mockClient, ctx);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.rollback.failed_stage).toBe('incident_review');
    expect(appendTimeAttendanceTimelineEventOrThrow).not.toHaveBeenCalled();
  });

  it('emitOperationalEvent com mesma idempotencyKey não duplica buffer', async () => {
    const ctx = minimalCtx();
    const base = {
      supabaseClient: mockClient,
      companyId: 'co-1',
      employeeId: 'e1',
      dateYmd: '2026-05-01',
      eventType: TimeAttendanceTimelineEventType.REP_PROMOTE_RETRIED,
      eventSeverity: TimeAttendanceTimelineSeverity.info,
      correlationId: ctx.correlation_id,
      actor: 'user-1',
      source: 'test',
      transactionContext: ctx,
      idempotencyKey: 'same',
    } as const;

    await emitOperationalEvent({ ...base, sourceReferenceId: 'a' });
    await emitOperationalEvent({ ...base, sourceReferenceId: 'b' });
    expect(ctx.timeline_buffer.length).toBe(1);
  });

  it('emitOperationalIncident idempotente (pacote incidente + timeline)', async () => {
    const ctx = minimalCtx();
    const review = {
      companyId: 'co-1',
      employeeId: 'e1',
      dateYmd: '2026-05-01',
      incidentCode: 'pkg:1',
      resolvedBy: 'user-1',
      incidentPayload: {},
    };
    emitOperationalIncident(ctx, review);
    emitOperationalIncident(ctx, review);
    expect(ctx.incident_buffer.length).toBe(1);
    expect(ctx.timeline_buffer.filter((t) => t.eventType === TimeAttendanceTimelineEventType.INCIDENT_RESOLVED).length).toBe(
      1,
    );
  });
});
