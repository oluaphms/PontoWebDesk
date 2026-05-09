/**
 * Entre dois fetches: se o checksum do snapshot GEO mudar, invalida caches e força refresh do monitoramento.
 */

import type { CurrentOperationalStateRow } from '../currentOperationalState.service';
import type { LiveEmployeeLocationRow } from '../liveEmployeeLocation.service';
import { geoSnapshotChecksumChanged } from '../geolocation/geoSnapshotChecksum';
import { invalidateOperationalGeoCaches } from '../queryCache';
import { OperationalIncidentCenter } from '../../domain/operational/geo/operationalGeoIncidentCenter';
import { reportDeviceOperationalReputationEvent } from '../deviceOperationalReputation.service';
import { operationalReliabilitySLO } from '../../domain/operational/reliability/operationalReliabilitySLO';
import { reportGeoCircuitSignal } from '../../domain/operational/geo/geoOperationalCircuitBreaker';
import { operationalBusEmit } from '../../domain/operational/bus/operationalEventBus';

const cosPrev = new Map<string, string>();
const livePrev = new Map<string, string>();

export function trackGeoSnapshotChecksumDrift(companyId: string, cos: CurrentOperationalStateRow[], live: LiveEmployeeLocationRow[]): void {
  let changed = false;
  const changedEmployees = new Set<string>();

  for (const r of cos) {
    const key = `${companyId}:${r.employee_id}`;
    const h = String(r.geo_snapshot_checksum ?? '').trim();
    if (!h) continue;
    const prev = cosPrev.get(key);
    if (prev && geoSnapshotChecksumChanged(prev, h)) {
      changed = true;
      changedEmployees.add(r.employee_id);
    }
    cosPrev.set(key, h);
  }

  for (const r of live) {
    const key = `${companyId}:${r.employee_id}:live`;
    const h = String(r.geo_snapshot_checksum ?? '').trim();
    if (!h) continue;
    const prev = livePrev.get(key);
    if (prev && geoSnapshotChecksumChanged(prev, h)) {
      changed = true;
      changedEmployees.add(r.employee_id);
    }
    livePrev.set(key, h);
  }

  if (changed) {
    console.info('[GEO SNAPSHOT CHECKSUM CHANGED]', { company_id: companyId });
    operationalReliabilitySLO.recordDriftEventCount(changedEmployees.size);
    if (changedEmployees.size >= 4) {
      reportGeoCircuitSignal('drift_storm');
    }
    for (const employeeId of changedEmployees) {
      void reportDeviceOperationalReputationEvent({ companyId, employeeId, event: 'geo_drift_detected' });
    }
    OperationalIncidentCenter.record({
      code: 'geo_snapshot_checksum_drift',
      severity: 'INFO',
      companyId,
      detail: { source: 'trackGeoSnapshotChecksumDrift', employees: [...changedEmployees] },
    });
    operationalBusEmit('geo:monitoring_refresh', { companyId, kind: 'checksum_drift' });
    invalidateOperationalGeoCaches('geo_snapshot_checksum_drift');
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('smartponto:force-monitoring-refresh', { detail: { companyId } }));
    }
  }
}
