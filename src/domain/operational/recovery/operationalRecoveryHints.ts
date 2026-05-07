/** Metadados serializáveis para replay pós-falha (sem closures). */
export type OperationalRecoveryTransactionHints = {
  rep_reconciliation?: {
    repPunchLogId?: string | null;
    employeeId: string;
    dateYmd: string;
    reviewedBy: string;
    action: 'reconcile' | 'ignore' | 'manual_saida';
  };
};
