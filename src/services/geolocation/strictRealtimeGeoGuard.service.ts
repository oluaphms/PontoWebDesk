import { distanceMeters } from './geoDistance.service';
import { geoSnapshotChecksumChanged } from './geoSnapshotChecksum';
import { scheduleOperationalLegalAudit } from '../operationalLegalAuditTrail.service';
import { getOperationalFeatureFlag } from '../../config/operationalFeatureFlags';
import { openAutoOperationalIncident } from '../operationalAutoIncident.service';
import {
  assertOperationalRealtimeTimestamp,
  assertOperationalTemporalMonotonicity,
} from '../../utils/strictOperationalRealtimeClock';
import { runGeoSelfHeal } from './geoSelfHeal.service';

type StrictCandidate = {
  companyId?: string | null;
  employeeId: string;
  source: 'live_employee_location' | 'current_operational_state' | 'time_record';
  latitude: number;
  longitude: number;
  capturedAtMs: number;
  capturedAtIso: string;
  accuracy: number | null;
  speedMps?: number | null;
  stateVersion?: number;
  checksum?: string | null;
  lineageUpdatedAt?: string | null;
};

type StrictMemory = {
  capturedAtMs: number;
  stateVersion: number;
  checksum: string | null;
  latitude: number;
  longitude: number;
  lineageUpdatedAt: string | null;
};

const memoryByEmployee = new Map<string, StrictMemory>();
const MAX_STALE_LIVE_MS = 90_000;
const MAX_ACCURACY_M = 150;
const MAX_SPEED_MPS = 120 / 3.6;
const TELEPORT_M = 1000;
const TELEPORT_WINDOW_MS = 20_000;

export function validateStrictRealtimeGeoCandidate(
  candidate: StrictCandidate,
): { ok: boolean; reason?: string } {
  if (!getOperationalFeatureFlag('cosStrictMode', { companyId: candidate.companyId })) {
    return { ok: true };
  }
  const prev = memoryByEmployee.get(candidate.employeeId);
  const nowMs = Date.now();
  const strictTs = assertOperationalRealtimeTimestamp(candidate.capturedAtIso, nowMs);
  if (!strictTs.ok) {
    console.warn('[STRICT GEO TEMPORAL BLOCK]', {
      employee_id: candidate.employeeId,
      reason: 'strict_realtime_clock',
    });
    return { ok: false, reason: 'strict_realtime_clock' };
  }
  if (!assertOperationalTemporalMonotonicity(`${candidate.employeeId}:geo`, strictTs.instantMs!)) {
    console.warn('[STRICT GEO TEMPORAL BLOCK]', {
      employee_id: candidate.employeeId,
      reason: 'temporal_monotonicity_violation',
    });
    return { ok: false, reason: 'temporal_monotonicity_violation' };
  }

  const block = (reason: string): { ok: false; reason: string } => {
    console.warn('[STRICT GEO BLOCK]', {
      employee_id: candidate.employeeId,
      company_id: candidate.companyId,
      source: candidate.source,
      reason,
    });
    if (reason.includes('temporal') || reason.includes('captured_at')) {
      console.warn('[STRICT TEMPORAL REGRESSION]', {
        employee_id: candidate.employeeId,
        reason,
        captured_at: candidate.capturedAtIso,
      });
    }
    if (reason.includes('stale')) {
      console.warn('[STRICT STALE POSITION]', {
        employee_id: candidate.employeeId,
        reason,
      });
    }
    console.warn('[STRICT GEO INVALIDATED]', { employee_id: candidate.employeeId });

    if (candidate.companyId && getOperationalFeatureFlag('operationalIncidents', { companyId: candidate.companyId })) {
      openAutoOperationalIncident({
        companyId: candidate.companyId,
        employeeId: candidate.employeeId,
        key: `strict_geo:${candidate.employeeId}:${reason}`,
        summary: `Strict GEO blocked: ${reason}`,
        details: { source: candidate.source, captured_at: candidate.capturedAtIso },
      });
    }
    void runGeoSelfHeal({
      companyId: candidate.companyId ?? null,
      employeeId: candidate.employeeId,
      reason,
    });

    if (candidate.companyId) {
      scheduleOperationalLegalAudit({
        companyId: candidate.companyId,
        actorId: candidate.employeeId,
        action: 'strict_geo_block',
        source: 'strictRealtimeGeoGuard',
        payloadAfter: { reason, source: candidate.source, captured_at: candidate.capturedAtIso },
      });
    }
    return { ok: false, reason };
  };

  if (!candidate.lineageUpdatedAt) return block('missing_lineage_updated_at');
  if (candidate.accuracy != null && Number.isFinite(candidate.accuracy) && candidate.accuracy > MAX_ACCURACY_M) {
    return block('accuracy_gt_150m');
  }
  if (candidate.speedMps != null && Number.isFinite(candidate.speedMps) && candidate.speedMps > MAX_SPEED_MPS) {
    return block('speed_gt_120kmh');
  }

  if (candidate.source === 'live_employee_location' && nowMs - candidate.capturedAtMs > MAX_STALE_LIVE_MS) {
    return block('live_stale_gt_90s');
  }

  if (prev) {
    if (candidate.capturedAtMs < prev.capturedAtMs) {
      console.warn('[STRICT GEO TEMPORAL BLOCK]', { employee_id: candidate.employeeId, reason: 'captured_at_regression' });
      return block('captured_at_regression');
    }
    if ((candidate.stateVersion ?? 0) < prev.stateVersion) {
      console.warn('[STRICT GEO VERSION BLOCK]', { employee_id: candidate.employeeId, reason: 'state_version_regression' });
      return block('state_version_regression');
    }
    if (candidate.checksum && prev.checksum && geoSnapshotChecksumChanged(prev.checksum, candidate.checksum)) {
      // checksum diferente é esperado; bloqueia apenas se evento temporal regrediu junto
      if (candidate.capturedAtMs <= prev.capturedAtMs) {
        console.warn('[STRICT GEO CHECKSUM BLOCK]', { employee_id: candidate.employeeId, reason: 'checksum_regression_with_temporal_regression' });
        return block('checksum_regression_with_temporal_regression');
      }
    }
    if (prev.lineageUpdatedAt && candidate.lineageUpdatedAt && candidate.lineageUpdatedAt < prev.lineageUpdatedAt) {
      console.warn('[STRICT GEO LINEAGE BLOCK]', { employee_id: candidate.employeeId, reason: 'lineage_regression' });
      return block('lineage_regression');
    }
    const dt = candidate.capturedAtMs - prev.capturedAtMs;
    if (dt > 0 && dt < TELEPORT_WINDOW_MS) {
      const dist = distanceMeters(
        { latitude: prev.latitude, longitude: prev.longitude },
        { latitude: candidate.latitude, longitude: candidate.longitude },
      );
      if (dist > TELEPORT_M) return block('teleport_gt_1km_lt_20s');
    }
  }

  memoryByEmployee.set(candidate.employeeId, {
    capturedAtMs: candidate.capturedAtMs,
    stateVersion: candidate.stateVersion ?? 0,
    checksum: candidate.checksum ?? null,
    latitude: candidate.latitude,
    longitude: candidate.longitude,
    lineageUpdatedAt: candidate.lineageUpdatedAt ?? null,
  });
  return { ok: true };
}

