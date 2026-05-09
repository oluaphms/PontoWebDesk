import { scheduleOperationalLegalAudit } from '../operationalLegalAuditTrail.service';

export function appendGeoLegalAuditTrail(input: {
  companyId?: string | null;
  employeeId: string;
  source: string;
  checksum?: string | null;
  previousPosition?: { latitude: number; longitude: number } | null;
  nextPosition: { latitude: number; longitude: number };
  accuracy: number | null;
  operationalTimestamp: string;
  deviceReputation?: string | null;
  geoRisk?: string | null;
  consensusSource?: string | null;
  lineage?: string | null;
}): void {
  if (!input.companyId) return;
  scheduleOperationalLegalAudit({
    companyId: input.companyId,
    actorId: input.employeeId,
    action: 'geo_position_change',
    source: 'geoLegalAuditTrail',
    payloadBefore: {
      previous_position: input.previousPosition ?? null,
    },
    payloadAfter: {
      source: input.source,
      checksum: input.checksum ?? null,
      next_position: input.nextPosition,
      accuracy: input.accuracy,
      operational_timestamp: input.operationalTimestamp,
      device_reputation: input.deviceReputation ?? null,
      geo_risk: input.geoRisk ?? null,
      consensus_source: input.consensusSource ?? null,
      lineage: input.lineage ?? null,
    },
  });
}

