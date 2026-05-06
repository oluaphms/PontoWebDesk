/**
 * Tipos de evento da timeline operacional — única fonte de constantes (sem strings mágicas).
 */

export const TimeAttendanceTimelineEventType = {
  REP_PUNCH_RECEIVED: 'REP_PUNCH_RECEIVED',
  REP_MATCH_SUCCESS: 'REP_MATCH_SUCCESS',
  REP_MATCH_AMBIGUOUS: 'REP_MATCH_AMBIGUOUS',
  REP_MATCH_FAILED: 'REP_MATCH_FAILED',
  REP_PROMOTED: 'REP_PROMOTED',
  TIME_RECORD_CREATED: 'TIME_RECORD_CREATED',
  TIMESHEET_RECALCULATED: 'TIMESHEET_RECALCULATED',
  TIMESHEET_REPLAY: 'TIMESHEET_REPLAY',
  TIMESHEET_FALLBACK_APPLIED: 'TIMESHEET_FALLBACK_APPLIED',
  TIMESHEET_CLOSED: 'TIMESHEET_CLOSED',
  TIMESHEET_REOPENED: 'TIMESHEET_REOPENED',
  MANUAL_ADJUSTMENT: 'MANUAL_ADJUSTMENT',
  MANUAL_REVIEW: 'MANUAL_REVIEW',
  INCIDENT_DETECTED: 'INCIDENT_DETECTED',
  INCIDENT_RESOLVED: 'INCIDENT_RESOLVED',
  AUTO_FIX_TRIGGERED: 'AUTO_FIX_TRIGGERED',
  AUTO_FIX_SKIPPED: 'AUTO_FIX_SKIPPED',
  AUTO_FIX_FAILED: 'AUTO_FIX_FAILED',
} as const;

export type TimeAttendanceTimelineEventTypeKey = keyof typeof TimeAttendanceTimelineEventType;
export type TimeAttendanceTimelineEventTypeValue =
  (typeof TimeAttendanceTimelineEventType)[TimeAttendanceTimelineEventTypeKey];

export const TimeAttendanceTimelineSeverity = {
  info: 'info',
  low: 'low',
  medium: 'medium',
  high: 'high',
  critical: 'critical',
} as const;

export type TimeAttendanceTimelineSeverityValue =
  (typeof TimeAttendanceTimelineSeverity)[keyof typeof TimeAttendanceTimelineSeverity];

/** Catálogo para filtros de UI */
export const TIME_ATTENDANCE_TIMELINE_EVENT_TYPES_LIST: TimeAttendanceTimelineEventTypeValue[] =
  Object.values(TimeAttendanceTimelineEventType);
