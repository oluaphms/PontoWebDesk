import { invalidateOperationalGeoCaches, invalidateRealtimeGeoEntity } from '../queryCache';
import { operationalBusEmit } from '../../domain/operational/bus/operationalEventBus';
import { openAutoOperationalIncident } from '../operationalAutoIncident.service';
import { runGeoSelfHeal } from './geoSelfHeal.service';

export function detectAndHandleGhostLocation(input: {
  companyId?: string | null;
  employeeId: string;
  hasRealtimeUpdate: boolean;
  heartbeatAgeMs?: number | null;
  positionAgeMs?: number | null;
  isOffline?: boolean;
  isLoggedOut?: boolean;
}): boolean {
  const heartbeatLost = (input.heartbeatAgeMs ?? Number.POSITIVE_INFINITY) > 5 * 60_000;
  const stalePosition = (input.positionAgeMs ?? Number.POSITIVE_INFINITY) > 120_000;
  const ghost = input.isLoggedOut || input.isOffline || heartbeatLost || stalePosition || !input.hasRealtimeUpdate;
  if (!ghost) return false;
  console.warn('[GHOST LOCATION DETECTED]', {
    employee_id: input.employeeId,
    heartbeat_age_ms: input.heartbeatAgeMs ?? null,
    position_age_ms: input.positionAgeMs ?? null,
    offline: input.isOffline ?? false,
    logged_out: input.isLoggedOut ?? false,
  });
  invalidateRealtimeGeoEntity(input.employeeId, input.companyId ?? undefined);
  invalidateOperationalGeoCaches('ghost_location_detected');
  operationalBusEmit('geo:monitoring_refresh', {
    companyId: input.companyId ?? null,
    employeeId: input.employeeId,
    kind: 'ghost_location',
  });
  if (input.companyId) {
    openAutoOperationalIncident({
      companyId: input.companyId,
      employeeId: input.employeeId,
      key: `ghost_location:${input.employeeId}`,
      summary: 'Ghost location detected',
      details: { heartbeat_age_ms: input.heartbeatAgeMs ?? null, position_age_ms: input.positionAgeMs ?? null },
    });
  }
  void runGeoSelfHeal({
    companyId: input.companyId ?? null,
    employeeId: input.employeeId,
    reason: 'ghost_location',
  });
  console.warn('[GHOST LOCATION REMOVED]', { employee_id: input.employeeId });
  return true;
}

