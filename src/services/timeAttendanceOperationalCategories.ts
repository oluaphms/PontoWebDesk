/**
 * Taxonomia da central de incidentes (UI) — derivada do motor `deriveOperationalIncident`, sem duplicar heurística.
 */

import type { OperationalIncident } from './timeAttendanceIncidentEngine';

export type OperationalIncidentBucket =
  | 'REP'
  | 'REP_PROMOTE'
  | 'MATCH'
  | 'TIMESHEET'
  | 'SCHEDULE'
  | 'REPLAY'
  | 'DRIFT'
  | 'INTEGRATION'
  | 'CLOSURE'
  | 'AUDIT';

export function operationalIncidentBucket(inc: OperationalIncident): OperationalIncidentBucket {
  if (inc.incident_code === 'period_closed') return 'CLOSURE';
  if (inc.incident_code.includes('drift')) return 'DRIFT';
  switch (inc.category) {
    case 'punch':
      return 'MATCH';
    case 'schedule':
      return 'SCHEDULE';
    case 'replay':
      return 'REPLAY';
    case 'integration':
      return 'INTEGRATION';
    case 'manual':
      return 'AUDIT';
    case 'engine':
    default:
      return 'TIMESHEET';
  }
}
