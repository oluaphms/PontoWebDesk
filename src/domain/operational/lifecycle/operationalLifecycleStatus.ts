/** Estados do ciclo de vida operacional em `rep_punch_logs.operational_resolution_status`. */
export const OperationalLifecycleStatus = {
  pending: 'pending',
  investigating: 'investigating',
  waiting_review: 'waiting_review',
  reconciled: 'reconciled',
  ignored: 'ignored',
  expired: 'expired',
} as const;

export type OperationalLifecycleStatusValue =
  (typeof OperationalLifecycleStatus)[keyof typeof OperationalLifecycleStatus];
