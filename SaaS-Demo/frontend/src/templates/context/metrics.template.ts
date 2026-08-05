import { recordOperationalMetric } from '../../domain/operational/metrics';

export function metric__CONTEXT__(value: number): void {
  recordOperationalMetric('rpc_latency_ms', value, { source: '__CONTEXT__', operation_type: '__CONTEXT__' });
}
