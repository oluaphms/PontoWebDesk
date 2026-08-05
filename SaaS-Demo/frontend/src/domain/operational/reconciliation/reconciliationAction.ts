/** Acções explícitas da reconciliação assistida REP (sem auto-promote). */
export const ReconciliationAction = {
  MARK_INVESTIGATING: 'mark_investigating',
  RECONCILE_AS_SAIDA: 'reconcile_as_saida',
  IGNORE_WITH_REASON: 'ignore_with_reason',
  MANUAL_SAIDA: 'manual_saida',
  RETRY_PROMOTE: 'retry_promote',
} as const;

export type ReconciliationAction = (typeof ReconciliationAction)[keyof typeof ReconciliationAction];
