import type { TimelineEventTypeValue } from './timelineEventType';
import type { TimeAttendanceTimelineSeverityValue } from '../../../services/timeAttendanceTimeline.constants';

/** Metadados mínimos para event sourcing parcial e auditoria. */
export type OperationalTimelineEnvelope = {
  eventType: TimelineEventTypeValue;
  eventSeverity?: TimeAttendanceTimelineSeverityValue;
  correlation_id: string;
  actor: string | null;
  source: string;
  before_state?: unknown;
  after_state?: unknown;
  metadata?: Record<string, unknown>;
  created_at?: string;
};

export function buildOperationalTimelinePayload(env: Omit<OperationalTimelineEnvelope, 'eventType' | 'eventSeverity' | 'created_at'>): Record<string, unknown> {
  return {
    correlation_id: env.correlation_id,
    actor: env.actor,
    source: env.source,
    before_state: env.before_state,
    after_state: env.after_state,
    ...(env.metadata ?? {}),
  };
}
