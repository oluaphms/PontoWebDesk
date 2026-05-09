/**
 * Centro de incidentes GEO / realtime (telemetria e rastreio).
 * Distinto da central de incidentes de folha (`OperationalIncidents` UI).
 */

export type OperationalGeoIncidentSeverity = 'INFO' | 'WARNING' | 'CRITICAL';

export type OperationalGeoIncidentPayload = {
  code: string;
  severity: OperationalGeoIncidentSeverity;
  companyId?: string;
  employeeId?: string;
  detail?: Record<string, unknown>;
};

/** Alias solicitado na especificação de produção. */
export const OperationalIncidentCenter = {
  record(incident: OperationalGeoIncidentPayload): void {
    const base = {
      code: incident.code,
      severity: incident.severity,
      company_id: incident.companyId,
      employee_id: incident.employeeId,
      ...incident.detail,
    };
    if (incident.severity === 'CRITICAL') {
      console.error('[OPERATIONAL GEO INCIDENT]', base);
    } else if (incident.severity === 'WARNING') {
      console.warn('[OPERATIONAL GEO INCIDENT]', base);
    } else {
      console.info('[OPERATIONAL GEO INCIDENT]', base);
    }
  },
};
