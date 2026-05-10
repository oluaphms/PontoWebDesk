/**
 * Garante que a UI derivada do pipeline bate com `current_operational_state` quando esta é a fonte ativa.
 */

import { parseOperationalStatusEnum, type CurrentOperationalStateRow } from '../../services/currentOperationalState.service';
import type { MonitoringPipelineEmployeeRow } from '../../services/monitoring/monitoringGeoHardLock.service';
import { opLog } from '../../utils/operationalLogger';

export function assertOperationalStateConsistency(params: {
  companyId: string;
  usingCos: boolean;
  cosByEmployee: Map<string, CurrentOperationalStateRow>;
  pipelineRows: MonitoringPipelineEmployeeRow[];
}): { ok: boolean; driftCount: number } {
  const { companyId, usingCos, cosByEmployee, pipelineRows } = params;
  if (!usingCos) {
    opLog.diag('STATE CONSISTENCY CHECK', { company_id: companyId, skipped: true, reason: 'no_cos_snapshot' });
    return { ok: true, driftCount: 0 };
  }

  let driftCount = 0;
  for (const row of pipelineRows) {
    const cos = cosByEmployee.get(row.userId);
    if (!cos) continue;
    const expected = parseOperationalStatusEnum(cos.operational_status);
    if (expected !== row.status) {
      driftCount += 1;
      opLog.warn('STATE DRIFT DETECTED', {
        company_id: companyId,
        employee_id: row.userId,
        cos_status: expected,
        pipeline_status: row.status,
      });
    }
  }

  const ok = driftCount === 0;
  opLog.diag('STATE CONSISTENCY CHECK', { company_id: companyId, ok, driftCount });
  return { ok, driftCount };
}
