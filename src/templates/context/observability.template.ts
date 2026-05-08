import { operationalLog } from '../../domain/operational/observability';

export function log__CONTEXT__Event(): void {
  operationalLog('EVENT', { source: '__CONTEXT__', event_type: '__CONTEXT___event' });
}
