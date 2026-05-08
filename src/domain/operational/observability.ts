export type OperationalLogChannel =
  | 'EVENT'
  | 'RULE'
  | 'INCIDENT'
  | 'HEALTH'
  | 'TIMELINE'
  | 'GOVERNANCE'
  | 'TRANSACTION'
  | 'RECOVERY'
  | 'DLQ'
  | 'REPLAY'
  | 'ORPHAN';

type StructuredOperationalLog = {
  company_id?: string | null;
  employee_id?: string | null;
  correlation_id?: string | null;
  operation_id?: string | null;
  source?: string;
  severity?: 'info' | 'warning' | 'error' | 'critical';
  lifecycle?: string;
  event_type?: string;
  created_at?: string;
} & Record<string, unknown>;

/** Prefixos: [OPERATIONAL_EVENT], [OPERATIONAL_RULE], … com envelope estruturado mínimo. */
export function operationalLog(channel: OperationalLogChannel, data: StructuredOperationalLog): void {
  const envelope: StructuredOperationalLog = {
    company_id: (data.company_id as string | null | undefined) ?? null,
    employee_id: (data.employee_id as string | null | undefined) ?? null,
    correlation_id: (data.correlation_id as string | null | undefined) ?? null,
    operation_id: (data.operation_id as string | null | undefined) ?? null,
    source: String(data.source ?? `operational.${channel.toLowerCase()}`),
    severity: (data.severity as StructuredOperationalLog['severity']) ?? 'info',
    lifecycle: String(data.lifecycle ?? 'runtime'),
    event_type: String(data.event_type ?? `operational_${channel.toLowerCase()}`),
    created_at: String(data.created_at ?? new Date().toISOString()),
    ...data,
  };
  console.info(`[OPERATIONAL_${channel}]`, envelope);
}
