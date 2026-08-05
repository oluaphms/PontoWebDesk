/**
 * Auditoria pontual de coerência GEO + pipeline de monitoramento (logs para suporte).
 */

import { parseOperationalStatusEnum, type CurrentOperationalStateRow } from '../../services/currentOperationalState.service';
import type { MonitoringPipelineEmployeeRow } from '../../services/monitoring/monitoringGeoHardLock.service';
import { opLog } from '../../utils/operationalLogger';

export type RealtimeGeoAuditIssue = {
  code: string;
  employee_id: string;
  detail?: string;
};

export function auditRealtimeGeoConsistency(params: {
  companyId: string;
  usingCos: boolean;
  pipelineRows: MonitoringPipelineEmployeeRow[];
  cosByEmployee: Map<string, CurrentOperationalStateRow>;
}): { ok: boolean; issues: RealtimeGeoAuditIssue[] } {
  const issues: RealtimeGeoAuditIssue[] = [];
  const { companyId, usingCos, pipelineRows, cosByEmployee } = params;

  for (const row of pipelineRows) {
    if (row.geoLocationExpired === true && row.lat != null && row.lng != null) {
      issues.push({
        code: 'expired_flag_with_coordinates',
        employee_id: row.userId,
        detail: 'marker_should_be_hidden',
      });
    }

    if (row.lat != null && row.lng != null && row.geoConfidenceLevel === 'INVALID') {
      issues.push({
        code: 'invalid_confidence_with_coordinates',
        employee_id: row.userId,
      });
    }

    if (!usingCos) continue;
    const cos = cosByEmployee.get(row.userId);
    if (!cos) continue;
    const expected = parseOperationalStatusEnum(cos.operational_status);
    if (expected !== row.status) {
      issues.push({
        code: 'status_card_vs_cos',
        employee_id: row.userId,
        detail: `${expected} vs ${row.status}`,
      });
    }
  }

  if (issues.length > 0) {
    opLog.warn('GEO CONSISTENCY AUDIT', { company_id: companyId, count: issues.length, issues });
  } else {
    opLog.diag('GEO CONSISTENCY AUDIT', { company_id: companyId, ok: true, rows: pipelineRows.length });
  }

  return { ok: issues.length === 0, issues };
}
