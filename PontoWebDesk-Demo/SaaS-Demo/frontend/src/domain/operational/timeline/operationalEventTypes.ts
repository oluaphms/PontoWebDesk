import type { SupabaseClient } from '@supabase/supabase-js';
import type { TimeAttendanceTimelineSeverityValue } from '../../../services/timeAttendanceTimeline.constants';
import type { TimelineEventTypeValue } from './timelineEventType';

/** Campos persistidos na timeline (sem contexto transacional — usado nos buffers). */
export type EmitOperationalEventBase = {
  supabaseClient: SupabaseClient;
  companyId: string;
  employeeId?: string | null;
  dateYmd?: string | null;
  eventType: TimelineEventTypeValue;
  eventSeverity?: TimeAttendanceTimelineSeverityValue;
  correlationId: string;
  actor: string | null;
  source: string;
  sourceReferenceId?: string | null;
  beforeState?: unknown;
  afterState?: unknown;
  metadata?: Record<string, unknown>;
  createdBy?: string | null;
};
