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

/** Prefixos: [OPERATIONAL_EVENT], [OPERATIONAL_RULE], … — incluir `correlation_id` nos dados quando existir. */
export function operationalLog(channel: OperationalLogChannel, data: Record<string, unknown>): void {
  console.info(`[OPERATIONAL_${channel}]`, data);
}
