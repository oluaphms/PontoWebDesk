/**
 * Códigos de incidente operacional alinhados ao motor / central.
 * Novos casos devem ser adicionados aqui (sem strings soltas fora do domínio).
 */
export const OperationalIncidentCode = {
  DUPLICATE_DAY_RECORDS: 'duplicate_day_records',
  MOTOR_PUNCH_MISMATCH: 'motor_punch_mismatch',
  PROCESSING_FAILURE: 'processing_failure',
  INVALID_EMPLOYEE_REFERENCE: 'invalid_employee_reference',
  REP_GOVERNANCE: 'REP_GOVERNANCE',
  REP_OPS_CENTER: 'rep_ops_center_review',
  NO_OPERATIONAL_INCIDENT: 'no_operational_incident',
} as const;

export type OperationalIncidentCode =
  (typeof OperationalIncidentCode)[keyof typeof OperationalIncidentCode];
