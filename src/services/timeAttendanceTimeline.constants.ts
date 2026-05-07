/**
 * Tipos de evento da timeline operacional — única fonte de constantes (sem strings mágicas).
 */

export const TimeAttendanceTimelineEventType = {
  REP_PUNCH_RECEIVED: 'REP_PUNCH_RECEIVED',
  REP_MATCH_SUCCESS: 'REP_MATCH_SUCCESS',
  REP_MATCH_AMBIGUOUS: 'REP_MATCH_AMBIGUOUS',
  REP_MATCH_FAILED: 'REP_MATCH_FAILED',
  REP_PROMOTED: 'REP_PROMOTED',
  REP_PROMOTE_FAILED: 'REP_PROMOTE_FAILED',
  REP_PROMOTE_RETRIED: 'REP_PROMOTE_RETRIED',
  REP_PROMOTE_RECOVERED: 'REP_PROMOTE_RECOVERED',
  /** RH vinculou batida REP inválida como saída (ou fluxo equivalente) sem alterar linha AFD original. */
  REP_SEQUENCE_RECONCILED: 'REP_SEQUENCE_RECONCILED',
  /** Batida REP marcada como ignorada pelo RH (motivo obrigatório em payload). */
  REP_PUNCH_IGNORED: 'REP_PUNCH_IGNORED',
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
  /** Recuperação operacional (DLQ / worker) — auditável, sem auto-promote. */
  OPERATIONAL_RECOVERY_STARTED: 'OPERATIONAL_RECOVERY_STARTED',
  OPERATIONAL_RECOVERY_RETRY: 'OPERATIONAL_RECOVERY_RETRY',
  OPERATIONAL_RECOVERY_SUCCEEDED: 'OPERATIONAL_RECOVERY_SUCCEEDED',
  OPERATIONAL_RECOVERY_FAILED: 'OPERATIONAL_RECOVERY_FAILED',
  OPERATIONAL_ORPHAN_DETECTED: 'OPERATIONAL_ORPHAN_DETECTED',
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
