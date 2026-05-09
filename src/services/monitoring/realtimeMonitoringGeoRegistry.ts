/**
 * Evita que eventos Postgres atrasados disparem refresh que competem com estado mais novo (monotonicidade por colaborador).
 */

import type { CurrentOperationalStateRow } from '../currentOperationalState.service';
import { assertMonotonicOperationalState } from '../../domain/operational/assertMonotonicOperationalState';
import { normalizeOperationalDate } from '../../utils/operationalDateHardLock';

type CosSeen = {
  state_version: number;
  updated_at: string;
  map_captured_at: string | null;
  checksum: string | null;
  lineage: string | null;
};

type LiveSeen = {
  updated_at: string;
  captured_at: string;
  checksum: string | null;
  lineage: string | null;
};

const cosRegistry = new Map<string, CosSeen>();
const liveRegistry = new Map<string, LiveSeen>();

function cosKey(companyId: string, employeeId: string): string {
  return `${companyId}:${employeeId}`;
}

/**
 * Atualiza o registro após fetch autoritativo (servidor).
 */
export function commitMonitoringGeoRegistryFromFetch(companyId: string, cosRows: CurrentOperationalStateRow[]): void {
  for (const r of cosRows) {
    cosRegistry.set(cosKey(companyId, r.employee_id), {
      state_version: Number(r.state_version ?? 0),
      updated_at: r.updated_at,
      map_captured_at: r.map_captured_at ?? null,
      checksum: String(r.geo_snapshot_checksum ?? '').trim() || null,
      lineage: r.updated_at ?? null,
    });
  }
}

/**
 * Payload `new` de postgres_changes — retorna false se o evento deve ser ignorado.
 */
export function shouldProcessRealtimeCosPayload(
  companyId: string,
  newRow: Record<string, unknown> | null | undefined,
): boolean {
  if (!newRow || typeof newRow !== 'object') return true;
  const employeeId = String(newRow.employee_id ?? '');
  if (!employeeId) return true;

  const incoming = {
    state_version: Number(newRow.state_version ?? 0),
    updated_at: String(newRow.updated_at ?? ''),
    captured_at: (newRow.map_captured_at != null ? String(newRow.map_captured_at) : null) as string | null,
    checksum: (newRow.geo_snapshot_checksum != null ? String(newRow.geo_snapshot_checksum) : '') || null,
    lineage: (newRow.updated_at != null ? String(newRow.updated_at) : '') || null,
  };

  const key = cosKey(companyId, employeeId);
  const prev = cosRegistry.get(key);
  if (!prev) return true;

  const snap = assertMonotonicOperationalState(
    {
      state_version: incoming.state_version,
      updated_at: incoming.updated_at,
      captured_at: incoming.captured_at,
    },
    {
      state_version: prev.state_version,
      updated_at: prev.updated_at,
      captured_at: prev.map_captured_at,
    },
  );

  if (snap.ok === false) {
    console.info('[REALTIME STALE EVENT IGNORED]', {
      table: 'current_operational_state',
      company_id: companyId,
      employee_id: employeeId,
      reason: snap.reason,
    });
    console.warn('[REALTIME REGRESSION BLOCKED]', {
      table: 'current_operational_state',
      company_id: companyId,
      employee_id: employeeId,
      reason: snap.reason,
    });
    return false;
  }
  if (prev.checksum && incoming.checksum && prev.checksum !== incoming.checksum && incoming.state_version <= prev.state_version) {
    console.warn('[REALTIME REGRESSION BLOCKED]', {
      table: 'current_operational_state',
      company_id: companyId,
      employee_id: employeeId,
      reason: 'checksum_mismatch_non_monotonic',
    });
    return false;
  }
  if (prev.lineage && incoming.lineage && incoming.lineage < prev.lineage) {
    console.warn('[REALTIME STALE EVENT DROPPED]', {
      table: 'current_operational_state',
      company_id: companyId,
      employee_id: employeeId,
      reason: 'lineage_regression',
    });
    return false;
  }
  cosRegistry.set(key, {
    state_version: incoming.state_version,
    updated_at: incoming.updated_at,
    map_captured_at: incoming.captured_at,
    checksum: incoming.checksum,
    lineage: incoming.lineage,
  });
  return true;
}

export function shouldProcessRealtimeLivePayload(
  companyId: string,
  newRow: Record<string, unknown> | null | undefined,
): boolean {
  if (!newRow || typeof newRow !== 'object') return true;
  const employeeId = String(newRow.employee_id ?? '');
  if (!employeeId) return true;

  const updatedAt = String(newRow.updated_at ?? '');
  const capturedAt = String(newRow.captured_at ?? '');
  const checksum = String(newRow.geo_snapshot_checksum ?? '') || null;
  const key = cosKey(companyId, employeeId);
  const prev = liveRegistry.get(key);
  if (!prev) {
    liveRegistry.set(key, { updated_at: updatedAt, captured_at: capturedAt, checksum, lineage: updatedAt || null });
    return true;
  }

  const uNew = normalizeOperationalDate(updatedAt, { quiet: true, source: 'liveRealtime' });
  const uOld = normalizeOperationalDate(prev.updated_at, { quiet: true, source: 'liveRealtime' });
  const cNew = normalizeOperationalDate(capturedAt, { quiet: true, source: 'liveRealtime' });
  const cOld = normalizeOperationalDate(prev.captured_at, { quiet: true, source: 'liveRealtime' });

  if (uNew && uOld && uNew.instantMs + 500 < uOld.instantMs) {
    console.info('[REALTIME STALE EVENT IGNORED]', {
      table: 'live_employee_location',
      company_id: companyId,
      employee_id: employeeId,
      reason: 'updated_at_regression',
    });
    console.warn('[REALTIME REGRESSION BLOCKED]', {
      table: 'live_employee_location',
      company_id: companyId,
      employee_id: employeeId,
      reason: 'updated_at_regression',
    });
    return false;
  }
  if (cNew && cOld && cNew.instantMs + 500 < cOld.instantMs && uNew && uOld && uNew.instantMs <= uOld.instantMs) {
    console.info('[REALTIME STALE EVENT IGNORED]', {
      table: 'live_employee_location',
      company_id: companyId,
      employee_id: employeeId,
      reason: 'captured_at_regression',
    });
    console.warn('[REALTIME STALE EVENT DROPPED]', {
      table: 'live_employee_location',
      company_id: companyId,
      employee_id: employeeId,
      reason: 'captured_at_regression',
    });
    return false;
  }
  if (prev.checksum && checksum && prev.checksum !== checksum && uNew && uOld && uNew.instantMs <= uOld.instantMs) {
    console.warn('[REALTIME REGRESSION BLOCKED]', {
      table: 'live_employee_location',
      company_id: companyId,
      employee_id: employeeId,
      reason: 'checksum_mismatch_non_monotonic',
    });
    return false;
  }
  liveRegistry.set(key, { updated_at: updatedAt, captured_at: capturedAt, checksum, lineage: updatedAt || null });
  return true;
}

export function resetLiveRegistryEntry(companyId: string, employeeId: string): void {
  liveRegistry.delete(cosKey(companyId, employeeId));
}
