/** Códigos estáveis de violação de integridade operacional (persistidos em logs / UI). */
export const GovernanceViolationCode = {
  A_TIME_RECORD_WITH_NON_TERMINAL_STATUS: 'A_time_record_with_non_terminal_status',
  B_RECONCILED_WITHOUT_TIME_RECORD: 'B_reconciled_without_time_record',
  C_IGNORED_WITHOUT_NOTE: 'C_ignored_without_note',
  D_RECOVERED_EVENT_WITHOUT_TIME_RECORD: 'D_recovered_event_without_time_record',
  E_ATTEMPTS_OVER_CAP_WITHOUT_WAITING_REVIEW: 'E_attempts_over_cap_without_waiting_review',
  TL_RECONCILED_MISSING_TIMELINE: 'TL_reconciled_missing_timeline',
  TL_IGNORED_MISSING_TIMELINE: 'TL_ignored_missing_timeline',
} as const;

export type GovernanceViolationCode =
  (typeof GovernanceViolationCode)[keyof typeof GovernanceViolationCode];
