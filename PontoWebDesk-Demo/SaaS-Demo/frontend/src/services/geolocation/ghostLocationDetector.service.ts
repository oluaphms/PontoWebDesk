import { invalidateOperationalGeoCaches, invalidateRealtimeGeoEntity } from '../queryCache';
import { operationalBusEmit } from '../../domain/operational/bus/operationalEventBus';
import { openAutoOperationalIncident } from '../operationalAutoIncident.service';
import { runGeoSelfHeal } from './geoSelfHeal.service';
import { opLog } from '../../utils/operationalLogger';

/**
 * Cooldown por entidade (companyId:employeeId).
 *
 * Sem cooldown, o detector entra em loop: pipeline render → detect → invalidate cache
 * → render novamente → detect novamente → ... Apenas com isso filtramos ~70% do spam.
 */
const GHOST_DETECTION_COOLDOWN_MS = 120_000;
const GHOST_DETECTION_MAX_ENTRIES = 1000;
const lastGhostDetection = new Map<string, number>();

function ghostKey(companyId: string | null | undefined, employeeId: string): string {
  return `${companyId ?? 'no_company'}:${employeeId}`;
}

function pruneGhostDetectionMap(now: number): void {
  if (lastGhostDetection.size < GHOST_DETECTION_MAX_ENTRIES) return;
  const cutoff = now - GHOST_DETECTION_COOLDOWN_MS;
  for (const [k, ts] of lastGhostDetection) {
    if (ts < cutoff) lastGhostDetection.delete(k);
  }
  if (lastGhostDetection.size >= GHOST_DETECTION_MAX_ENTRIES) {
    const firstKey = lastGhostDetection.keys().next().value;
    if (firstKey !== undefined) lastGhostDetection.delete(firstKey);
  }
}

export function __resetGhostDetectionCooldownForTests(): void {
  lastGhostDetection.clear();
}

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

  const key = ghostKey(input.companyId, input.employeeId);
  const now = Date.now();
  const last = lastGhostDetection.get(key) ?? 0;
  if (now - last < GHOST_DETECTION_COOLDOWN_MS) {
    return false;
  }
  pruneGhostDetectionMap(now);
  lastGhostDetection.set(key, now);

  opLog.warn('GHOST LOCATION DETECTED', {
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
  opLog.warn('GHOST LOCATION REMOVED', { employee_id: input.employeeId });
  return true;
}
